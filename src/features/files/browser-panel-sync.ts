export interface BrowserDockPanel {
  id: string;
  tabId?: string;
}

export function createBrowserTabSnapshotGate<T>(
  applySnapshot: (tabs: T[]) => void
) {
  let receivedEvent = false;
  return {
    acceptEvent(tabs: T[]) {
      receivedEvent = true;
      applySnapshot(tabs);
    },
    acceptInitial(tabs: T[]) {
      if (!receivedEvent) applySnapshot(tabs);
    },
  };
}

export function findBrowserPanelsToClose(
  runtimeTabIds: ReadonlySet<string>,
  previouslyRegisteredTabIds: ReadonlySet<string>,
  panels: readonly BrowserDockPanel[]
): string[] {
  return panels
    .filter(
      (panel) =>
        panel.id.startsWith("browser:") &&
        typeof panel.tabId === "string" &&
        previouslyRegisteredTabIds.has(panel.tabId) &&
        !runtimeTabIds.has(panel.tabId)
    )
    .map((panel) => panel.id);
}
