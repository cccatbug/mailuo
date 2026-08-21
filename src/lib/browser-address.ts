/** 内置浏览器可选搜索引擎。 */
export type BrowserSearchEngine = "google" | "bing" | "baidu" | "duckduckgo";

export const BROWSER_SEARCH_ENGINES: BrowserSearchEngine[] = [
  "google",
  "bing",
  "baidu",
  "duckduckgo",
];

export const BROWSER_SEARCH_URLS: Record<BrowserSearchEngine, string> = {
  google: "https://www.google.com/search?q=",
  bing: "https://www.bing.com/search?q=",
  baidu: "https://www.baidu.com/s?wd=",
  duckduckgo: "https://duckduckgo.com/?q=",
};

export function isBrowserSearchEngine(
  value: unknown
): value is BrowserSearchEngine {
  return BROWSER_SEARCH_ENGINES.includes(value as BrowserSearchEngine);
}

export const DEFAULT_HOMEPAGE = "https://www.google.com";

/** 输入是否像网址（带 scheme 或域名/localhost）：是则直接导航而不是搜索。 */
export function isLikelyAddress(value: string): boolean {
  const input = value.trim();
  if (!input) return false;
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return true;
  return /^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:\/|$)/i.test(input);
}

/**
 * 把地址栏输入规范化为可加载的 URL：
 * - 空输入 → 主页
 * - 带 scheme 的原样保留
 * - 域名 / localhost[:port] → https 前缀
 * - 其余 → 所选搜索引擎的搜索 URL
 */
export function normalizeAddress(
  value: string,
  options: { homepage?: string; searchEngine?: BrowserSearchEngine } = {}
): string {
  const input = value.trim();
  const homepage = options.homepage?.trim() || DEFAULT_HOMEPAGE;
  const engine =
    options.searchEngine && isBrowserSearchEngine(options.searchEngine)
      ? options.searchEngine
      : "google";
  if (!input) return homepage;
  // 域名/localhost 优先于 scheme 判断：`localhost:3000` 不是 scheme，而是带端口的地址
  if (/^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:\/|$)/i.test(input)) {
    return `https://${input}`;
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return input;
  return `${BROWSER_SEARCH_URLS[engine]}${encodeURIComponent(input)}`;
}
