import { describe, expect, it } from "vitest";
import type { BrowserHistoryEntry } from "@/shared/browser";
import { formatRelativeTime, suggestBrowserHistory } from "./browser-history";

function entry(
  url: string,
  visitedAt: number,
  title = "",
  visitCount = 1
): BrowserHistoryEntry {
  return {
    id: `id-${url}`,
    url,
    domain: new URL(url).hostname.replace(/^www\./i, ""),
    title,
    visitedAt,
    visitCount,
  };
}

const SAMPLE: BrowserHistoryEntry[] = [
  entry("https://github.com/", 600, "GitHub"),
  entry("https://news.example.com/", 550, "新闻"),
  entry("https://docs.example.com/guide", 500, "使用文档"),
  entry("https://www.bing.com/search?q=git", 400, "git - 搜索"),
  entry("https://gitlab.com/", 200, "GitLab"),
  entry("https://other.org/articles/news", 100, "深度报道"),
];

describe("suggestBrowserHistory", () => {
  it("returns the most recent visit per domain for an empty query", () => {
    const suggestions = suggestBrowserHistory(SAMPLE, "");
    expect(suggestions.map((item) => item.url)).toEqual([
      "https://github.com/",
      "https://news.example.com/",
      "https://docs.example.com/guide",
      "https://www.bing.com/search?q=git",
      "https://gitlab.com/",
      "https://other.org/articles/news",
    ]);
  });

  it("ranks domain prefix matches above title-only matches", () => {
    const suggestions = suggestBrowserHistory(SAMPLE, "git");
    expect(suggestions[0].url).toBe("https://github.com/");
    expect(suggestions[1].url).toBe("https://gitlab.com/");
    // bing 搜索页是标题前缀命中，排域名命中之后
    expect(suggestions[2].url).toBe("https://www.bing.com/search?q=git");
  });

  it("ranks domain includes above url-only matches", () => {
    const suggestions = suggestBrowserHistory(SAMPLE, "news");
    expect(suggestions[0].url).toBe("https://news.example.com/");
    expect(suggestions[1].url).toBe("https://other.org/articles/news");
  });

  it("matches case-insensitively and trims the query", () => {
    const suggestions = suggestBrowserHistory(SAMPLE, "  GITHUB ");
    expect(suggestions.map((item) => item.url)).toEqual([
      "https://github.com/",
    ]);
  });

  it("matches titles", () => {
    const suggestions = suggestBrowserHistory(SAMPLE, "文档");
    expect(suggestions.map((item) => item.url)).toEqual([
      "https://docs.example.com/guide",
    ]);
  });

  it("honors the limit", () => {
    expect(suggestBrowserHistory(SAMPLE, "", 2)).toHaveLength(2);
    expect(suggestBrowserHistory(SAMPLE, "git", 1)).toHaveLength(1);
  });

  it("returns nothing when nothing matches", () => {
    expect(suggestBrowserHistory(SAMPLE, "zzzz")).toEqual([]);
  });
});

describe("formatRelativeTime", () => {
  const now = Date.now();

  it("formats seconds, minutes, hours and days", () => {
    expect(formatRelativeTime(now - 5_000, "zh-CN")).toBe("刚刚");
    expect(formatRelativeTime(now - 2 * 60_000, "zh-CN")).toBe("2分钟前");
    expect(formatRelativeTime(now - 3 * 3_600_000, "zh-CN")).toBe("3小时前");
    expect(formatRelativeTime(now - 4 * 86_400_000, "zh-CN")).toBe("4天前");
  });

  it("supports English", () => {
    expect(formatRelativeTime(now - 30_000, "en")).toBe("just now");
    expect(formatRelativeTime(now - 30 * 60_000, "en")).toBe("30 minutes ago");
  });
});
