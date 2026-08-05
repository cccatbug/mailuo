export type ResourceTarget =
  | { kind: "asset"; assetId: string }
  | { kind: "browser"; url: string }
  | { kind: "file"; path: string }
  | { kind: "unsupported" };

/** 将备注里的受支持链接分类，避免让自定义协议落入 Chromium 的外链处理。 */
export function resourceTarget(href: string): ResourceTarget {
  const value = href.trim();
  if (value.startsWith("mailuo-asset:")) {
    const assetId = value.slice("mailuo-asset:".length).trim();
    return assetId ? { kind: "asset", assetId } : { kind: "unsupported" };
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return { kind: "browser", url: parsed.toString() };
    }
    if (parsed.protocol === "file:") {
      return { kind: "file", path: decodeURIComponent(parsed.pathname) };
    }
  } catch {
    // 无效链接交给调用方显示统一错误。
  }
  return { kind: "unsupported" };
}
