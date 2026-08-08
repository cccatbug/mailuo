import { describe, expect, it, vi } from "vitest";
import {
  reportWindowLoadError,
  safeSendToWindow,
  sendPiResourceProgress,
  showWindowWhenReady,
} from "./window-lifecycle";

const event = {
  type: "progress" as const,
  action: "install" as const,
  source: "npm:test",
  message: "installing",
};

describe("window lifecycle event forwarding", () => {
  it("drops ready-to-show when the BrowserWindow is destroyed during the callback", () => {
    const target = {
      isDestroyed: () => false,
      show: () => {
        throw new Error("Object has been destroyed");
      },
    };

    expect(() => showWindowWhenReady(target)).not.toThrow();
  });

  it("does not report a destroyed-window load rejection", () => {
    const error = new Error("Object has been destroyed");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    reportWindowLoadError(error);

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("drops progress when destruction races the preflight check", () => {
    const destroyedWindow = {
      isDestroyed: () => false,
      get webContents(): never {
        throw new Error("Object has been destroyed");
      },
    };

    expect(() => safeSendToWindow(destroyedWindow as never, "test", event)).not.toThrow();
  });

  it("drops assistant events after WebContents has been destroyed", () => {
    const destroyedContents = {
      isDestroyed: () => false,
      send: () => {
        throw new Error("Object has been destroyed");
      },
    };

    expect(() => safeSendToWindow({
      isDestroyed: () => false,
      webContents: destroyedContents,
    }, "assistant:event", event)).not.toThrow();
  });

  it("drops progress after the BrowserWindow has been destroyed", () => {
    const send = vi.fn();
    const destroyedWindow = {
      isDestroyed: () => true,
      get webContents(): never {
        throw new Error("Object has been destroyed");
      },
    };

    expect(() =>
      sendPiResourceProgress(destroyedWindow as never, event)
    ).not.toThrow();
    expect(send).not.toHaveBeenCalled();
  });
});
