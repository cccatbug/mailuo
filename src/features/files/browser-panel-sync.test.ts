import { describe, expect, it } from "vitest";
import { findBrowserPanelsToClose } from "./browser-panel-sync";

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
});
