import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const testRoot = vi.hoisted(() => `/tmp/mailuo-file-server-${process.pid}`);
vi.mock("./pi", () => {
  const nodePath = path as typeof import("node:path");
  return {
    MAILUO_HOME: testRoot,
    resolveMailuoPath: (p: string): string => {
      const resolved = nodePath.resolve(p);
      if (
        !resolved.startsWith(testRoot + nodePath.sep) &&
        resolved !== testRoot
      ) {
        throw new Error("路径超出 ~/.mailuo 范围");
      }
      return resolved;
    },
  };
});

import { FILE_SERVER } from "./file-server";

const SAMPLE = Buffer.from("0123456789abcdefghijklmnopqrstuvwxyz".repeat(20));

async function get(url: string, headers?: Record<string, string>) {
  return fetch(url, { headers });
}

describe("file-server", () => {
  beforeAll(async () => {
    await fs.mkdir(path.join(testRoot, "workspace", "demo"), { recursive: true });
    await fs.writeFile(path.join(testRoot, "workspace", "demo", "sample.pdf"), SAMPLE);
  });

  afterEach(() => {
    FILE_SERVER.close();
  });

  it("streams a full file over HTTP", async () => {
    const url = await FILE_SERVER.urlFor(
      path.join(testRoot, "workspace", "demo", "sample.pdf"),
      "application/pdf",
    );
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(SAMPLE);
  });

  it("honors byte-range requests with 206", async () => {
    const url = await FILE_SERVER.urlFor(
      path.join(testRoot, "workspace", "demo", "sample.pdf"),
      "application/pdf",
    );
    const res = await get(url, { Range: "bytes=10-19" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 10-19/${SAMPLE.length}`);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(SAMPLE.subarray(10, 20));
  });

  it("honors suffix ranges (bytes=-N)", async () => {
    const url = await FILE_SERVER.urlFor(
      path.join(testRoot, "workspace", "demo", "sample.pdf"),
      "application/pdf",
    );
    const res = await get(url, { Range: "bytes=-5" });
    expect(res.status).toBe(206);
    expect(Buffer.from(await res.arrayBuffer())).toEqual(SAMPLE.subarray(-5));
  });

  it("rejects requests with a wrong token", async () => {
    const url = await FILE_SERVER.urlFor(
      path.join(testRoot, "workspace", "demo", "sample.pdf"),
      "application/pdf",
    );
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/(?<=\/mailuo-files\/)\w+/, "wrong-token");
    const res = await get(parsed.toString());
    expect(res.status).toBe(403);
  });

  it("rejects paths outside ~/.mailuo", async () => {
    const url = await FILE_SERVER.urlFor(
      path.join(testRoot, "workspace", "demo", "sample.pdf"),
      "application/pdf",
    );
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(
      encodeURIComponent(testRoot),
      encodeURIComponent("/etc"),
    );
    const res = await get(parsed.toString());
    expect(res.status).toBe(403);
  });

  it("answers OPTIONS preflight with CORS headers", async () => {
    const url = await FILE_SERVER.urlFor(
      path.join(testRoot, "workspace", "demo", "sample.pdf"),
      "application/pdf",
    );
    const parsed = new URL(url);
    const res = await new Promise<{
      statusCode: number | undefined;
      headers: import("node:http").IncomingHttpHeaders;
    }>((resolve, reject) => {
      const req = http.request(
        { host: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, method: "OPTIONS" },
        (response) => resolve({ statusCode: response.statusCode, headers: response.headers }),
      );
      req.on("error", reject);
      req.end();
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-headers"]).toContain("Range");
  });

  it("regenerates the token after close()", async () => {
    const url1 = await FILE_SERVER.urlFor(
      path.join(testRoot, "workspace", "demo", "sample.pdf"),
      "application/pdf",
    );
    FILE_SERVER.close();
    const url2 = await FILE_SERVER.urlFor(
      path.join(testRoot, "workspace", "demo", "sample.pdf"),
      "application/pdf",
    );
    expect(url1).not.toBe(url2);
  });
});
