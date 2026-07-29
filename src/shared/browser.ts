export type BrowserTabId = string;

export type BrowserAgentMode =
  | "confirm-sensitive"
  | "always-allow"
  | "read-only";

export interface BrowserTabInfo {
  id: BrowserTabId;
  title: string;
  url: string;
  active: boolean;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserTabRegistration {
  tabId: BrowserTabId;
  webContentsId: number;
  title: string;
  url: string;
  active: boolean;
  loading: boolean;
}

export interface BrowserTabUpdate {
  title?: string;
  url?: string;
  active?: boolean;
  loading?: boolean;
  navigation?: boolean;
}

export interface BrowserSnapshotElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
}

export interface BrowserSnapshotFrame {
  frameId: number;
  url: string;
  title: string;
  text: string;
  elements: BrowserSnapshotElement[];
}

export interface BrowserAccessibilityNode {
  role: string;
  name: string;
  value?: string;
  description?: string;
}

export interface BrowserPageSnapshot {
  tab: BrowserTabInfo;
  generation: number;
  frames: BrowserSnapshotFrame[];
  accessibility: BrowserAccessibilityNode[];
}

export type BrowserActAction =
  | "goto"
  | "back"
  | "forward"
  | "reload"
  | "stop"
  | "click"
  | "double_click"
  | "hover"
  | "focus"
  | "fill"
  | "type"
  | "clear"
  | "press"
  | "select"
  | "check"
  | "uncheck"
  | "scroll"
  | "drag"
  | "upload"
  | "wait"
  | "dialog"
  | "evaluate";

export interface BrowserActRequest {
  tabId?: BrowserTabId;
  action: BrowserActAction;
  ref?: string;
  targetRef?: string;
  url?: string;
  value?: string;
  values?: string[];
  key?: string;
  text?: string;
  selector?: string;
  timeoutMs?: number;
  x?: number;
  y?: number;
  paths?: string[];
  script?: string;
  accept?: boolean;
}

export type BrowserCaptureAction =
  | "screenshot"
  | "full_screenshot"
  | "pdf"
  | "console"
  | "network"
  | "cookies"
  | "get_storage"
  | "set_storage"
  | "clear_storage"
  | "set_cookie"
  | "clear_cookies"
  | "set_device"
  | "reset_device";

export interface BrowserCaptureRequest {
  tabId?: BrowserTabId;
  action: BrowserCaptureAction;
  includeValues?: boolean;
  storage?: "local" | "session";
  key?: string;
  value?: string;
  cookie?: {
    url: string;
    name: string;
    value: string;
    domain?: string;
    path?: string;
    secure?: boolean;
    httpOnly?: boolean;
  };
  width?: number;
  height?: number;
  deviceScaleFactor?: number;
  mobile?: boolean;
}

export interface BrowserLogEntry {
  timestamp: number;
  level?: string;
  method?: string;
  url?: string;
  text: string;
  status?: number;
}

export type BrowserCaptureResult =
  | { kind: "text"; data: unknown }
  | { kind: "image"; data: string; mimeType: "image/png" }
  | { kind: "binary"; data: Uint8Array; mimeType: "application/pdf" };

export interface BrowserTabCommand {
  requestId: string;
  action: "open" | "focus" | "close";
  tabId?: BrowserTabId;
  url?: string;
}

export interface BrowserTabCommandResult {
  requestId: string;
  ok: boolean;
  tabId?: BrowserTabId;
  error?: string;
}

export interface BrowserApprovalRequest {
  id: string;
  tabId: BrowserTabId;
  tabTitle: string;
  action: string;
  target: string;
  reason: "sensitive" | "read-only";
}

export interface BrowserApprovalResponse {
  id: string;
  allowed: boolean;
}

export interface TaskMention {
  kind: "task";
  taskId: string;
  title: string;
}

export interface BrowserTabMention {
  kind: "browser-tab";
  tabId: BrowserTabId;
  title: string;
  url: string;
}

export type AssistantMention = TaskMention | BrowserTabMention;
