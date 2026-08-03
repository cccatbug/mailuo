import { describe, expect, it } from "vitest";
import {
  migrateThemePreference,
  resolveThemeMode,
  THEME_PALETTES,
} from "./theme";

describe("theme preferences", () => {
  it("migrates the legacy explicit theme without changing its appearance", () => {
    expect(migrateThemePreference("dark", null, null)).toEqual({
      mode: "dark",
      palette: "paper",
    });
  });

  it("resolves system mode from the current color-scheme preference", () => {
    expect(resolveThemeMode("system", true)).toBe("dark");
    expect(resolveThemeMode("system", false)).toBe("light");
    expect(resolveThemeMode("light", true)).toBe("light");
  });

  it("restores the pure white palette from persisted preferences", () => {
    expect(migrateThemePreference(null, "dark", "white")).toEqual({
      mode: "light",
      palette: "white",
    });
  });

  it("exposes all five supported global palettes", () => {
    expect(THEME_PALETTES).toEqual([
      "white",
      "paper",
      "moon",
      "celadon",
      "graphite",
    ]);
  });
});
