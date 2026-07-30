import { describe, expect, it } from "vitest";
import {
  BrowserHistory,
  BrowserStyleStore,
  resolveAddress,
} from "./browser-intelligence";

describe("local address-bar intelligence", () => {
  it("ranks matching open tabs before pinned and recent history without duplicates", () => {
    const history = new BrowserHistory();
    history.recordVisit({ url: "https://docs.test/old", title: "Docs old", visitedAt: 10 });
    history.recordVisit({ url: "https://docs.test/new", title: "Docs new", visitedAt: 20 });

    const result = history.suggest("docs", [
      {
        tabId: "open-docs",
        url: "https://docs.test/new",
        title: "Current docs",
        pinned: false,
      },
    ]);

    expect(result.map((entry) => entry.kind)).toEqual(["tab", "history"]);
    expect(result[0]).toMatchObject({ tabId: "open-docs" });
    expect(result[1]).toMatchObject({ url: "https://docs.test/old" });
  });

  it("supports disabled history, entry deletion and time-range clearing", () => {
    const history = new BrowserHistory();
    history.recordVisit({ url: "https://a.test", title: "A", visitedAt: 10 });
    history.recordSearch("alpha", 20);
    history.delete("https://a.test");
    history.clear({ since: 15, until: 25 });
    history.enabled = false;
    history.recordVisit({ url: "https://ignored.test", title: "Ignored", visitedAt: 30 });

    expect(history.suggest("", [])).toEqual([]);
    expect(history.snapshot()).toMatchObject({ visits: [], searches: [] });
  });

  it("uses built-in and validated custom search templates", () => {
    expect(resolveAddress("mailuo agent", { provider: "duckduckgo" })).toBe(
      "https://duckduckgo.com/?q=mailuo%20agent"
    );
    expect(
      resolveAddress("mailuo agent", {
        provider: "custom",
        customTemplate: "https://search.test/?term=%s",
      })
    ).toBe("https://search.test/?term=mailuo%20agent");
    expect(() =>
      resolveAddress("query", { provider: "custom", customTemplate: "https://search.test/" })
    ).toThrow("必须包含 %s");
  });
});

describe("local browser styles", () => {
  it("matches enabled global, domain and URL rules and supports live removal", () => {
    const styles = new BrowserStyleStore();
    const global = styles.add({ name: "global", scope: "all", css: "body{line-height:1.6}" });
    styles.add({
      name: "domain",
      scope: "domain",
      pattern: "example.com",
      css: "article{max-width:70ch}",
    });
    styles.add({
      name: "page",
      scope: "url",
      pattern: "https://example.com/docs/*",
      css: "nav{display:none}",
    });

    expect(styles.match("https://example.com/docs/start").map((rule) => rule.name)).toEqual([
      "global",
      "domain",
      "page",
    ]);
    styles.update(global.id, { enabled: false });
    styles.remove(global.id);
    expect(styles.list()).toHaveLength(2);
  });
});
