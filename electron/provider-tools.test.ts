import { describe, expect, it } from "vitest";
import { usesDeepSeekWebSearch } from "../src/shared/ai-config";
import { injectDeepSeekWebSearch } from "./provider-tools";

describe("DeepSeek native web search", () => {
  it("is enabled only for the DeepSeek Responses preset", () => {
    expect(
      usesDeepSeekWebSearch({
        preset: "deepseek",
        api: "openai-responses",
      })
    ).toBe(true);
    expect(
      usesDeepSeekWebSearch({
        preset: "deepseek",
        api: "openai-completions",
      })
    ).toBe(false);
    expect(
      usesDeepSeekWebSearch({
        preset: "custom",
        api: "openai-responses",
      })
    ).toBe(false);
  });

  it("appends the server tool without changing function tools", () => {
    const payload = {
      model: "deepseek-v4-flash",
      tools: [{ type: "function", name: "read" }],
    };

    expect(injectDeepSeekWebSearch(payload)).toEqual({
      model: "deepseek-v4-flash",
      tools: [
        { type: "function", name: "read" },
        { type: "web_search" },
      ],
    });
    expect(payload.tools).toEqual([{ type: "function", name: "read" }]);
  });

  it("does not duplicate unversioned or versioned search tools", () => {
    const unversioned = { tools: [{ type: "web_search" }] };
    const versioned = { tools: [{ type: "web_search_2025_08_26" }] };

    expect(injectDeepSeekWebSearch(unversioned)).toBe(unversioned);
    expect(injectDeepSeekWebSearch(versioned)).toBe(versioned);
  });

  it("creates a tool list when the Responses payload has none", () => {
    expect(
      injectDeepSeekWebSearch({ model: "deepseek-v4-flash", stream: true })
    ).toEqual({
      model: "deepseek-v4-flash",
      stream: true,
      tools: [{ type: "web_search" }],
    });
  });
});
