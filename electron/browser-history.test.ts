import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/mailuo-history-test") },
}));

// 内存文件系统：让 store 的读写可观测且互不污染
const files = new Map<string, string>();
vi.mock("node:fs", () => ({
  promises: {
    readFile: vi.fn(async (file: string) => {
      const value = files.get(file);
      if (value === undefined) {
        const error = new Error(`ENOENT: ${file}`) as NodeJS.ErrnoException;
        error.code = "ENOENT";
        throw error;
      }
      return value;
    }),
    writeFile: vi.fn(async (file: string, data: string) => {
      files.set(file, data);
    }),
    mkdir: vi.fn(async () => undefined),
    rename: vi.fn(async (from: string, to: string) => {
      const value = files.get(from);
      if (value !== undefined) {
        files.delete(from);
        files.set(to, value);
      }
    }),
  },
}));

import { promises as fs } from "node:fs";
import {
  BROWSER_HISTORY_LIMIT,
  BrowserHistoryStore,
  historyDomain,
  mergeHistoryEntry,
  normalizeHistoryUrl,
} from "./browser-history";
import type { BrowserHistoryEntry } from "../src/shared/browser";

function entry(url: string, visitedAt: number, title = "示例页面"): BrowserHistoryEntry {
  return {
    id: `id-${url}`,
    url: normalizeHistoryUrl(url)!,
    domain: historyDomain(url),
    title,
    visitedAt,
    visitCount: 1,
  };
}

afterEach(() => {
  files.clear();
  vi.useRealTimers();
});

describe("normalizeHistoryUrl", () => {
  it("keeps http(s) URLs and strips fragments", () => {
    expect(normalizeHistoryUrl("https://example.com/a#section")).toBe(
      "https://example.com/a"
    );
    expect(normalizeHistoryUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000/"
    );
  });

  it("rejects non-http(s) and malformed input", () => {
    expect(normalizeHistoryUrl("about:blank")).toBeNull();
    expect(normalizeHistoryUrl("chrome-error://chromewebdata/")).toBeNull();
    expect(normalizeHistoryUrl("file:///etc/passwd")).toBeNull();
    expect(normalizeHistoryUrl("not a url")).toBeNull();
    expect(normalizeHistoryUrl("  ")).toBeNull();
  });
});

describe("historyDomain", () => {
  it("strips the www. prefix for matching and display", () => {
    expect(historyDomain("https://www.github.com/")).toBe("github.com");
    expect(historyDomain("https://docs.example.com/a")).toBe("docs.example.com");
  });
});

describe("mergeHistoryEntry", () => {
  it("appends a new visit at the head", () => {
    const now = 1_000;
    const merged = mergeHistoryEntry([], "https://github.com/", "GitHub", now);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      url: "https://github.com/",
      domain: "github.com",
      title: "GitHub",
      visitedAt: now,
      visitCount: 1,
    });
  });

  it("merges a repeated URL: bumps count, refreshes time, keeps older title", () => {
    const base = [entry("https://example.com/", 1_000)];
    const merged = mergeHistoryEntry(base, "https://example.com/#later", "新标题", 2_000);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      url: "https://example.com/",
      title: "新标题",
      visitedAt: 2_000,
      visitCount: 2,
    });
  });

  it("ignores empty titles instead of erasing the previous one", () => {
    const base = [entry("https://example.com/", 1_000, "原标题")];
    const merged = mergeHistoryEntry(base, "https://example.com/", "   ", 2_000);
    expect(merged[0].title).toBe("原标题");
    expect(merged[0].visitCount).toBe(2);
  });

  it("rejects non-http(s) visits", () => {
    const base = [entry("https://example.com/", 1_000)];
    const merged = mergeHistoryEntry(base, "about:blank", "空白页", 2_000);
    expect(merged).toEqual(base);
  });

  it("sorts by visitedAt descending and trims to the cap", () => {
    const many = Array.from({ length: BROWSER_HISTORY_LIMIT + 10 }, (_, index) =>
      entry(`https://site-${index}.example/`, index)
    );
    const merged = mergeHistoryEntry(many, "https://new.example/", "新页面", 999_999);
    expect(merged).toHaveLength(BROWSER_HISTORY_LIMIT);
    expect(merged[0].url).toBe("https://new.example/");
    expect(merged[merged.length - 1]!.url).toBe("https://site-11.example/");
  });
});

describe("BrowserHistoryStore", () => {
  it("persists visits atomically through the debounced writer", async () => {
    vi.useFakeTimers();
    const store = new BrowserHistoryStore();
    await store.add("https://github.com/", "GitHub");
    await store.add("https://example.com/#x", "示例");
    expect(await store.list()).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1_000);
    const raw = files.get("/tmp/mailuo-history-test/browser-history.json");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).entries).toHaveLength(2);
    expect((fs.writeFile as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(
      /\.tmp$/
    );
    expect((fs.rename as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("loads persisted history on first use", async () => {
    files.set(
      "/tmp/mailuo-history-test/browser-history.json",
      JSON.stringify({
        entries: [
          entry("https://older.example/", 100),
          entry("https://newer.example/", 200),
        ],
      })
    );
    const store = new BrowserHistoryStore();
    const list = await store.list();
    expect(list.map((item) => item.url)).toEqual([
      "https://newer.example/",
      "https://older.example/",
    ]);
  });

  it("clear() wipes history and writes immediately", async () => {
    const store = new BrowserHistoryStore();
    await store.add("https://github.com/", "GitHub");
    await store.clear();
    expect(await store.list()).toEqual([]);
    expect(JSON.parse(files.get("/tmp/mailuo-history-test/browser-history.json")!).entries).toEqual([]);
  });

  it("flush() writes even when the debounce has not fired", async () => {
    vi.useFakeTimers();
    const store = new BrowserHistoryStore();
    await store.add("https://github.com/", "GitHub");
    await store.flush();
    const raw = files.get("/tmp/mailuo-history-test/browser-history.json");
    expect(JSON.parse(raw!).entries).toHaveLength(1);
  });

  it("tolerates a missing history file", async () => {
    const store = new BrowserHistoryStore();
    expect(await store.list()).toEqual([]);
  });
});
