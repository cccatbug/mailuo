import { describe, expect, it } from "vitest";
import {
  createBrowserTabSnapshotGate,
  findBrowserPanelsToClose,
} from "./browser-panel-sync";

describe("browser panel/runtime synchronization", () => {
  it("keeps a newly opened panel alive while its WebContents is registering", () => {
    const pendingTabId = "pending-google-tab";

    expect(
      findBrowserPanelsToClose(new Set(), new Set(), [
        {
          id: `browser:${pendingTabId}`,
          tabId: pendingTabId,
        },
      ])
    ).toEqual([]);
  });

  it("closes a panel after its previously registered runtime tab is removed", () => {
    const closedTabId = "closed-google-tab";

    expect(
      findBrowserPanelsToClose(new Set(), new Set([closedTabId]), [
        {
          id: `browser:${closedTabId}`,
          tabId: closedTabId,
        },
      ])
    ).toEqual([`browser:${closedTabId}`]);
  });

  it("ignores a stale initial snapshot that resolves after a runtime event", () => {
    const applied: string[][] = [];
    const gate = createBrowserTabSnapshotGate<string>((tabIds) =>
      applied.push([...tabIds])
    );

    gate.acceptEvent(["google-tab"]);
    gate.acceptInitial([]);

    expect(applied).toEqual([["google-tab"]]);
  });
});
