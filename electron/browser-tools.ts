import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { WebContents } from "electron";
import { BrowserRuntime, type BrowserPage } from "./browser-runtime";

export const BROWSER_RUNTIME = new BrowserRuntime();
let requestTab: ((tabId: string, url: string) => void) | null = null;

export function setBrowserTabRequestHandler(
  handler: ((tabId: string, url: string) => void) | null
) {
  requestTab = handler;
}

export function electronBrowserPage(contents: WebContents): BrowserPage {
  return {
    loadURL: (url) => contents.loadURL(url).then(() => undefined),
    goBack: () => {
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    },
    goForward: () => {
      if (contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    },
    reload: () => contents.reload(),
    executeJavaScript: (script, userGesture) =>
      contents.executeJavaScript(script, userGesture),
    capturePage: () => contents.capturePage().then((image) => image.toDataURL()),
    insertCSS: (css) => contents.insertCSS(css),
    removeInsertedCSS: (key) => contents.removeInsertedCSS(key),
    sendInputEvent: (event) =>
      contents.sendInputEvent(
        event as unknown as Electron.KeyboardInputEvent
      ),
    getURL: () => contents.getURL(),
  };
}

function result(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value ?? { ok: true }, null, 2) }],
    details: {},
  };
}

const tabId = Type.String({ description: "Stable tabId from browser_tabs list" });

export const BROWSER_AGENT_TOOLS = [
  defineTool({
    name: "browser_tabs",
    label: "Browser Tabs",
    description: "List, create, activate, reorder, pin, or close built-in browser tabs.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("create"),
        Type.Literal("activate"),
        Type.Literal("reorder"),
        Type.Literal("pin"),
        Type.Literal("close"),
      ]),
      tabId: Type.Optional(tabId),
      url: Type.Optional(Type.String()),
      index: Type.Optional(Type.Number()),
      pinned: Type.Optional(Type.Boolean()),
    }),
    execute: async (_id, params) => {
      if (params.action === "list") return result(BROWSER_RUNTIME.listTabs());
      if (params.action === "create") {
        const tab = BROWSER_RUNTIME.createTab({
          url: params.url ?? "about:blank",
        });
        if (requestTab) {
          requestTab(tab.tabId, tab.url);
          return result(await BROWSER_RUNTIME.waitForAttachment(tab.tabId));
        }
        return result(tab);
      }
      if (!params.tabId) throw new Error("此操作需要 tabId");
      if (params.action === "activate") BROWSER_RUNTIME.activateTab(params.tabId);
      if (params.action === "reorder") BROWSER_RUNTIME.reorderTab(params.tabId, params.index ?? 0);
      if (params.action === "pin") BROWSER_RUNTIME.updateTab(params.tabId, { pinned: params.pinned ?? true });
      if (params.action === "close") BROWSER_RUNTIME.closeTab(params.tabId);
      return result(BROWSER_RUNTIME.getTab(params.tabId));
    },
  }),
  defineTool({
    name: "browser_navigate",
    label: "Browser Navigation",
    description: "Navigate a stable browser tab, go back/forward, refresh, or wait for page state.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("navigate"),
        Type.Literal("back"),
        Type.Literal("forward"),
        Type.Literal("refresh"),
        Type.Literal("wait"),
      ]),
      tabId,
      url: Type.Optional(Type.String()),
      expression: Type.Optional(Type.String()),
      timeout: Type.Optional(Type.Number()),
    }),
    execute: async (_id, params) =>
      result(await BROWSER_RUNTIME.executeTool(params.action, params)),
  }),
  defineTool({
    name: "browser_read",
    label: "Read Browser Page",
    description: "Read text, DOM, links, forms, title, URL, and selection from a stable browser tab.",
    parameters: Type.Object({
      tabId,
      mode: Type.Optional(
        Type.Union([
          Type.Literal("text"),
          Type.Literal("dom"),
          Type.Literal("links"),
          Type.Literal("forms"),
        ])
      ),
    }),
    execute: async (_id, params) =>
      result(await BROWSER_RUNTIME.executeTool("read", params)),
  }),
  defineTool({
    name: "browser_interact",
    label: "Interact With Browser Page",
    description: "Click, type, scroll, or send a key to a stable browser tab without activating it.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("click"),
        Type.Literal("type"),
        Type.Literal("scroll"),
        Type.Literal("key"),
      ]),
      tabId,
      selector: Type.Optional(Type.String()),
      text: Type.Optional(Type.String()),
      x: Type.Optional(Type.Number()),
      y: Type.Optional(Type.Number()),
      key: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) =>
      result(await BROWSER_RUNTIME.executeTool(params.action, params)),
  }),
  defineTool({
    name: "browser_javascript",
    label: "Run Browser JavaScript",
    description: "Execute arbitrary JavaScript in a stable built-in browser tab.",
    parameters: Type.Object({ tabId, script: Type.String() }),
    execute: async (_id, params) =>
      result(await BROWSER_RUNTIME.executeTool("javascript", params)),
  }),
  defineTool({
    name: "browser_screenshot",
    label: "Capture Browser Tab",
    description: "Capture a stable browser tab as a PNG data URL.",
    parameters: Type.Object({ tabId }),
    execute: async (_id, params) => {
      const dataUrl = String(
        await BROWSER_RUNTIME.executeTool("screenshot", params)
      );
      const match = /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(dataUrl);
      if (!match) throw new Error("标签页截图格式无效");
      return {
        content: [
          { type: "image" as const, mimeType: match[1], data: match[2] },
          {
            type: "text" as const,
            text: `Captured browser tab ${params.tabId}`,
          },
        ],
        details: {},
      };
    },
  }),
  defineTool({
    name: "browser_styles",
    label: "Browser Styles",
    description: "List, apply, or remove local CSS-only browser styles.",
    parameters: Type.Object({
      action: Type.Union([
        Type.Literal("list"),
        Type.Literal("apply"),
        Type.Literal("remove"),
      ]),
      styleId: Type.Optional(Type.String()),
      name: Type.Optional(Type.String()),
      scope: Type.Optional(
        Type.Union([Type.Literal("all"), Type.Literal("domain"), Type.Literal("url")])
      ),
      pattern: Type.Optional(Type.String()),
      css: Type.Optional(Type.String()),
    }),
    execute: async (_id, params) => {
      const action =
        params.action === "list"
          ? "styles.list"
          : params.action === "apply"
            ? "styles.apply"
            : "styles.remove";
      return result(
        await BROWSER_RUNTIME.executeTool(action, {
          ...params,
          enabled: true,
          scope: params.scope ?? "all",
          css: params.css ?? "",
        })
      );
    },
  }),
];

export const BROWSER_TOOL_NAMES = BROWSER_AGENT_TOOLS.map((tool) => tool.name);
