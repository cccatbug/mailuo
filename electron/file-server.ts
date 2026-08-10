import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { resolveMailuoPath } from "./pi";

/**
 * 本地文件服务：在 127.0.0.1 随机端口上提供 ~/.mailuo 内文件的 HTTP 访问。
 *
 * 背景：渲染进程 fetch() 无法访问自定义 protocol scheme（Chromium 只允许
 * chrome/data/http(s) 等跨源请求），因此大文件（PDF）改用本服务流式提供，
 * 支持 Range 分块请求——pdf.js 只需按需拉取字节，不再把整个文件 base64 化
 * 或一次性读入内存，体积再大也能打开。
 *
 * 安全：只监听回环地址；每个 URL 带一次性的会话 token；每个请求都用
 * resolveMailuoPath 重新校验路径必须在 ~/.mailuo 内；MIME 由主进程传入。
 */
class MailuoFileServer {
  private server: Server | null = null;
  private token = randomUUID();
  private baseUrl = "";

  /** 返回可在渲染进程 fetch 的受控 URL（立即校验路径合法性）。 */
  async urlFor(p: string, mimeType: string): Promise<string> {
    const abs = resolveMailuoPath(p);
    await this.ensureStarted();
    const safeMime = (mimeType || "application/octet-stream").toLowerCase().split(";")[0].trim();
    return `${this.baseUrl}/mailuo-files/${this.token}/${encodeURIComponent(abs)}?mime=${encodeURIComponent(safeMime)}`;
  }

  close(): void {
    this.server?.close();
    this.server = null;
    this.token = randomUUID();
    this.baseUrl = "";
  }

  private async ensureStarted(): Promise<void> {
    if (this.server) return;
    const server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", reject);
        this.baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
    this.server = server;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "Range, Content-Type",
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.method !== "GET") {
      res.writeHead(405, cors);
      res.end();
      return;
    }
    try {
      const url = new URL(req.url ?? "/", this.baseUrl);
      const parts = url.pathname.split("/").filter(Boolean);
      if (parts[0] !== "mailuo-files" || parts[1] !== this.token) {
        res.writeHead(403, cors);
        res.end();
        return;
      }
      const abs = resolveMailuoPath(decodeURIComponent(parts.slice(2).join("/")));
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        res.writeHead(404, cors);
        res.end();
        return;
      }
      const mime = decodeURIComponent(url.searchParams.get("mime") ?? "") || "application/octet-stream";
      const total = stat.size;

      let status = 200;
      let start = 0;
      let end = total - 1;
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (match && (match[1] !== "" || match[2] !== "")) {
          if (match[1] === "") {
            // 后缀范围：bytes=-N 表示末尾 N 字节
            start = Math.max(0, total - Number(match[2]));
            end = total - 1;
          } else {
            start = Number(match[1]);
            end = match[2] === "" ? total - 1 : Number(match[2]);
          }
          if (start < 0 || start >= total || end < start) {
            res.writeHead(416, {
              ...cors,
              "content-range": `bytes */${total}`,
            });
            res.end();
            return;
          }
          end = Math.min(end, total - 1);
          status = 206;
        }
      }

      const headers: Record<string, string> = {
        ...cors,
        "content-type": mime,
        "content-length": String(end - start + 1),
        "accept-ranges": "bytes",
        "cache-control": "no-store",
      };
      if (status === 206) {
        headers["content-range"] = `bytes ${start}-${end}/${total}`;
      }
      res.writeHead(status, headers);
      createReadStream(abs, { start, end }).pipe(res);
    } catch {
      res.writeHead(403, cors);
      res.end();
    }
  }
}

export const FILE_SERVER = new MailuoFileServer();
