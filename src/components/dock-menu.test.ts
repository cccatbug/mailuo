import { describe, expect, it, vi } from "vitest";
import { closeDockPanels } from "./dock-menu";

describe("closeDockPanels", () => {
  it("closes only the requested peer set", () => {
    const panels = ["one", "two", "three"].map((id) => ({
      id,
      close: vi.fn(),
    }));

    closeDockPanels(panels, "two", "others");

    expect(panels[0].close).toHaveBeenCalledOnce();
    expect(panels[1].close).not.toHaveBeenCalled();
    expect(panels[2].close).toHaveBeenCalledOnce();
  });
});
