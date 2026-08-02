import { describe, expect, it, vi } from "vitest";
import {
  getDockPanelRenderer,
  preserveRestoredBrowserPanels,
} from "./dock-panel-renderer";

describe("dock panel renderer", () => {
  it("keeps browser panels connected while another tab is active", () => {
    expect(getDockPanelRenderer("browser")).toBe("always");
  });

  it("keeps the memory-saving renderer for ordinary panels", () => {
    expect(getDockPanelRenderer("tasks")).toBe("onlyWhenVisible");
  });

  it("upgrades browser panels restored from an older saved layout", () => {
    const setBrowserRenderer = vi.fn();
    const setTaskRenderer = vi.fn();

    preserveRestoredBrowserPanels([
      {
        id: "browser:restored",
        api: {
          renderer: "onlyWhenVisible",
          setRenderer: setBrowserRenderer,
        },
      },
      {
        id: "tasks",
        api: {
          renderer: "onlyWhenVisible",
          setRenderer: setTaskRenderer,
        },
      },
    ]);

    expect(setBrowserRenderer).toHaveBeenCalledWith("always");
    expect(setTaskRenderer).not.toHaveBeenCalled();
  });
});
