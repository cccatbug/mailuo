import {
  session,
  webContents,
  type BrowserWindow,
  type WebContents,
} from "electron";
import {
  BrowserControlModule,
  type BrowserControlWebContents,
} from "./browser-control";
import { BROWSER_PARTITION } from "./browser-session";
import type {
  BrowserAgentMode,
  BrowserApprovalRequest,
  BrowserApprovalResponse,
  BrowserTabCommand,
  BrowserTabCommandResult,
  BrowserTabInfo,
  BrowserTabRegistration,
  BrowserTabUpdate,
} from "../src/shared/browser";

interface PendingCommand {
  resolve(value: { tabId?: string }): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingApproval {
  resolve(value: boolean): void;
  timer: ReturnType<typeof setTimeout>;
  tabId: string;
}

class BrowserRuntime {
  readonly control: BrowserControlModule;

  private getWindow: () => BrowserWindow | null = () => null;
  private approvalMode: BrowserAgentMode = "confirm-sensitive";
  private readonly commands = new Map<string, PendingCommand>();
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly observedContents = new Set<number>();
  private networkInstalled = false;

  constructor() {
    this.control = new BrowserControlModule({
      resolveWebContents: (id) =>
        webContents.fromId(id) as unknown as
          | BrowserControlWebContents
          | undefined,
      validateWebContents: (candidate) => {
        const contents = candidate as unknown as WebContents;
        const host = this.getWindow()?.webContents;
        return (
          contents.getType() === "webview" &&
          contents.hostWebContents?.id === host?.id &&
          contents.session === session.fromPartition(BROWSER_PARTITION)
        );
      },
      requestTabCommand: (command) => this.requestTabCommand(command),
      requestApproval: (request) => this.requestApproval(request),
      getApprovalMode: () => this.approvalMode,
    });
  }

  initialize(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow;
    if (this.networkInstalled) return;
    this.networkInstalled = true;
    const browserSession = session.fromPartition(BROWSER_PARTITION);
    browserSession.webRequest.onCompleted((details) => {
      if (details.webContentsId === undefined) return;
      this.control.addNetworkEntry(details.webContentsId, {
        timestamp: details.timestamp,
        method: details.method,
        url: details.url,
        status: details.statusCode,
        text: `${details.method} ${details.statusCode} ${details.url}`,
      });
    });
    browserSession.webRequest.onErrorOccurred((details) => {
      if (details.webContentsId === undefined) return;
      this.control.addNetworkEntry(details.webContentsId, {
        timestamp: details.timestamp,
        method: details.method,
        url: details.url,
        text: `${details.method} ${details.error} ${details.url}`,
      });
    });
  }

  registerTab(registration: BrowserTabRegistration): BrowserTabInfo {
    const info = this.control.registerTab(registration);
    this.observeContents(registration.tabId, registration.webContentsId);
    this.broadcastTabs();
    return info;
  }

  updateTab(tabId: string, update: BrowserTabUpdate): BrowserTabInfo | null {
    const info = this.control.updateTab(tabId, update);
    this.broadcastTabs();
    return info;
  }

  unregisterTab(tabId: string, webContentsId?: number): void {
    this.control.unregisterTab(tabId, webContentsId);
    this.broadcastTabs();
  }

  commandTab(command: {
    action: "open" | "focus" | "close";
    tabId?: string;
    url?: string;
  }): Promise<{ tabId?: string }> {
    return this.requestTabCommand(command);
  }

  setApprovalMode(mode: BrowserAgentMode): void {
    this.approvalMode = mode;
  }

  settleTabCommand(result: BrowserTabCommandResult): void {
    const pending = this.commands.get(result.requestId);
    if (!pending) return;
    this.commands.delete(result.requestId);
    clearTimeout(pending.timer);
    if (result.ok) pending.resolve({ tabId: result.tabId });
    else pending.reject(new Error(result.error || "浏览器标签页命令失败"));
  }

  settleApproval(response: BrowserApprovalResponse): void {
    const pending = this.approvals.get(response.id);
    if (!pending) return;
    this.approvals.delete(response.id);
    clearTimeout(pending.timer);
    pending.resolve(response.allowed);
  }

  cancelPending(): void {
    for (const pending of this.commands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("浏览器窗口已关闭"));
    }
    this.commands.clear();
    for (const pending of this.approvals.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.approvals.clear();
  }

  private requestTabCommand(
    command: Omit<BrowserTabCommand, "requestId">
  ): Promise<{ tabId?: string }> {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return Promise.reject(new Error("工作区窗口不可用"));
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.commands.delete(requestId);
        reject(new Error("浏览器标签页命令超时"));
      }, 15_000);
      this.commands.set(requestId, { resolve, reject, timer });
      window.webContents.send("browser:tab-command", {
        requestId,
        ...command,
      } satisfies BrowserTabCommand);
    });
  }

  private requestApproval(request: BrowserApprovalRequest): Promise<boolean> {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return Promise.resolve(false);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.approvals.delete(request.id);
        resolve(false);
      }, 5 * 60_000);
      this.approvals.set(request.id, {
        resolve,
        timer,
        tabId: request.tabId,
      });
      window.webContents.send("browser:approval-request", request);
    });
  }

  private observeContents(tabId: string, webContentsId: number): void {
    if (this.observedContents.has(webContentsId)) return;
    const contents = webContents.fromId(webContentsId);
    if (!contents) return;
    this.observedContents.add(webContentsId);
    contents.on("console-message", (event, _level, message, _line, sourceId) => {
      this.control.addConsoleEntry(webContentsId, {
        timestamp: Date.now(),
        level: event.level,
        url: event.sourceId || sourceId,
        text: event.message || message,
      });
    });
    contents.once("destroyed", () => {
      this.observedContents.delete(webContentsId);
      this.control.unregisterTab(tabId, webContentsId);
      for (const [id, pending] of this.approvals) {
        if (pending.tabId !== tabId) continue;
        clearTimeout(pending.timer);
        pending.resolve(false);
        this.approvals.delete(id);
      }
      this.broadcastTabs();
    });
  }

  private broadcastTabs(): void {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) return;
    window.webContents.send("browser:tabs-changed", this.control.listTabs());
  }
}

export const BROWSER_RUNTIME = new BrowserRuntime();
export const BROWSER_CONTROL = BROWSER_RUNTIME.control;
