export interface BrowserDockPanel {
  id: string;
  tabId?: string;
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
