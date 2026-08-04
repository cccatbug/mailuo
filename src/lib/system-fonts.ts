export interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

export const COMMON_SYSTEM_FONTS = [
  "Arial",
  "Calibri",
  "Cambria",
  "Consolas",
  "Georgia",
  "Helvetica Neue",
  "Hiragino Sans GB",
  "Microsoft YaHei",
  "Noto Sans CJK SC",
  "Noto Sans SC",
  "Noto Serif CJK SC",
  "Noto Serif SC",
  "PingFang SC",
  "Segoe UI",
  "SimSun",
  "Songti SC",
  "Source Han Sans SC",
  "Source Han Serif SC",
  "STSong",
  "Times New Roman",
] as const;

export function uniqueFontFamilies(fonts: Iterable<{ family: string }>): string[] {
  const families = new Map<string, string>();
  for (const font of fonts) {
    const family = font.family.trim();
    if (!family) continue;
    const key = family.toLocaleLowerCase();
    if (!families.has(key)) families.set(key, family);
  }
  return [...families.values()].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

/**
 * Local Font Access 必须由用户手势触发，因此只应从点击/打开选择器的回调中调用。
 */
export async function querySystemFontFamilies(): Promise<string[]> {
  const queryLocalFonts = (window as LocalFontWindow).queryLocalFonts;
  if (!queryLocalFonts) {
    throw new Error("当前 Chromium 不支持读取系统字体");
  }
  return uniqueFontFamilies(await queryLocalFonts.call(window));
}

export function quoteFontFamily(family: string): string {
  return `"${family.replace(/[\\"]/g, "\\$&").replace(/[\r\n\f]/g, " ")}"`;
}
