import { describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
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

  it("provides localized close labels in Chinese and English", () => {
    expect(i18n.getFixedT("zh-CN")("dock.closeOthers")).toBe("关闭其他");
    expect(i18n.getFixedT("en")("dock.closeAll")).toBe("Close All");
  });
});
