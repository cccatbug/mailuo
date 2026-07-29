export type Theme = "light" | "dark";
export type ThemeMode = Theme | "system";
export type ThemePalette = "paper" | "moon" | "celadon" | "graphite";

export const THEME_PALETTES: ThemePalette[] = [
  "paper",
  "moon",
  "celadon",
  "graphite",
];

export function resolveThemeMode(
  mode: ThemeMode,
  systemPrefersDark: boolean
): Theme {
  return mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;
}

export function migrateThemePreference(
  legacyTheme: string | null,
  storedMode: string | null,
  storedPalette: string | null
): { mode: ThemeMode; palette: ThemePalette } {
  const mode: ThemeMode =
    storedMode === "system" ||
    storedMode === "light" ||
    storedMode === "dark"
      ? storedMode
      : legacyTheme === "dark"
        ? "dark"
        : legacyTheme === "light"
          ? "light"
          : "system";
  const palette = THEME_PALETTES.includes(storedPalette as ThemePalette)
    ? (storedPalette as ThemePalette)
    : "paper";
  return { mode, palette };
}
