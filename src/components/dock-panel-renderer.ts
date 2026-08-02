export type DockPanelRenderer = "onlyWhenVisible" | "always";

interface DockPanelLike {
  id: string;
  api: {
    renderer: DockPanelRenderer;
    setRenderer(renderer: DockPanelRenderer): void;
  };
}

export function getDockPanelRenderer(component: string): DockPanelRenderer {
  if (component === "browser") return "always";
  return "onlyWhenVisible";
}

export function preserveRestoredBrowserPanels(panels: DockPanelLike[]): void {
  for (const panel of panels) {
    if (
      panel.id.startsWith("browser:") &&
      panel.api.renderer !== "always"
    ) {
      panel.api.setRenderer("always");
    }
  }
}
