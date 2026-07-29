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

  it("never reuses an element reference after a new snapshot", async () => {
    const frame = {
      frameTreeNodeId: 9,
      url: "https://example.com/",
      framesInSubtree: [],
      executeJavaScript: vi
        .fn()
        .mockResolvedValueOnce({
          title: "First",
          url: "https://example.com/",
          text: "",
          elements: [{ localRef: "9:1", role: "button", name: "First" }],
        })
        .mockResolvedValueOnce({
          title: "Second",
          url: "https://example.com/",
          text: "",
          elements: [{ localRef: "9:1", role: "button", name: "Second" }],
        }),
    };
    const contents = webContents(32, { mainFrame: frame });
    const browser = new BrowserControlModule({
      resolveWebContents: () => contents,
      validateWebContents: () => true,
    });
    browser.registerTab({
      tabId: "browser:stable-refs",
      webContentsId: 32,
      title: "Example",
      url: "https://example.com/",
      active: true,
      loading: false,
    });

    const first = await browser.snapshot({ tabId: "browser:stable-refs" });
    const second = await browser.snapshot({ tabId: "browser:stable-refs" });

    expect(first.frames[0]?.elements[0]?.ref).toBe("@e1");
    expect(second.frames[0]?.elements[0]?.ref).toBe("@e2");
    await expect(
      browser.act({
        tabId: "browser:stable-refs",
        action: "click",
        ref: "@e1",
      })
    ).rejects.toThrow("重新读取页面快照");
  });

  it("does not guess a sole unmentioned tab as the default target", async () => {
    const contents = webContents(33);
    const browser = new BrowserControlModule({
      resolveWebContents: () => contents,
      validateWebContents: () => true,
    });
    browser.registerTab({
      tabId: "browser:only",
      webContentsId: 33,
      title: "Only",
      url: "https://example.com/",
      active: true,
      loading: false,
    });

    await expect(browser.snapshot({})).rejects.toThrow("指定 tabId");
  });

  it("reads child frames and the Chromium accessibility tree", async () => {
    const child = {
      frameTreeNodeId: 11,
      url: "https://embed.example.com/",
      framesInSubtree: [],
      executeJavaScript: vi.fn().mockResolvedValue({
        title: "Embed",
        url: "https://embed.example.com/",
        text: "Child frame",
        elements: [
          { localRef: "11:1", role: "link", name: "Embedded link" },
        ],
      }),
    };
    const mainFrame = {
      frameTreeNodeId: 10,
      url: "https://example.com/",
      framesInSubtree: [child],
      executeJavaScript: vi.fn().mockResolvedValue({
        title: "Main",
        url: "https://example.com/",
        text: "Main frame",
        elements: [{ localRef: "10:1", role: "button", name: "Continue" }],
      }),
    };
    const contents = webContents(35, {
      mainFrame,
      debugger: {
        isAttached: () => false,
        attach: vi.fn(),
        detach: vi.fn(),
        sendCommand: vi.fn().mockResolvedValue({
          nodes: [
            {
              role: { value: "heading" },
              name: { value: "Accessible title" },
            },
          ],
        }),
      },
    });
    const browser = new BrowserControlModule({
      resolveWebContents: () => contents,
      validateWebContents: () => true,
    });
    browser.registerTab({
      tabId: "browser:frames",
      webContentsId: 35,
      title: "Frames",
      url: "https://example.com/",
      active: true,
      loading: false,
    });

    const snapshot = await browser.snapshot({ tabId: "browser:frames" });
    expect(snapshot.frames).toHaveLength(2);
    expect(snapshot.frames.flatMap((frame) => frame.elements)).toEqual([
      expect.objectContaining({ ref: "@e1", name: "Continue" }),
      expect.objectContaining({ ref: "@e2", name: "Embedded link" }),
    ]);
    expect(snapshot.accessibility).toEqual([
      { role: "heading", name: "Accessible title" },
    ]);
  });

  it("requires read-only approval before changing tab state", async () => {
    const requestApproval = vi.fn().mockResolvedValue(false);
    const requestTabCommand = vi.fn();
    const browser = new BrowserControlModule({
      resolveWebContents: () => webContents(34),
      validateWebContents: () => true,
      getApprovalMode: () => "read-only",
      requestApproval,
      requestTabCommand,
    });
    browser.registerTab({
      tabId: "browser:readonly",
      webContentsId: 34,
      title: "Read only",
      url: "https://example.com/",
      active: true,
      loading: false,
    });

    await expect(
      browser.manageTabs({
        action: "focus",
        tabId: "browser:readonly",
      })
    ).rejects.toThrow("用户拒绝");
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "tab_focus",
        reason: "read-only",
      })
    );
    expect(requestTabCommand).not.toHaveBeenCalled();
  });

  it("runs sensitive actions without asking in always-allow mode", async () => {
    const requestApproval = vi.fn();
    const contents = webContents(36, {
      executeJavaScript: vi.fn().mockResolvedValue({ ok: true }),
    });
    const browser = new BrowserControlModule({
      resolveWebContents: () => contents,
      validateWebContents: () => true,
      getApprovalMode: () => "always-allow",
      requestApproval,
    });
    browser.registerTab({
      tabId: "browser:always",
      webContentsId: 36,
      title: "Always",
      url: "https://example.com/",
      active: true,
      loading: false,
    });

    await browser.act({
      tabId: "browser:always",
      action: "evaluate",
      script: "({ ok: true })",
    });
    expect(requestApproval).not.toHaveBeenCalled();
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
