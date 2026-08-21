import { app } from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { BrowserHistoryEntry } from "../src/shared/browser";

/** 历史条数上限：超出后按访问时间丢弃最旧的。 */
export const BROWSER_HISTORY_LIMIT = 3000;
/** 落盘防抖窗口。 */
const WRITE_DEBOUNCE_MS = 600;

/**
 * 历史身份的规范化：只保留 http(s)，去掉 fragment，
 * 让 hash 路由的片段变化合并进同一条记录而不是刷屏。
 */
export function normalizeHistoryUrl(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  return url.toString();
}

/** 补全与展示用的域名：去掉 www. 前缀。 */
export function historyDomain(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./i, "");
  } catch {
    return rawUrl;
  }
}

/**
 * 把一次访问合并进历史：同 URL 更新标题、刷新访问时间并累计次数；
 * 新 URL 插入队首。返回按 visitedAt 降序、裁剪到上限的新数组（不可变）。
 */
export function mergeHistoryEntry(
  entries: readonly BrowserHistoryEntry[],
  rawUrl: string,
  title: string,
  now: number = Date.now()
): BrowserHistoryEntry[] {
  const url = normalizeHistoryUrl(rawUrl);
  if (!url) return [...entries];
  const cleanTitle = title?.trim() ?? "";
  const existing = entries.find((entry) => entry.url === url);
  const next: BrowserHistoryEntry = existing
    ? {
        ...existing,
        title: cleanTitle || existing.title,
        visitedAt: now,
        visitCount: existing.visitCount + 1,
      }
    : {
        id: randomUUID(),
        url,
        domain: historyDomain(url),
        title: cleanTitle,
        visitedAt: now,
        visitCount: 1,
      };
  return [next, ...entries.filter((entry) => entry.url !== url)]
    .sort((a, b) => b.visitedAt - a.visitedAt)
    .slice(0, BROWSER_HISTORY_LIMIT);
}

function isHistoryEntry(value: unknown): value is BrowserHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.url === "string" &&
    typeof entry.domain === "string" &&
    typeof entry.title === "string" &&
    typeof entry.visitedAt === "number" &&
    typeof entry.visitCount === "number"
  );
}

interface HistoryFileShape {
  entries?: unknown;
}

/**
 * 内置浏览器历史：主进程独占的 userData/browser-history.json，
 * 原子写入 + 防抖，避免每次导航都触碰磁盘。
 */
export class BrowserHistoryStore {
  private entries: BrowserHistoryEntry[] = [];
  private loaded = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  private file(): string {
    return path.join(app.getPath("userData"), "browser-history.json");
  }

  /** 懒加载：首次读写前把磁盘上的历史读进内存。 */
  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const raw = await fs.readFile(this.file(), "utf8");
      const parsed = JSON.parse(raw) as HistoryFileShape;
      if (Array.isArray(parsed.entries)) {
        this.entries = parsed.entries
          .filter(isHistoryEntry)
          .sort((a, b) => b.visitedAt - a.visitedAt)
          .slice(0, BROWSER_HISTORY_LIMIT);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException | null)?.code !== "ENOENT") {
        console.error("[browser-history] 读取历史失败：", error);
      }
    }
  }

  /** 记录一次访问（非 http(s) 会被规范化拒绝）。 */
  async add(rawUrl: string, title: string): Promise<void> {
    await this.ensureLoaded();
    if (!normalizeHistoryUrl(rawUrl)) return;
    const merged = mergeHistoryEntry(this.entries, rawUrl, title);
    if (merged === this.entries) return;
    this.entries = merged;
    this.scheduleWrite();
  }

  /** 按访问时间降序返回全部历史（内存已是该序）。 */
  async list(): Promise<BrowserHistoryEntry[]> {
    await this.ensureLoaded();
    return [...this.entries];
  }

  async clear(): Promise<void> {
    await this.ensureLoaded();
    this.entries = [];
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.write();
  }

  /** 退出前落盘：取消防抖计时器，立刻写。 */
  async flush(): Promise<void> {
    await this.ensureLoaded();
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    await this.write();
  }

  private scheduleWrite(): void {
    if (this.writeTimer) clearTimeout(this.writeTimer);
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.write().catch((error) => {
        console.error("[browser-history] 写入失败：", error);
      });
    }, WRITE_DEBOUNCE_MS);
  }

  /** 串行化原子写入，避免防抖窗口内的写互相覆盖。 */
  private write(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      const file = this.file();
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.writeFile(
        tmp,
        JSON.stringify({ entries: this.entries }),
        "utf8"
      );
      await fs.rename(tmp, file);
    });
    return this.writeChain;
  }
}

export const BROWSER_HISTORY = new BrowserHistoryStore();
