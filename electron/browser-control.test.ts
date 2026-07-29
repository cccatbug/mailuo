import { describe, expect, it, vi } from "vitest";
import {
  BrowserControlModule,
  type BrowserControlWebContents,
} from "./browser-control";

function webContents(
  id: number,
  overrides: Partial<BrowserControlWebContents> = {}
): BrowserControlWebContents {
  return {
    id,
    getType: () => "webview",
    isDestroyed: () => false,
    getURL: () => "https://example.com/",
    getTitle: () => "Example",
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn(),
    },
    mainFrame: {
      frameTreeNodeId: 1,
      url: "https://example.com/",
      framesInSubtree: [],
      executeJavaScript: vi.fn(),
    },
    executeJavaScript: vi.fn(),
    loadURL: vi.fn(),
    reload: vi.fn(),
    stop: vi.fn(),
    capturePage: vi.fn(),
    printToPDF: vi.fn(),
    sendInputEvent: vi.fn(),
    enableDeviceEmulation: vi.fn(),
    disableDeviceEmulation: vi.fn(),
    debugger: {
      isAttached: () => false,
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(),
    },
    ...overrides,
  };
}

describe("BrowserControlModule tab lifecycle", () => {
  it("lists a stable tab after its ephemeral webContents id is rebound", () => {
    const contents = new Map<number, BrowserControlWebContents>([
      [11, webContents(11)],
      [12, webContents(12, { getTitle: () => "Reloaded" })],
    ]);
    const browser = new BrowserControlModule({
      resolveWebContents: (id) => contents.get(id),
      validateWebContents: () => true,
    });

    browser.registerTab({
      tabId: "browser:stable",
      webContentsId: 11,
      title: "Example",
      url: "https://example.com/",
      active: true,
      loading: false,
    });
    browser.registerTab({
      tabId: "browser:stable",
      webContentsId: 12,
      title: "Reloaded",
      url: "https://example.com/reloaded",
      active: true,
      loading: false,
    });

    expect(browser.listTabs()).toEqual([
      expect.objectContaining({
        id: "browser:stable",
        title: "Reloaded",
        url: "https://example.com/reloaded",
        active: true,
      }),
    ]);
  });

  it("rejects registration when the guest does not belong to the app browser", () => {
    const browser = new BrowserControlModule({
      resolveWebContents: () => webContents(20),
      validateWebContents: () => false,
    });

    expect(() =>
      browser.registerTab({
        tabId: "browser:foreign",
        webContentsId: 20,
        title: "Foreign",
        url: "https://example.com/",
        active: false,
        loading: false,
      })
    ).toThrow("不属于脉络内置浏览器");
  });

  it("invalidates element references after navigation", async () => {
    const frame = {
      frameTreeNodeId: 7,
      url: "https://example.com/",
      framesInSubtree: [],
      executeJavaScript: vi
        .fn()
        .mockResolvedValueOnce({
          title: "Example",
          url: "https://example.com/",
          text: "Readable",
          elements: [{ localRef: "1", role: "button", name: "Continue" }],
        })
        .mockResolvedValueOnce({ ok: true }),
    };
    const contents = webContents(31, { mainFrame: frame });
    const browser = new BrowserControlModule({
      resolveWebContents: () => contents,
      validateWebContents: () => true,
    });
    browser.registerTab({
      tabId: "browser:refs",
      webContentsId: 31,
      title: "Example",
      url: "https://example.com/",
      active: true,
      loading: false,
    });

    const snapshot = await browser.snapshot({ tabId: "browser:refs" });
    expect(snapshot.frames[0]?.elements[0]?.ref).toBe("@e1");

    browser.updateTab("browser:refs", {
      url: "https://example.com/next",
      navigation: true,
    });

    await expect(
      browser.act({
        tabId: "browser:refs",
        action: "click",
        ref: "@e1",
      })
    ).rejects.toThrow("重新读取页面快照");
  });

  it("requires approval before activating a submit control", async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);
    const frame = {
      frameTreeNodeId: 8,
      url: "https://example.com/form",
      framesInSubtree: [],
      executeJavaScript: vi.fn().mockResolvedValueOnce({
        title: "Form",
        url: "https://example.com/form",
        text: "",
        elements: [
          {
            localRef: "1",
            role: "button",
            name: "提交",
            type: "submit",
          },
        ],
      }),
    };
    const browser = new BrowserControlModule({
      resolveWebContents: () => webContents(40, { mainFrame: frame }),
      validateWebContents: () => true,
      requestApproval,
    });
    browser.registerTab({
      tabId: "browser:form",
      webContentsId: 40,
      title: "Form",
      url: "https://example.com/form",
      active: true,
      loading: false,
    });
    await browser.snapshot({ tabId: "browser:form" });

    await expect(
      browser.act({
        tabId: "browser:form",
        action: "click",
        ref: "@e1",
      })
    ).rejects.toThrow("用户拒绝");
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        tabId: "browser:form",
        action: "click",
      })
    );
    expect(frame.executeJavaScript).toHaveBeenCalledTimes(1);
  });

  it("keeps only the most recent 200 console entries", async () => {
    const browser = new BrowserControlModule({
      resolveWebContents: () => webContents(50),
      validateWebContents: () => true,
    });
    browser.registerTab({
      tabId: "browser:logs",
      webContentsId: 50,
      title: "Logs",
      url: "https://example.com/",
      active: true,
      loading: false,
    });
    for (let index = 0; index < 205; index += 1) {
      browser.addConsoleEntry(50, {
        timestamp: index,
        text: `entry-${index}`,
      });
    }

    const result = await browser.capture({
      tabId: "browser:logs",
      action: "console",
    });
    expect(result).toMatchObject({ kind: "text" });
    if (result.kind !== "text" || !Array.isArray(result.data)) return;
    expect(result.data).toHaveLength(200);
    expect(result.data[0]).toMatchObject({ text: "entry-5" });
  });
});
