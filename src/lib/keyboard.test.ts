import { describe, expect, it } from "vitest";
import { isImeComposing, isSubmitKey, isTextEditingTarget } from "./keyboard";

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

describe("isImeComposing", () => {
  it("detects composition from the native event React does not forward", () => {
    expect(isImeComposing({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(true);
  });

  it("falls back to keyCode 229 where WebKit clears isComposing too early", () => {
    expect(isImeComposing({ key: "Enter", nativeEvent: { keyCode: 229 } })).toBe(true);
    expect(isImeComposing({ key: "Enter", keyCode: 229 })).toBe(true);
  });

  it("reports no composition for plain typing", () => {
    expect(isImeComposing({ key: "Enter", nativeEvent: { isComposing: false, keyCode: 13 } })).toBe(false);
    expect(isImeComposing(null)).toBe(false);
  });
});

describe("isSubmitKey", () => {
  it("submits on a bare Enter", () => {
    expect(isSubmitKey({ key: "Enter", nativeEvent: { isComposing: false } })).toBe(true);
  });

  it("never submits while an IME candidate window is open", () => {
    expect(isSubmitKey({ key: "Enter", nativeEvent: { isComposing: true } })).toBe(false);
    expect(isSubmitKey({ key: "Enter", keyCode: 229 })).toBe(false);
  });

  it("treats Shift+Enter as a newline unless the caller opts in", () => {
    const event = { key: "Enter", shiftKey: true, nativeEvent: { isComposing: false } };
    expect(isSubmitKey(event)).toBe(false);
    expect(isSubmitKey(event, { allowShift: true })).toBe(true);
  });

  it("ignores keys other than Enter", () => {
    expect(isSubmitKey({ key: "a" })).toBe(false);
    expect(isSubmitKey(null)).toBe(false);
  });
});
