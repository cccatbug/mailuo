import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: vi.fn(() => "/tmp/mailuo-test") },
  BaseWindow: class {},
  BrowserWindow: class {},
  WebContentsView: class {},
  dialog: { showMessageBox: vi.fn() },
  session: { fromPartition: vi.fn() },
  shell: { openExternal: vi.fn() },
}));

import {
  BROWSER_PARTITION,
  BrowserSessionManager,
  cleanElectronUserAgent,
  isExternalBrowserProtocol,
  shouldKeepBrowserPopup,
} from "./browser-session";

describe("browser session compatibility", () => {
  it("removes Electron and application tokens without changing Chromium", () => {
    expect(
      cleanElectronUserAgent(
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) mailuo/0.1.5 Chrome/144.0.7559.61 Electron/43.2.0 Safari/537.36"
      )
    ).toBe(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.7559.61 Safari/537.36"
    );
  });

  it("keeps browser navigations internal and routes application schemes externally", () => {
    for (const url of [
      "https://sso.example.com/login",
      "http://localhost:3000/callback",
      "about:blank",
      "blob:https://example.com/id",
    ]) {
      expect(isExternalBrowserProtocol(url), url).toBe(false);
    }
    for (const url of [
      "weixin://scan/result",
      "intent://login#Intent;scheme=demo;end",
      "mailto:hello@example.com",
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isExternalBrowserProtocol(url), url).toBe(true);
    }
  });

  it("keeps featureless CAS/OAuth windows in the shared persistent session", () => {
    let openHandler:
      | ((details: { url: string; disposition: string }) => {
          action: string;
          overrideBrowserWindowOptions?: Electron.BrowserWindowConstructorOptions;
        })
      | undefined;
    const contents = {
      id: 42,
      setBackgroundThrottling: vi.fn(),
      setWindowOpenHandler: vi.fn((handler) => {
        openHandler = handler;
      }),
      on: vi.fn(),
      once: vi.fn(),
      isDestroyed: vi.fn(() => false),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        goBack: vi.fn(),
      },
    };
    new BrowserSessionManager().configureContents(contents as never);

    for (const disposition of ["default", "foreground-tab", "new-window"]) {
      const response = openHandler?.({
        url: "https://cas.example.com/login",
        disposition,
      });
      expect(response?.action).toBe("allow");
      expect(response?.overrideBrowserWindowOptions?.webPreferences?.partition).toBe(
        BROWSER_PARTITION
      );
      expect(typeof (response as { createWindow?: unknown })?.createWindow).toBe("function");
    }
  });

  it("distinguishes authentication popups from ordinary documents", () => {
    expect(
      shouldKeepBrowserPopup({
        url: "https://mi.feishu.cn/docx/position-api",
        frameName: "_blank",
      })
    ).toBe(false);
    expect(
      shouldKeepBrowserPopup({ url: "https://cas.example.com/login" })
    ).toBe(true);
    expect(
      shouldKeepBrowserPopup({
        url: "https://accounts.example.com/authorize?client_id=mailuo",
      })
    ).toBe(true);
    expect(shouldKeepBrowserPopup({ url: "about:blank" })).toBe(true);
  });

  it("routes ordinary document windows into an internal browser tab", () => {
    let openHandler:
      | ((details: { url: string; disposition: string }) => {
          action: string;
        })
      | undefined;
    const send = vi.fn();
    const manager = new BrowserSessionManager();
    Object.assign(manager, {
      getParentWindow: () => ({ webContents: { send } }),
    });
    const contents = {
      id: 43,
      setBackgroundThrottling: vi.fn(),
      setWindowOpenHandler: vi.fn((handler) => {
        openHandler = handler;
      }),
      on: vi.fn(),
      once: vi.fn(),
      isDestroyed: vi.fn(() => false),
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        goBack: vi.fn(),
      },
    };
    manager.configureContents(contents as never);

    const url = "https://mi.feishu.cn/docx/position-api";
    const response = openHandler?.({ url, disposition: "new-window" });

    expect(response?.action).toBe("deny");
    expect(send).toHaveBeenCalledWith("browser:open-tab", url);
  });

  it("updates custom CSS in open pages and reapplies it after navigation", async () => {
    const listeners = new Map<string, () => void>();
    let key = 0;
    const insertCSS = vi.fn(async () => `css-${++key}`);
    const removeInsertedCSS = vi.fn(async () => undefined);
    const contents = {
      id: 44,
      setBackgroundThrottling: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: () => void) =>
        listeners.set(event, listener)
      ),
      off: vi.fn(),
      once: vi.fn(),
      isDestroyed: vi.fn(() => false),
      insertCSS,
      removeInsertedCSS,
      navigationHistory: {
        canGoBack: vi.fn(() => false),
        goBack: vi.fn(),
      },
    };
    const manager = new BrowserSessionManager();
    manager.configureContents(contents as never);

    await manager.setCustomCss("body { font-family: serif !important; }");
    expect(insertCSS).toHaveBeenLastCalledWith(
      "body { font-family: serif !important; }",
      { cssOrigin: "user" }
    );

    listeners.get("did-finish-load")?.();
    await vi.waitFor(() => expect(insertCSS).toHaveBeenCalledTimes(2));
    expect(removeInsertedCSS).toHaveBeenCalledWith("css-1");

    await manager.setCustomCss("");
    expect(removeInsertedCSS).toHaveBeenCalledWith("css-2");
  });
});
