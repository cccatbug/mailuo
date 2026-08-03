import { describe, expect, it } from "vitest";
import { isTextEditingTarget } from "./keyboard";

function target(
  tagName: string,
  options: { contentEditable?: boolean; monaco?: boolean } = {}
) {
  return {
    tagName,
    isContentEditable: options.contentEditable ?? false,
    closest: (selector: string) =>
      options.monaco && selector.includes(".monaco-editor") ? {} : null,
  } as unknown as EventTarget;
}

describe("isTextEditingTarget", () => {
  it("lets native text controls and Monaco own editing shortcuts", () => {
    expect(isTextEditingTarget(target("INPUT"))).toBe(true);
    expect(isTextEditingTarget(target("TEXTAREA"))).toBe(true);
    expect(isTextEditingTarget(target("DIV", { contentEditable: true }))).toBe(true);
    expect(isTextEditingTarget(target("DIV", { monaco: true }))).toBe(true);
  });

  it("leaves non-editable application chrome to application shortcuts", () => {
    expect(isTextEditingTarget(target("BUTTON"))).toBe(false);
    expect(isTextEditingTarget(target("DIV"))).toBe(false);
    expect(isTextEditingTarget(null)).toBe(false);
  });
});
