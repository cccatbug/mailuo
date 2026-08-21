import type { BrowserHistoryEntry } from "@/shared/browser";

/** 补全命中权重的量级：域名前缀 > 标题前缀 > 域名包含 > 标题包含 > URL 包含。 */
const SCORE_DOMAIN_PREFIX = 120;
const SCORE_TITLE_PREFIX = 100;
const SCORE_DOMAIN_INCLUDES = 70;
const SCORE_TITLE_INCLUDES = 50;
const SCORE_URL_INCLUDES = 30;

function scoreEntry(entry: BrowserHistoryEntry, query: string): number {
  const title = entry.title.toLowerCase();
  const url = entry.url.toLowerCase();
  const domain = entry.domain.toLowerCase();
  if (domain.startsWith(query)) return SCORE_DOMAIN_PREFIX;
  if (title.startsWith(query)) return SCORE_TITLE_PREFIX;
  if (domain.includes(query)) return SCORE_DOMAIN_INCLUDES;
  if (title.includes(query)) return SCORE_TITLE_INCLUDES;
  if (url.includes(query)) return SCORE_URL_INCLUDES;
  return 0;
}

/**
 * 地址栏历史补全：
 * - 空输入：最近访问，同一域名只保留最新一条（Chrome 式「常去网站」）；
 * - 有输入：按域名/标题/URL 匹配度打分，同分时按访问时间新的优先。
 */
export function suggestBrowserHistory(
  entries: readonly BrowserHistoryEntry[],
  rawQuery: string,
  limit = 8
): BrowserHistoryEntry[] {
  const query = rawQuery.trim().toLowerCase();
  const sorted = [...entries].sort((a, b) => b.visitedAt - a.visitedAt);
  if (!query) {
    const seenDomains = new Set<string>();
    const recent: BrowserHistoryEntry[] = [];
    for (const entry of sorted) {
      if (seenDomains.has(entry.domain)) continue;
      seenDomains.add(entry.domain);
      recent.push(entry);
      if (recent.length >= limit) break;
    }
    return recent;
  }
  return sorted
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((item) => item.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.entry.visitedAt - a.entry.visitedAt
    )
    .slice(0, limit)
    .map((item) => item.entry);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3_600_000],
  ["month", 30 * 24 * 3_600_000],
  ["day", 24 * 3_600_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
  ["second", 1_000],
];

/** 历史列表用的「刚刚 / x 分钟前 / x 小时前 / x 天前」短格式。 */
export function formatRelativeTime(
  timestamp: number,
  locale: string = "zh-CN"
): string {
  const diffMs = Date.now() - timestamp;
  if (Math.abs(diffMs) < 60_000) {
    // 秒级文案在不同 ICU 实现间不一致，统一用「刚刚 / just now」
    return locale.toLowerCase().startsWith("zh") ? "刚刚" : "just now";
  }
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diffMs) >= ms || unit === "minute") {
      return formatter.format(-Math.round(diffMs / ms), unit);
    }
  }
  return "";
}
