export type DockCloseMode = "current" | "others" | "all";

export interface ClosableDockPanel {
  id: string;
  close(): void;
}

export function closeDockPanels(
  panels: ClosableDockPanel[],
  currentId: string,
  mode: DockCloseMode
): void {
  for (const panel of panels) {
    if (mode === "current" && panel.id !== currentId) continue;
    if (mode === "others" && panel.id === currentId) continue;
    panel.close();
  }
}
