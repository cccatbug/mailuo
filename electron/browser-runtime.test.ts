import { describe, expect, it, vi } from "vitest";
import {
  BrowserRuntime,
  type BrowserPage,
  type BrowserRuntimeState,
} from "./browser-runtime";

function page(url = "https://example.com/"): BrowserPage {
  return {
    loadURL: vi.fn(async () => undefined),
    goBack: vi.fn(),
    goForward: vi.fn(),
    reload: vi.fn(),
    executeJavaScript: vi.fn(async (script: string) => ({ script })),
    capturePage: vi.fn(async () => "data:image/png;base64,c2NyZWVu"),
    insertCSS: vi.fn(async () => "style-key"),
    removeInsertedCSS: vi.fn(async () => undefined),
    sendInputEvent: vi.fn(),
    getURL: vi.fn(() => url),
  };
}

describe("application browser runtime", () => {
  it("keeps stable tab identity while live metadata and activation change", () => {
    const runtime = new BrowserRuntime();
    const first = runtime.createTab({ url: "https://one.test", page: page() });
    const second = runtime.createTab({ url: "https://two.test", page: page() });

    runtime.updateTab(first.tabId, {
      title: "Live title",
      url: "https://one.test/after-navigation",
      favicon: "https://one.test/favicon.ico",
      audible: true,
    });
    runtime.activateTab(second.tabId);
    runtime.activateTab(first.tabId);

    expect(runtime.getTab(first.tabId)).toMatchObject({
      tabId: first.tabId,
      title: "Live title",
      url: "https://one.test/after-navigation",
      favicon: "https://one.test/favicon.ico",
      audible: true,
      active: true,
    });
  });

  it("restores public tab structure with fresh page attachments", () => {
    const persisted: BrowserRuntimeState = {
      tabs: [
        { tabId: "stable-a", url: "https://a.test", title: "A", pinned: true, group: "work" },
        { tabId: "stable-b", url: "https://b.test", title: "B", pinned: false },
      ],
      activeTabId: "stable-b",
    };
    const runtime = BrowserRuntime.restore(persisted);

    expect(runtime.snapshot()).toEqual(persisted);
    expect(runtime.getTab("stable-b")?.attached).toBe(false);

    runtime.attachPage("stable-b", page("https://b.test"));
    expect(runtime.getTab("stable-b")?.attached).toBe(true);
  });

  it("fails explicitly when a tool targets a closed tab", async () => {
    const runtime = new BrowserRuntime();
    const tab = runtime.createTab({ url: "https://closed.test", page: page() });
    runtime.closeTab(tab.tabId);

    await expect(runtime.executeTool("read", { tabId: tab.tabId })).rejects.toThrow(
      `浏览器标签页 ${tab.tabId} 已关闭`
    );
  });

  it("runs navigation, observation, interaction, script and screenshot tools without activating the tab", async () => {
    const runtime = new BrowserRuntime();
    const backgroundPage = page();
    const foreground = runtime.createTab({ url: "https://front.test", page: page() });
    const background = runtime.createTab({ url: "https://back.test", page: backgroundPage });
    runtime.activateTab(foreground.tabId);

    await runtime.executeTool("navigate", { tabId: background.tabId, url: "https://next.test" });
    await runtime.executeTool("read", { tabId: background.tabId, mode: "text" });
    await runtime.executeTool("click", { tabId: background.tabId, selector: "#submit" });
    await runtime.executeTool("type", { tabId: background.tabId, selector: "#query", text: "hello" });
    await runtime.executeTool("javascript", { tabId: background.tabId, script: "document.title" });
    await runtime.executeTool("screenshot", { tabId: background.tabId });

    expect(runtime.snapshot().activeTabId).toBe(foreground.tabId);
    expect(backgroundPage.loadURL).toHaveBeenCalledWith("https://next.test");
    expect(backgroundPage.executeJavaScript).toHaveBeenCalledTimes(4);
    expect(backgroundPage.capturePage).toHaveBeenCalled();
  });

  it("places user-created pages beside their source using browser disposition", () => {
    const runtime = new BrowserRuntime();
    const source = runtime.createTab({ url: "https://source.test", page: page() });

    const direct = runtime.openPage({
      sourceTabId: source.tabId,
      url: "https://direct.test",
      disposition: "new-window",
      userGesture: true,
    });
    const modified = runtime.openPage({
      sourceTabId: source.tabId,
      url: "https://background.test",
      disposition: "background-tab",
      userGesture: true,
    });
    const scripted = runtime.openPage({
      sourceTabId: source.tabId,
      url: "https://script.test",
      disposition: "new-window",
      userGesture: false,
    });

    expect(direct.active).toBe(true);
    expect(modified.active).toBe(false);
    expect(scripted.active).toBe(false);
    expect(runtime.listTabs().map((tab) => tab.tabId)).toEqual([
      source.tabId,
      scripted.tabId,
      modified.tabId,
      direct.tabId,
    ]);
  });
});
