import type {
  BrowserActRequest,
  BrowserAccessibilityNode,
  BrowserAgentMode,
  BrowserApprovalRequest,
  BrowserCaptureRequest,
  BrowserCaptureResult,
  BrowserLogEntry,
  BrowserPageSnapshot,
  BrowserSnapshotElement,
  BrowserSnapshotFrame,
  BrowserTabInfo,
  BrowserTabRegistration,
  BrowserTabUpdate,
} from "../src/shared/browser";

export interface BrowserControlFrame {
  frameTreeNodeId: number;
  url: string;
  framesInSubtree: BrowserControlFrame[];
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
}

export interface BrowserControlWebContents {
  id: number;
  getType(): string;
  isDestroyed(): boolean;
  getURL(): string;
  getTitle(): string;
  navigationHistory: {
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
  };
  mainFrame: BrowserControlFrame;
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
  loadURL(url: string): Promise<unknown>;
  reload(): void;
  stop(): void;
  capturePage(...args: unknown[]): Promise<unknown>;
  printToPDF(options: Record<string, unknown>): Promise<Uint8Array | Buffer>;
  sendInputEvent(event: Record<string, unknown>): void;
  enableDeviceEmulation(parameters: Record<string, unknown>): void;
  disableDeviceEmulation(): void;
  isDevToolsOpened?(): boolean;
  session?: {
    cookies: {
      get(filter: Record<string, unknown>): Promise<
        Array<Record<string, unknown>>
      >;
      set(details: Record<string, unknown>): Promise<void>;
      remove(url: string, name: string): Promise<void>;
    };
    clearStorageData(options?: Record<string, unknown>): Promise<void>;
  };
  debugger: {
    isAttached(): boolean;
    attach(version?: string): void;
    detach(): void;
    sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
  };
}

interface RegisteredTab extends BrowserTabRegistration {
  generation: number;
  nextRef: number;
  refs: Map<
    string,
    {
      frameId: number;
      localRef: string;
      role: string;
      name: string;
      type?: string;
    }
  >;
  console: BrowserLogEntry[];
  network: BrowserLogEntry[];
  agentDownloadDeadline: number;
}

export interface BrowserControlDependencies {
  resolveWebContents(id: number): BrowserControlWebContents | undefined;
  validateWebContents(contents: BrowserControlWebContents): boolean;
  requestTabCommand?(command: {
    action: "open" | "focus" | "close";
    tabId?: string;
    url?: string;
  }): Promise<{ tabId?: string }>;
  requestApproval?(request: BrowserApprovalRequest): Promise<boolean>;
  getApprovalMode?(): BrowserAgentMode;
}

interface RawSnapshotElement {
  localRef: string;
  role?: string;
  name?: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  type?: string;
}

interface RawFrameSnapshot {
  title?: string;
  url?: string;
  text?: string;
  elements?: RawSnapshotElement[];
}

const SNAPSHOT_SCRIPT = `(() => {
  const refPrefix = __MAILUO_FRAME_PREFIX__;
  const visible = (node) => {
    const style = getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const roleOf = (node) => node.getAttribute("role") ||
    ({A:"link",BUTTON:"button",INPUT:"textbox",TEXTAREA:"textbox",SELECT:"combobox",SUMMARY:"button"}[node.tagName] || node.tagName.toLowerCase());
  const nameOf = (node) => node.getAttribute("aria-label") ||
    node.getAttribute("title") || node.getAttribute("alt") ||
    (node.labels && node.labels[0] && node.labels[0].innerText) ||
    node.innerText || node.value || node.getAttribute("placeholder") || "";
  const selector = [
    "a[href]","button","input","textarea","select","summary",
    "[role]","[contenteditable=true]","[tabindex]:not([tabindex='-1'])"
  ].join(",");
  let index = 0;
  const elements = Array.from(document.querySelectorAll(selector))
    .filter(visible)
    .slice(0, 400)
    .map((node) => {
      const localRef = refPrefix + String(++index);
      node.setAttribute("data-mailuo-ref", localRef);
      return {
        localRef,
        role: roleOf(node),
        name: String(nameOf(node)).replace(/\\s+/g, " ").trim().slice(0, 240),
        value: "value" in node ? String(node.value).slice(0, 500) : undefined,
        disabled: Boolean(node.disabled || node.getAttribute("aria-disabled") === "true"),
        checked: "checked" in node ? Boolean(node.checked) : undefined,
        type: "type" in node ? String(node.type || "") || undefined : node.getAttribute("type") || undefined
      };
    });
  const root = document.querySelector("article,main,[role=main]") || document.body;
  return {
    title: document.title,
    url: location.href,
    text: String(root?.innerText || root?.textContent || "").replace(/\\n{3,}/g, "\\n\\n").trim().slice(0, 50000),
    elements
  };
})()`;

function normalizeRef(ref: string): string {
  return ref.startsWith("@") ? ref : `@${ref}`;
}

export class BrowserControlModule {
  private readonly tabs = new Map<string, RegisteredTab>();
  private defaultTabIds: string[] = [];

  constructor(private readonly deps: BrowserControlDependencies) {}

  setDefaultTabIds(tabIds: string[]): void {
    this.defaultTabIds = [...new Set(tabIds)];
  }

  registerTab(registration: BrowserTabRegistration): BrowserTabInfo {
    if (
      !registration.tabId.startsWith("browser:") ||
      !Number.isInteger(registration.webContentsId)
    ) {
      throw new Error("浏览器标签页注册信息无效");
    }
    const contents = this.deps.resolveWebContents(registration.webContentsId);
    if (!contents || contents.isDestroyed() || !this.deps.validateWebContents(contents)) {
      throw new Error("该页面不属于脉络内置浏览器");
    }
    const previous = this.tabs.get(registration.tabId);
    this.tabs.set(registration.tabId, {
      ...registration,
      generation: previous?.generation ?? 0,
      nextRef: previous?.nextRef ?? 0,
      refs: new Map(),
      console: previous?.console ?? [],
      network: previous?.network ?? [],
      agentDownloadDeadline: previous?.agentDownloadDeadline ?? 0,
    });
    return this.toInfo(this.tabs.get(registration.tabId)!);
  }

  unregisterTab(tabId: string, webContentsId?: number): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    if (webContentsId !== undefined && tab.webContentsId !== webContentsId) return;
    this.tabs.delete(tabId);
  }

  updateTab(tabId: string, update: BrowserTabUpdate): BrowserTabInfo | null {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    if (update.title !== undefined) tab.title = update.title;
    if (update.url !== undefined) tab.url = update.url;
    if (update.active !== undefined) tab.active = update.active;
    if (update.loading !== undefined) tab.loading = update.loading;
    if (update.navigation) {
      tab.generation += 1;
      tab.refs.clear();
    }
    return this.toInfo(tab);
  }

  listTabs(): BrowserTabInfo[] {
    return [...this.tabs.values()]
      .filter((tab) => {
        const contents = this.deps.resolveWebContents(tab.webContentsId);
        return contents && !contents.isDestroyed();
      })
      .map((tab) => this.toInfo(tab));
  }

  async manageTabs(input: {
    action: "list" | "open" | "focus" | "close";
    tabId?: string;
    url?: string;
  }): Promise<{ count: number; tabs: BrowserTabInfo[] }> {
    if (input.action === "list") {
      const tabs = this.listTabs();
      return { count: tabs.length, tabs };
    }
    if (input.action === "open" && input.url) {
      this.assertNavigableUrl(input.url);
    }
    if (!this.deps.requestTabCommand) {
      throw new Error("浏览器标签页命令尚未连接到工作区");
    }
    if (input.action !== "open" && !input.tabId) {
      throw new Error(`${input.action} 需要 tabId`);
    }
    await this.approveTabCommandIfNeeded(input);
    const result = await this.deps.requestTabCommand({
      action: input.action,
      ...(input.tabId ? { tabId: input.tabId } : {}),
      ...(input.url ? { url: input.url } : {}),
    });
    if (input.action === "open" && result.tabId) {
      const deadline = Date.now() + 3_000;
      while (
        Date.now() < deadline &&
        !this.listTabs().some((tab) => tab.id === result.tabId)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } else if (input.action === "close" && input.tabId) {
      const deadline = Date.now() + 3_000;
      while (
        Date.now() < deadline &&
        this.listTabs().some((tab) => tab.id === input.tabId)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    const tabs = this.listTabs();
    return { count: tabs.length, tabs };
  }

  addConsoleEntry(webContentsId: number, entry: BrowserLogEntry): void {
    this.appendBoundedLog(webContentsId, "console", entry);
  }

  addNetworkEntry(webContentsId: number, entry: BrowserLogEntry): void {
    this.appendBoundedLog(webContentsId, "network", entry);
  }

  consumeAgentDownloadTab(webContentsId: number): BrowserTabInfo | null {
    const tab = [...this.tabs.values()].find(
      (candidate) => candidate.webContentsId === webContentsId
    );
    if (!tab || tab.agentDownloadDeadline < Date.now()) return null;
    tab.agentDownloadDeadline = 0;
    return this.toInfo(tab);
  }

  async snapshot(input: { tabId?: string }): Promise<BrowserPageSnapshot> {
    const { tab, contents } = this.resolveTab(input.tabId);
    tab.generation += 1;
    tab.refs.clear();

    const rawFrames = [
      contents.mainFrame,
      ...contents.mainFrame.framesInSubtree,
    ];
    const uniqueFrames = [
      ...new Map(rawFrames.map((frame) => [frame.frameTreeNodeId, frame])).values(),
    ];
    let nextRef = tab.nextRef;
    const frames: BrowserSnapshotFrame[] = [];

    for (const frame of uniqueFrames) {
      try {
        const raw = (await frame.executeJavaScript(
          SNAPSHOT_SCRIPT.replace(
            "__MAILUO_FRAME_PREFIX__",
            JSON.stringify(`${frame.frameTreeNodeId}:`)
          )
        )) as RawFrameSnapshot;
        const elements: BrowserSnapshotElement[] = (raw.elements ?? []).map(
          (element) => {
            const ref = `@e${++nextRef}`;
            tab.refs.set(ref, {
              frameId: frame.frameTreeNodeId,
              localRef: element.localRef,
              role: element.role ?? "element",
              name: element.name ?? "",
              ...(element.type ? { type: element.type } : {}),
            });
            return {
              ref,
              role: element.role ?? "element",
              name: element.name ?? "",
              ...(element.value !== undefined ? { value: element.value } : {}),
              ...(element.disabled !== undefined
                ? { disabled: element.disabled }
                : {}),
              ...(element.checked !== undefined
                ? { checked: element.checked }
                : {}),
            };
          }
        );
        frames.push({
          frameId: frame.frameTreeNodeId,
          url: raw.url ?? frame.url,
          title: raw.title ?? "",
          text: raw.text ?? "",
          elements,
        });
      } catch {
        frames.push({
          frameId: frame.frameTreeNodeId,
          url: frame.url,
          title: "",
          text: "该 frame 当前不可读取。",
          elements: [],
        });
      }
    }
    tab.nextRef = nextRef;
    const accessibility = await this.readAccessibilityTree(contents);

    return {
      tab: this.toInfo(tab),
      generation: tab.generation,
      frames,
      accessibility,
    };
  }

  async act(request: BrowserActRequest): Promise<unknown> {
    const { tab, contents } = this.resolveTab(request.tabId);
    await this.approveIfNeeded(
      tab,
      request.action,
      request.action === "upload"
        ? request.paths?.join(", ") ?? request.ref ?? ""
        : request.ref ?? request.url ?? request.selector ?? "",
      this.isSensitiveAction(tab, request),
      request.action !== "wait"
    );
    if (contents.isDestroyed()) throw new Error("浏览器标签页已关闭");
    switch (request.action) {
      case "goto":
        if (!request.url) throw new Error("goto 需要 url");
        this.assertNavigableUrl(request.url);
        return contents.loadURL(request.url);
      case "back":
        contents.navigationHistory.goBack();
        return { ok: true };
      case "forward":
        contents.navigationHistory.goForward();
        return { ok: true };
      case "reload":
        contents.reload();
        return { ok: true };
      case "stop":
        contents.stop();
        return { ok: true };
      default:
        break;
    }

    if (request.action === "evaluate") {
      if (!request.script) throw new Error("evaluate 需要 script");
      return contents.executeJavaScript(request.script, true);
    }
    if (request.action === "dialog") {
      return this.withDebugger(contents, (debuggerApi) =>
        debuggerApi.sendCommand("Page.handleJavaScriptDialog", {
          accept: request.accept !== false,
          ...(request.value ? { promptText: request.value } : {}),
        })
      );
    }
    if (request.action === "wait") {
      return this.waitFor(contents, request);
    }
    if (request.action === "scroll" && !request.ref) {
      return contents.executeJavaScript(
        `window.scrollBy({left:${Number(request.x ?? 0)},top:${Number(request.y ?? 500)},behavior:"smooth"});({ok:true})`,
        true
      );
    }

    if (!request.ref) {
      throw new Error(`${request.action} 需要页面元素 ref`);
    }
    const resolved = tab.refs.get(normalizeRef(request.ref));
    if (!resolved) {
      throw new Error("页面元素引用已失效，请重新读取页面快照");
    }
    const frames = [
      contents.mainFrame,
      ...contents.mainFrame.framesInSubtree,
    ];
    const frame = frames.find(
      (candidate) => candidate.frameTreeNodeId === resolved.frameId
    );
    if (!frame) {
      throw new Error("目标 frame 已失效，请重新读取页面快照");
    }
    if (request.action === "upload") {
      if (!request.paths?.length) throw new Error("upload 需要 paths");
      return this.uploadFiles(contents, resolved.localRef, request.paths);
    }
    if (request.action === "drag") {
      if (!request.targetRef) throw new Error("drag 需要 targetRef");
      const target = tab.refs.get(normalizeRef(request.targetRef));
      if (!target || target.frameId !== resolved.frameId) {
        throw new Error("拖放目标已失效或不在同一 frame，请重新读取页面快照");
      }
      return frame.executeJavaScript(`(() => {
        const source = document.querySelector('[data-mailuo-ref="${resolved.localRef}"]');
        const target = document.querySelector('[data-mailuo-ref="${target.localRef}"]');
        if (!source || !target) throw new Error("拖放元素已不在页面中");
        const transfer = new DataTransfer();
        source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        source.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
        return { ok: true };
      })()`, true);
    }
    const payload = JSON.stringify({
      action: request.action,
      localRef: resolved.localRef,
      value: request.value,
      values: request.values,
      key: request.key,
      x: request.x,
      y: request.y,
    });
    if (request.action === "click" || request.action === "double_click") {
      tab.agentDownloadDeadline = Date.now() + 15_000;
    }
    return frame.executeJavaScript(`(() => {
      const input = ${payload};
      const node = document.querySelector('[data-mailuo-ref="' + CSS.escape(input.localRef) + '"]');
      if (!node) throw new Error("元素已不在页面中");
      if (input.action === "click") node.click();
      else if (input.action === "double_click") {
        node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window }));
      } else if (input.action === "hover") {
        node.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, view: window }));
      } else if (input.action === "focus") node.focus();
      else if (input.action === "fill" || input.action === "type") {
        node.focus();
        if (input.action === "fill") node.value = "";
        node.value = String(node.value || "") + String(input.value || "");
        node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(input.value || "") }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (input.action === "clear") {
        node.value = "";
        node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (input.action === "select") {
        const wanted = new Set(input.values || [input.value]);
        Array.from(node.options || []).forEach((option) => option.selected = wanted.has(option.value));
        node.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (input.action === "check" || input.action === "uncheck") {
        node.checked = input.action === "check";
        node.dispatchEvent(new Event("change", { bubbles: true }));
      } else if (input.action === "press") {
        node.dispatchEvent(new KeyboardEvent("keydown", { key: input.key, bubbles: true }));
        node.dispatchEvent(new KeyboardEvent("keyup", { key: input.key, bubbles: true }));
      } else if (input.action === "scroll") {
        if (node === document.body || node === document.documentElement) {
          window.scrollBy({ left: Number(input.x || 0), top: Number(input.y || 500), behavior: "smooth" });
        } else {
          node.scrollBy({ left: Number(input.x || 0), top: Number(input.y || 500), behavior: "smooth" });
        }
      }
      return { ok: true };
    })()`, true);
  }

  async capture(request: BrowserCaptureRequest): Promise<BrowserCaptureResult> {
    const { tab, contents } = this.resolveTab(request.tabId);
    const sensitive = new Set([
      "set_storage",
      "clear_storage",
      "set_cookie",
      "clear_cookies",
    ]).has(request.action) ||
      (request.action === "cookies" && request.includeValues === true);
    await this.approveIfNeeded(
      tab,
      request.action,
      request.key ?? request.cookie?.name ?? "",
      sensitive,
      new Set([
        "set_storage",
        "clear_storage",
        "set_cookie",
        "clear_cookies",
        "set_device",
        "reset_device",
      ]).has(request.action)
    );
    if (contents.isDestroyed()) throw new Error("浏览器标签页已关闭");

    switch (request.action) {
      case "screenshot": {
        const image = (await contents.capturePage()) as {
          toPNG(): Uint8Array | Buffer;
        };
        return {
          kind: "image",
          data: Buffer.from(image.toPNG()).toString("base64"),
          mimeType: "image/png",
        };
      }
      case "full_screenshot": {
        if (contents.isDevToolsOpened?.() && !contents.debugger.isAttached()) {
          throw new Error("开发者工具正在占用调试连接，请关闭后再截取完整页面");
        }
        const result = (await this.withDebugger(contents, (debuggerApi) =>
          debuggerApi.sendCommand("Page.captureScreenshot", {
            format: "png",
            captureBeyondViewport: true,
            fromSurface: true,
          })
        )) as { data?: string };
        if (!result.data) throw new Error("完整页面截图失败");
        return { kind: "image", data: result.data, mimeType: "image/png" };
      }
      case "pdf":
        return {
          kind: "binary",
          data: new Uint8Array(
            await contents.printToPDF({
              printBackground: true,
              preferCSSPageSize: true,
            })
          ),
          mimeType: "application/pdf",
        };
      case "console":
        return { kind: "text", data: [...tab.console] };
      case "network":
        return { kind: "text", data: [...tab.network] };
      case "cookies": {
        const cookies = await this.requireSession(contents).cookies.get({});
        return {
          kind: "text",
          data: cookies.map((cookie) => ({
            ...cookie,
            value: request.includeValues ? cookie.value : "[已隐藏]",
          })),
        };
      }
      case "set_cookie":
        if (!request.cookie) throw new Error("set_cookie 需要 cookie");
        await this.requireSession(contents).cookies.set(request.cookie);
        return { kind: "text", data: { ok: true } };
      case "clear_cookies": {
        const session = this.requireSession(contents);
        const cookies = await session.cookies.get({});
        await Promise.all(
          cookies.map((cookie) =>
            session.cookies.remove(
              this.cookieUrl(cookie, contents.getURL()),
              String(cookie.name ?? "")
            )
          )
        );
        return { kind: "text", data: { removed: cookies.length } };
      }
      case "get_storage": {
        const storage = request.storage === "session" ? "sessionStorage" : "localStorage";
        const data = await contents.executeJavaScript(
          `Object.fromEntries(Object.entries(${storage}))`
        );
        return { kind: "text", data };
      }
      case "set_storage": {
        if (!request.key) throw new Error("set_storage 需要 key");
        const storage = request.storage === "session" ? "sessionStorage" : "localStorage";
        await contents.executeJavaScript(
          `${storage}.setItem(${JSON.stringify(request.key)}, ${JSON.stringify(request.value ?? "")})`
        );
        return { kind: "text", data: { ok: true } };
      }
      case "clear_storage": {
        const storage = request.storage === "session" ? "sessionStorage" : "localStorage";
        await contents.executeJavaScript(`${storage}.clear()`);
        return { kind: "text", data: { ok: true } };
      }
      case "set_device":
        contents.enableDeviceEmulation({
          screenPosition: request.mobile ? "mobile" : "desktop",
          screenSize: {
            width: Math.max(320, request.width ?? 1280),
            height: Math.max(320, request.height ?? 720),
          },
          viewPosition: { x: 0, y: 0 },
          deviceScaleFactor: request.deviceScaleFactor ?? 1,
          viewSize: {
            width: Math.max(320, request.width ?? 1280),
            height: Math.max(320, request.height ?? 720),
          },
          scale: 1,
        });
        return { kind: "text", data: { ok: true } };
      case "reset_device":
        contents.disableDeviceEmulation();
        return { kind: "text", data: { ok: true } };
      default:
        throw new Error(`不支持的捕获动作：${request.action satisfies never}`);
    }
  }

  private resolveTab(tabId?: string): {
    tab: RegisteredTab;
    contents: BrowserControlWebContents;
  } {
    const available = this.listTabs();
    const resolvedId =
      tabId ??
      (this.defaultTabIds.length === 1 &&
      available.some((tab) => tab.id === this.defaultTabIds[0])
        ? this.defaultTabIds[0]
        : undefined);
    if (!resolvedId) {
      throw new Error("没有可用的内置浏览器标签页，请先打开或指定 tabId");
    }
    const tab = this.tabs.get(resolvedId);
    if (!tab) throw new Error(`浏览器标签页不存在：${resolvedId}`);
    const contents = this.deps.resolveWebContents(tab.webContentsId);
    if (!contents || contents.isDestroyed()) {
      this.tabs.delete(resolvedId);
      throw new Error("浏览器标签页已关闭");
    }
    return { tab, contents };
  }

  private async approveIfNeeded(
    tab: RegisteredTab,
    action: string,
    target: string,
    sensitive: boolean,
    mutating: boolean
  ): Promise<void> {
    const mode = this.deps.getApprovalMode?.() ?? "confirm-sensitive";
    if (mode === "always-allow") return;
    const needsApproval =
      (mode === "read-only" && (mutating || sensitive)) ||
      (mode === "confirm-sensitive" && sensitive);
    if (!needsApproval) return;
    if (!this.deps.requestApproval) {
      throw new Error("该浏览器操作需要用户确认，但审批界面不可用");
    }
    const allowed = await this.deps.requestApproval({
      id: crypto.randomUUID(),
      tabId: tab.tabId,
      tabTitle: tab.title || "浏览器",
      action,
      target,
      reason: mode === "read-only" ? "read-only" : "sensitive",
    });
    if (!allowed) throw new Error("用户拒绝了浏览器操作");
  }

  private async approveTabCommandIfNeeded(input: {
    action: "list" | "open" | "focus" | "close";
    tabId?: string;
    url?: string;
  }): Promise<void> {
    if (
      input.action === "list" ||
      (this.deps.getApprovalMode?.() ?? "confirm-sensitive") !== "read-only"
    ) {
      return;
    }
    if (!this.deps.requestApproval) {
      throw new Error("该浏览器操作需要用户确认，但审批界面不可用");
    }
    const tab = input.tabId ? this.tabs.get(input.tabId) : undefined;
    const allowed = await this.deps.requestApproval({
      id: crypto.randomUUID(),
      tabId: input.tabId ?? "browser:new",
      tabTitle: tab?.title || "浏览器",
      action: `tab_${input.action}`,
      target: input.url ?? input.tabId ?? "",
      reason: "read-only",
    });
    if (!allowed) throw new Error("用户拒绝了浏览器操作");
  }

  private appendBoundedLog(
    webContentsId: number,
    key: "console" | "network",
    entry: BrowserLogEntry
  ): void {
    const tab = [...this.tabs.values()].find(
      (candidate) => candidate.webContentsId === webContentsId
    );
    if (!tab) return;
    tab[key].push(entry);
    if (tab[key].length > 200) tab[key].splice(0, tab[key].length - 200);
  }

  private async readAccessibilityTree(
    contents: BrowserControlWebContents
  ): Promise<BrowserAccessibilityNode[]> {
    if (contents.isDevToolsOpened?.() && !contents.debugger.isAttached()) {
      return [];
    }
    try {
      const result = (await this.withDebugger(contents, (debuggerApi) =>
        debuggerApi.sendCommand("Accessibility.getFullAXTree")
      )) as {
        nodes?: Array<{
          ignored?: boolean;
          role?: { value?: unknown };
          name?: { value?: unknown };
          value?: { value?: unknown };
          description?: { value?: unknown };
        }>;
      };
      return (result?.nodes ?? [])
        .filter((node) => !node.ignored)
        .map((node) => ({
          role: String(node.role?.value ?? ""),
          name: String(node.name?.value ?? ""),
          ...(node.value?.value !== undefined
            ? { value: String(node.value.value) }
            : {}),
          ...(node.description?.value !== undefined
            ? { description: String(node.description.value) }
            : {}),
        }))
        .filter((node) => node.role || node.name)
        .slice(0, 1_000);
    } catch {
      return [];
    }
  }

  private isSensitiveAction(
    tab: RegisteredTab,
    request: BrowserActRequest
  ): boolean {
    if (
      request.action === "upload" ||
      request.action === "dialog" ||
      request.action === "evaluate"
    ) {
      return true;
    }
    if (request.action === "press" && request.key?.toLowerCase() === "enter") {
      return true;
    }
    if (request.action !== "click" && request.action !== "double_click") {
      return false;
    }
    const target = request.ref ? tab.refs.get(normalizeRef(request.ref)) : undefined;
    return (
      target?.type === "submit" ||
      /删除|移除|提交|确认|购买|支付|发送|下载|delete|remove|submit|confirm|buy|purchase|pay|send|download/i.test(
        `${target?.role ?? ""} ${target?.name ?? ""}`
      )
    );
  }

  private async waitFor(
    contents: BrowserControlWebContents,
    request: BrowserActRequest
  ): Promise<{ ok: true }> {
    const timeoutMs = Math.min(60_000, Math.max(100, request.timeoutMs ?? 10_000));
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const matched = await contents.executeJavaScript(`(() => {
        const selector = ${JSON.stringify(request.selector ?? "")};
        const text = ${JSON.stringify(request.text ?? "")};
        const url = ${JSON.stringify(request.url ?? "")};
        if (url && location.href.includes(url)) return true;
        if (selector && document.querySelector(selector)) return true;
        if (text && (document.body?.innerText || "").includes(text)) return true;
        return !selector && !text && !url && document.readyState === "complete";
      })()`);
      if (matched) return { ok: true };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`等待页面条件超时（${timeoutMs} ms）`);
  }

  private async uploadFiles(
    contents: BrowserControlWebContents,
    localRef: string,
    paths: string[]
  ): Promise<unknown> {
    return this.withDebugger(contents, async (debuggerApi) => {
      await debuggerApi.sendCommand("DOM.enable");
      const search = (await debuggerApi.sendCommand("DOM.performSearch", {
        query: `[data-mailuo-ref="${localRef}"]`,
        includeUserAgentShadowDOM: true,
      })) as { searchId: string; resultCount: number };
      if (!search.resultCount) throw new Error("文件输入框已不在页面中");
      const found = (await debuggerApi.sendCommand("DOM.getSearchResults", {
        searchId: search.searchId,
        fromIndex: 0,
        toIndex: 1,
      })) as { nodeIds: number[] };
      await debuggerApi.sendCommand("DOM.setFileInputFiles", {
        files: paths,
        nodeId: found.nodeIds[0],
      });
      await debuggerApi.sendCommand("DOM.discardSearchResults", {
        searchId: search.searchId,
      });
      return { ok: true };
    });
  }

  private async withDebugger<T>(
    contents: BrowserControlWebContents,
    run: (debuggerApi: BrowserControlWebContents["debugger"]) => Promise<T>
  ): Promise<T> {
    const alreadyAttached = contents.debugger.isAttached();
    if (!alreadyAttached && contents.isDevToolsOpened?.()) {
      throw new Error("开发者工具正在占用调试连接，请关闭后重试");
    }
    if (!alreadyAttached) contents.debugger.attach("1.3");
    try {
      return await run(contents.debugger);
    } finally {
      if (!alreadyAttached && contents.debugger.isAttached()) {
        contents.debugger.detach();
      }
    }
  }

  private requireSession(
    contents: BrowserControlWebContents
  ): NonNullable<BrowserControlWebContents["session"]> {
    if (!contents.session) throw new Error("浏览器 Session 不可用");
    return contents.session;
  }

  private cookieUrl(
    cookie: Record<string, unknown>,
    fallback: string
  ): string {
    const domain = String(cookie.domain ?? "").replace(/^\./, "");
    if (!domain) return fallback;
    return `${cookie.secure ? "https" : "http"}://${domain}${String(cookie.path ?? "/")}`;
  }

  private assertNavigableUrl(rawUrl: string): void {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new Error("浏览器 URL 无效");
    }
    if (!["http:", "https:", "about:", "data:", "blob:"].includes(url.protocol)) {
      throw new Error(`内置浏览器不允许导航到 ${url.protocol} 协议`);
    }
  }

  private toInfo(tab: RegisteredTab): BrowserTabInfo {
    const contents = this.deps.resolveWebContents(tab.webContentsId);
    return {
      id: tab.tabId,
      title: tab.title || contents?.getTitle() || "浏览器",
      url: tab.url || contents?.getURL() || "",
      active: tab.active,
      loading: tab.loading,
      canGoBack: contents?.navigationHistory.canGoBack() ?? false,
      canGoForward: contents?.navigationHistory.canGoForward() ?? false,
    };
  }
}
