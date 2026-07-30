import { randomUUID } from "node:crypto";

export interface OpenTabSuggestion {
  tabId: string;
  url: string;
  title: string;
  pinned: boolean;
  favicon?: string;
}

export interface HistorySnapshot {
  enabled: boolean;
  visits: Array<{
    url: string;
    title: string;
    visitedAt: number;
    visits: number;
  }>;
  searches: Array<{ query: string; searchedAt: number; searches: number }>;
}

export type AddressSuggestion =
  | (OpenTabSuggestion & { kind: "tab"; score: number })
  | { kind: "history"; url: string; title: string; score: number }
  | { kind: "search"; query: string; score: number };

function fuzzyScore(query: string, value: string): number {
  const needle = query.toLocaleLowerCase();
  const haystack = value.toLocaleLowerCase();
  if (!needle) return 1;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) return 100 - exact;
  let cursor = 0;
  for (const char of needle) {
    cursor = haystack.indexOf(char, cursor);
    if (cursor < 0) return 0;
    cursor += 1;
  }
  return 25;
}

export class BrowserHistory {
  enabled = true;
  private visits = new Map<string, HistorySnapshot["visits"][number]>();
  private searches = new Map<string, HistorySnapshot["searches"][number]>();

  constructor(snapshot?: Partial<HistorySnapshot>) {
    this.restore(snapshot);
  }

  restore(snapshot?: Partial<HistorySnapshot>) {
    this.visits.clear();
    this.searches.clear();
    this.enabled = snapshot?.enabled ?? true;
    for (const visit of snapshot?.visits ?? []) this.visits.set(visit.url, visit);
    for (const search of snapshot?.searches ?? []) this.searches.set(search.query, search);
  }

  recordVisit(input: { url: string; title: string; visitedAt?: number }) {
    if (!this.enabled) return;
    const previous = this.visits.get(input.url);
    this.visits.set(input.url, {
      url: input.url,
      title: input.title,
      visitedAt: input.visitedAt ?? Date.now(),
      visits: (previous?.visits ?? 0) + 1,
    });
  }

  recordSearch(query: string, searchedAt = Date.now()) {
    if (!this.enabled || !query.trim()) return;
    const previous = this.searches.get(query);
    this.searches.set(query, {
      query,
      searchedAt,
      searches: (previous?.searches ?? 0) + 1,
    });
  }

  delete(url: string) {
    this.visits.delete(url);
  }

  clear(range?: { since?: number; until?: number }) {
    if (!range) {
      this.visits.clear();
      this.searches.clear();
      return;
    }
    const inside = (time: number) =>
      time >= (range.since ?? -Infinity) && time <= (range.until ?? Infinity);
    for (const [key, visit] of this.visits) {
      if (inside(visit.visitedAt)) this.visits.delete(key);
    }
    for (const [key, search] of this.searches) {
      if (inside(search.searchedAt)) this.searches.delete(key);
    }
  }

  suggest(query: string, tabs: OpenTabSuggestion[], limit = 8): AddressSuggestion[] {
    if (!this.enabled) return [];
    const openUrls = new Set(tabs.map((tab) => tab.url));
    const ranked: AddressSuggestion[] = [];
    for (const tab of tabs) {
      const match = fuzzyScore(query, `${tab.title} ${tab.url}`);
      if (match) ranked.push({ ...tab, kind: "tab", score: 10_000 + match + (tab.pinned ? 500 : 0) });
    }
    for (const visit of this.visits.values()) {
      if (openUrls.has(visit.url)) continue;
      const match = fuzzyScore(query, `${visit.title} ${visit.url}`);
      if (match) {
        ranked.push({
          kind: "history",
          url: visit.url,
          title: visit.title,
          score: match + Math.log2(visit.visits + 1) * 10 + visit.visitedAt / 1e12,
        });
      }
    }
    for (const search of this.searches.values()) {
      const match = fuzzyScore(query, search.query);
      if (match) {
        ranked.push({
          kind: "search",
          query: search.query,
          score: match + Math.log2(search.searches + 1) * 10 + search.searchedAt / 1e12,
        });
      }
    }
    return ranked.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  snapshot(): HistorySnapshot {
    return {
      enabled: this.enabled,
      visits: [...this.visits.values()],
      searches: [...this.searches.values()],
    };
  }
}

export type SearchProvider = "google" | "bing" | "baidu" | "duckduckgo" | "custom";

const SEARCH_TEMPLATES: Record<Exclude<SearchProvider, "custom">, string> = {
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  baidu: "https://www.baidu.com/s?wd=%s",
  duckduckgo: "https://duckduckgo.com/?q=%s",
};

export function resolveAddress(
  value: string,
  settings: { provider: SearchProvider; customTemplate?: string }
): string {
  const input = value.trim();
  if (!input) return "about:blank";
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return new URL(input).toString();
  if (/^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:\/|$)/i.test(input)) {
    return new URL(`https://${input}`).toString();
  }
  const template =
    settings.provider === "custom"
      ? settings.customTemplate
      : SEARCH_TEMPLATES[settings.provider];
  if (!template?.includes("%s")) throw new Error("自定义搜索 URL 模板必须包含 %s");
  const parsed = new URL(template.replace("%s", encodeURIComponent(input)));
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("搜索 URL 模板必须使用 HTTP(S)");
  }
  return parsed.toString();
}

export interface BrowserStyleRule {
  id: string;
  name?: string;
  enabled: boolean;
  scope: "all" | "domain" | "url";
  pattern?: string;
  css: string;
  createdAt: number;
  updatedAt: number;
  builtin?: boolean;
}

export const READING_PRESET: Omit<BrowserStyleRule, "id" | "createdAt" | "updatedAt"> = {
  name: "统一阅读模式",
  enabled: false,
  scope: "all",
  builtin: true,
  css: `article,main,[role="main"]{max-width:72ch;margin-inline:auto;line-height:1.75;font-size:18px}
body{background:#faf8f2;color:#292722}pre,code{font-family:ui-monospace,monospace}`,
};

export class BrowserStyleStore {
  private rules = new Map<string, BrowserStyleRule>();

  constructor(rules: BrowserStyleRule[] = []) {
    this.restore(rules);
  }

  restore(rules: BrowserStyleRule[]) {
    this.rules.clear();
    for (const rule of rules) this.rules.set(rule.id, rule);
  }

  add(input: {
    name?: string;
    enabled?: boolean;
    scope: BrowserStyleRule["scope"];
    pattern?: string;
    css: string;
    builtin?: boolean;
  }): BrowserStyleRule {
    if (input.scope !== "all" && !input.pattern?.trim()) {
      throw new Error("站点样式需要匹配域名或 URL");
    }
    const now = Date.now();
    const rule: BrowserStyleRule = {
      ...input,
      id: randomUUID(),
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.rules.set(rule.id, rule);
    return rule;
  }

  update(id: string, patch: Partial<Omit<BrowserStyleRule, "id" | "createdAt">>) {
    const current = this.rules.get(id);
    if (!current) throw new Error(`样式 ${id} 不存在`);
    const next = { ...current, ...patch, id, createdAt: current.createdAt, updatedAt: Date.now() };
    this.rules.set(id, next);
    return next;
  }

  remove(id: string) {
    return this.rules.delete(id);
  }

  list() {
    return [...this.rules.values()];
  }

  match(rawUrl: string): BrowserStyleRule[] {
    const url = new URL(rawUrl);
    return this.list().filter((rule) => {
      if (!rule.enabled) return false;
      if (rule.scope === "all") return true;
      if (rule.scope === "domain") {
        const pattern = rule.pattern!.replace(/^\*\./, "");
        return url.hostname === pattern || url.hostname.endsWith(`.${pattern}`);
      }
      const escaped = rule.pattern!
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      return new RegExp(`^${escaped}$`).test(url.toString());
    });
  }
}
