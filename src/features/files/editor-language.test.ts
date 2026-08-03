import { describe, expect, it } from "vitest";
import { fileEditorLanguage } from "./editor-language";

describe("fileEditorLanguage", () => {
  it("maps common workspace files to Monaco language identifiers", () => {
    expect(fileEditorLanguage("notes.md")).toBe("markdown");
    expect(fileEditorLanguage("settings.json")).toBe("json");
    expect(fileEditorLanguage("component.tsx")).toBe("typescript");
    expect(fileEditorLanguage("page.html")).toBe("html");
    expect(fileEditorLanguage("theme.css")).toBe("css");
    expect(fileEditorLanguage("config.yml")).toBe("yaml");
    expect(fileEditorLanguage("README")).toBe("plaintext");
  });
});
