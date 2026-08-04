import { describe, expect, it } from "vitest";
import { quoteFontFamily, uniqueFontFamilies } from "./system-fonts";

describe("system font helpers", () => {
  it("deduplicates font faces into sorted families", () => {
    expect(
      uniqueFontFamilies([
        { family: "Noto Sans SC" },
        { family: " Arial " },
        { family: "noto sans sc" },
        { family: "" },
      ])
    ).toEqual(["Arial", "Noto Sans SC"]);
  });

  it("quotes font family names for CSS values", () => {
    expect(quoteFontFamily('A "Font"\\Name')).toBe('"A \\"Font\\"\\\\Name"');
  });
});
