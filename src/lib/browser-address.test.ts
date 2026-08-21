import { describe, expect, it } from "vitest";
import {
  DEFAULT_HOMEPAGE,
  normalizeAddress,
} from "./browser-address";

describe("normalizeAddress", () => {
  it("defaults an empty input to the configured homepage", () => {
    expect(normalizeAddress("")).toBe(DEFAULT_HOMEPAGE);
    expect(normalizeAddress("  ")).toBe(DEFAULT_HOMEPAGE);
    expect(
      normalizeAddress("", { homepage: "https://start.qq.com" })
    ).toBe("https://start.qq.com");
  });

  it("keeps explicit schemes untouched", () => {
    expect(normalizeAddress("https://example.com/a?b=1")).toBe(
      "https://example.com/a?b=1"
    );
    expect(normalizeAddress("http://localhost:3000/callback")).toBe(
      "http://localhost:3000/callback"
    );
    expect(normalizeAddress("mailto:hello@example.com")).toBe(
      "mailto:hello@example.com"
    );
  });

  it("upgrades bare domains and localhost to https", () => {
    expect(normalizeAddress("example.com")).toBe("https://example.com");
    expect(normalizeAddress("docs.example.com/guide")).toBe(
      "https://docs.example.com/guide"
    );
    expect(normalizeAddress("localhost:3000")).toBe("https://localhost:3000");
    expect(normalizeAddress("127.0.0.1:8080/app")).toBe(
      "https://127.0.0.1:8080/app"
    );
  });

  it("falls back to the selected search engine for other input", () => {
    expect(normalizeAddress("hello world")).toBe(
      "https://www.google.com/search?q=hello%20world"
    );
    expect(
      normalizeAddress("hello world", { searchEngine: "bing" })
    ).toBe("https://www.bing.com/search?q=hello%20world");
    expect(
      normalizeAddress("脉络 任务", { searchEngine: "baidu" })
    ).toBe("https://www.baidu.com/s?wd=%E8%84%89%E7%BB%9C%20%E4%BB%BB%E5%8A%A1");
    expect(
      normalizeAddress("react", { searchEngine: "duckduckgo" })
    ).toBe("https://duckduckgo.com/?q=react");
  });

  it("ignores unknown search engine values", () => {
    expect(
      normalizeAddress("hello", { searchEngine: "yahoo" as never })
    ).toBe("https://www.google.com/search?q=hello");
  });
});
