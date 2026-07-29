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
  cleanElectronUserAgent,
  isExternalBrowserProtocol,
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
});
