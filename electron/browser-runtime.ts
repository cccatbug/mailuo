import { randomUUID } from "node:crypto";
import {
  BrowserHistory,
  BrowserStyleStore,
  type BrowserStyleRule,
  type HistorySnapshot,
} from "./browser-intelligence";

export interface BrowserPage {
  loadURL(url: string): Promise<void>;
  goBack(): void;
  goForward(): void;
  reload(): void;
  executeJavaScript(script: string, userGesture?: boolean): Promise<unknown>;
  capturePage(): Promise<string>;
  insertCSS(css: string): Promise<string>;
  removeInsertedCSS(key: string): Promise<void>;
  sendInputEvent(event: Record<string, unknown>): void;
  getURL(): string;
}

export interface PersistedBrowserTab {
  tabId: string;
  url: string;
  title: string;
  pinned: boolean;
  group?: string;
}

export interface BrowserRuntimeState {
  tabs: PersistedBrowserTab[];
  activeTabId: string | null;
  history?: HistorySnapshot;
  styles?: BrowserStyleRule[];
}

export interface BrowserTab extends PersistedBrowserTab {
  active: boolean;
  attached: boolean;
  favicon?: string;
  loading: boolean;
  error?: string;
  audible: boolean;
  agentAction?: string;
}

interface RuntimeTab extends BrowserTab {
  page?: BrowserPage;
  styleKeys: Map<string, string>;
}

type ToolName =
  | "list"
  | "create"
  | "activate"
  | "close"
  | "navigate"
  | "back"
  | "forward"
  | "refresh"
  | "read"
  | "click"
  | "type"
  | "scroll"
  | "key"
  | "javascript"
  | "screenshot"
  | "wait"
  | "styles.list"
  | "styles.apply"
  | "styles.remove";

export class BrowserRuntime {
  readonly history: BrowserHistory;
  readonly styles: BrowserStyleStore;
  private tabs: RuntimeTab[] = [];
  private closedTabs = new Set<string>();
  private activeTabId: string | null = null;
  private listeners = new Set<(tabs: BrowserTab[]) => void>();

  constructor(options: { history?: BrowserHistory; styles?: BrowserStyleStore } = {}) {
    this.history = options.history ?? new BrowserHistory();
    this.styles = options.styles ?? new BrowserStyleStore();
  }

  static restore(state: BrowserRuntimeState) {
    const runtime = new BrowserRuntime();
    runtime.hydrate(state);
    return runtime;
  }

  hydrate(state: BrowserRuntimeState) {
    if (this.tabs.length) return;
    this.tabs = state.tabs.map((tab) => ({
      ...tab,
      active: tab.tabId === state.activeTabId,
      attached: false,
      loading: false,
      audible: false,
      styleKeys: new Map(),
    }));
    this.activeTabId = state.activeTabId;
    this.history.restore(state.history);
    this.styles.restore(state.styles ?? []);
    this.emit();
  }

  subscribe(listener: (tabs: BrowserTab[]) => void) {
    this.listeners.add(listener);
    listener(this.listTabs());
    return () => this.listeners.delete(listener);
  }

  waitForAttachment(tabId: string, timeout = 5_000): Promise<BrowserTab> {
    const current = this.getTab(tabId);
    if (current?.attached) return Promise.resolve(current);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe();
        reject(new Error(`浏览器标签页 ${tabId} 连接页面超时`));
      }, timeout);
      const unsubscribe = this.subscribe((tabs) => {
        const tab = tabs.find((entry) => entry.tabId === tabId);
        if (!tab?.attached) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(tab);
      });
    });
  }

  private emit() {
    const publicTabs = this.listTabs();
    for (const listener of this.listeners) listener(publicTabs);
  }

  createTab(input: {
    url: string;
    title?: string;
    pinned?: boolean;
    group?: string;
    page?: BrowserPage;
    tabId?: string;
    index?: number;
    activate?: boolean;
  }): BrowserTab {
    const tabId = input.tabId ?? randomUUID();
    const tab: RuntimeTab = {
      tabId,
      url: input.url,
      title: input.title ?? input.url,
      pinned: input.pinned ?? false,
      group: input.group,
      page: input.page,
      active: false,
      attached: Boolean(input.page),
      loading: false,
      audible: false,
      styleKeys: new Map(),
    };
    const index = Math.max(0, Math.min(input.index ?? this.tabs.length, this.tabs.length));
    this.tabs.splice(index, 0, tab);
    if (input.activate ?? this.activeTabId === null) this.activateTab(tabId);
    else this.emit();
    return this.publicTab(tab);
  }

  attachPage(tabId: string, page: BrowserPage) {
    const tab = this.requireTab(tabId);
    tab.page = page;
    tab.attached = true;
    this.emit();
    void this.reapplyStyles(tabId);
  }

  detachPage(tabId: string) {
    const tab = this.requireTab(tabId);
    tab.page = undefined;
    tab.attached = false;
    tab.styleKeys.clear();
    this.emit();
  }

  getTab(tabId: string) {
    const tab = this.tabs.find((entry) => entry.tabId === tabId);
    return tab ? this.publicTab(tab) : undefined;
  }

  listTabs() {
    return this.tabs.map((tab) => this.publicTab(tab));
  }

  private publicTab(tab: RuntimeTab): BrowserTab {
    const { page: _page, styleKeys: _styleKeys, ...publicTab } = tab;
    return { ...publicTab };
  }

  updateTab(tabId: string, patch: Partial<Omit<BrowserTab, "tabId">>) {
    const tab = this.requireTab(tabId);
    Object.assign(tab, patch, { tabId });
    if (patch.url || patch.title) {
      this.history.recordVisit({ url: tab.url, title: tab.title });
    }
    this.emit();
    if (patch.url) void this.reapplyStyles(tabId);
    return this.publicTab(tab);
  }

  activateTab(tabId: string) {
    this.requireTab(tabId);
    this.activeTabId = tabId;
    for (const tab of this.tabs) tab.active = tab.tabId === tabId;
    this.emit();
  }

  reorderTab(tabId: string, index: number) {
    const current = this.tabs.findIndex((tab) => tab.tabId === tabId);
    if (current < 0) this.requireTab(tabId);
    const [tab] = this.tabs.splice(current, 1);
    this.tabs.splice(Math.max(0, Math.min(index, this.tabs.length)), 0, tab);
    this.emit();
  }

  closeTab(tabId: string) {
    const index = this.tabs.findIndex((tab) => tab.tabId === tabId);
    if (index < 0) this.requireTab(tabId);
    const [closed] = this.tabs.splice(index, 1);
    this.closedTabs.add(tabId);
    if (this.activeTabId === tabId) {
      const next = this.tabs[Math.min(index, this.tabs.length - 1)];
      this.activeTabId = next?.tabId ?? null;
      if (next) next.active = true;
    }
    closed.page = undefined;
    this.emit();
  }

  openPage(input: {
    sourceTabId: string;
    url: string;
    disposition: string;
    userGesture: boolean;
  }) {
    const sourceIndex = this.tabs.findIndex((tab) => tab.tabId === input.sourceTabId);
    if (sourceIndex < 0) this.requireTab(input.sourceTabId);
    const foreground =
      input.userGesture && input.disposition !== "background-tab";
    return this.createTab({
      url: input.url,
      index: sourceIndex + 1,
      activate: foreground,
    });
  }

  snapshot(): BrowserRuntimeState {
    const history = this.history.snapshot();
    const styles = this.styles.list();
    return {
      tabs: this.tabs.map(({ tabId, url, title, pinned, group }) => ({
        tabId,
        url,
        title,
        pinned,
        ...(group ? { group } : {}),
      })),
      activeTabId: this.activeTabId,
      ...(history.visits.length || history.searches.length || !history.enabled
        ? { history }
        : {}),
      ...(styles.length ? { styles } : {}),
    };
  }

  private requireTab(tabId: string) {
    const tab = this.tabs.find((entry) => entry.tabId === tabId);
    if (tab) return tab;
    if (this.closedTabs.has(tabId)) throw new Error(`浏览器标签页 ${tabId} 已关闭`);
    throw new Error(`浏览器标签页 ${tabId} 不存在`);
  }

  private requirePage(tabId: string) {
    const tab = this.requireTab(tabId);
    if (!tab.page) throw new Error(`浏览器标签页 ${tabId} 尚未连接页面`);
    return { tab, page: tab.page };
  }

  private async withAgentAction<T>(tabId: string, action: string, run: (page: BrowserPage) => Promise<T>) {
    const { tab, page } = this.requirePage(tabId);
    tab.agentAction = action;
    this.emit();
    try {
      return await run(page);
    } finally {
      tab.agentAction = undefined;
      this.emit();
    }
  }

  async executeTool(name: ToolName, input: Record<string, unknown> = {}): Promise<unknown> {
    if (name === "list") return this.listTabs();
    if (name === "create") return this.createTab({ url: String(input.url ?? "about:blank") });
    const tabId = String(input.tabId ?? "");
    if (name === "activate") return this.activateTab(tabId);
    if (name === "close") return this.closeTab(tabId);
    if (name === "styles.list") return this.styles.list();
    if (name === "styles.apply") {
      const rule = this.styles.add(input as unknown as Parameters<BrowserStyleStore["add"]>[0]);
      await this.applyStyleToLiveTabs(rule);
      return rule;
    }
    if (name === "styles.remove") {
      const styleId = String(input.styleId);
      await Promise.all(this.tabs.map((tab) => this.removeStyle(tab, styleId)));
      return this.styles.remove(styleId);
    }
    return this.withAgentAction(tabId, name, async (page) => {
      if (name === "navigate") return page.loadURL(String(input.url));
      if (name === "back") return page.goBack();
      if (name === "forward") return page.goForward();
      if (name === "refresh") return page.reload();
      if (name === "javascript") return page.executeJavaScript(String(input.script), true);
      if (name === "screenshot") return page.capturePage();
      if (name === "read") {
        const mode = String(input.mode ?? "text");
        const expressions: Record<string, string> = {
          text: `({title:document.title,url:location.href,text:(document.body?.innerText||"").slice(0,50000),selection:String(getSelection()||"")})`,
          dom: `document.documentElement.outerHTML.slice(0,100000)`,
          links: `[...document.links].map(a=>({text:a.innerText,href:a.href})).slice(0,500)`,
          forms: `[...document.forms].map(f=>({action:f.action,method:f.method,fields:[...f.elements].map(e=>({name:e.name,type:e.type,value:e.value}))}))`,
        };
        return page.executeJavaScript(expressions[mode] ?? expressions.text);
      }
      if (name === "click") {
        return page.executeJavaScript(`document.querySelector(${JSON.stringify(String(input.selector))})?.click()`, true);
      }
      if (name === "type") {
        const selector = JSON.stringify(String(input.selector));
        const text = JSON.stringify(String(input.text ?? ""));
        return page.executeJavaScript(`(()=>{const e=document.querySelector(${selector});if(!e)throw new Error("找不到元素");e.focus();e.value=${text};e.dispatchEvent(new Event("input",{bubbles:true}));})()`, true);
      }
      if (name === "scroll") {
        return page.executeJavaScript(`scrollBy(${Number(input.x ?? 0)},${Number(input.y ?? 0)})`, true);
      }
      if (name === "key") {
        page.sendInputEvent({ type: "keyDown", keyCode: String(input.key) });
        page.sendInputEvent({ type: "keyUp", keyCode: String(input.key) });
        return;
      }
      if (name === "wait") {
        const timeout = Math.min(Number(input.timeout ?? 10_000), 30_000);
        const expression = String(input.expression ?? "document.readyState === 'complete'");
        return page.executeJavaScript(`new Promise((resolve,reject)=>{const end=Date.now()+${timeout};const poll=()=>{if(${expression})resolve(true);else if(Date.now()>end)reject(new Error("等待超时"));else setTimeout(poll,100)};poll()})()`);
      }
      throw new Error(`未知浏览器工具：${name}`);
    });
  }

  private async removeStyle(tab: RuntimeTab, styleId: string) {
    const key = tab.styleKeys.get(styleId);
    if (key && tab.page) await tab.page.removeInsertedCSS(key);
    tab.styleKeys.delete(styleId);
  }

  private async applyStyle(tab: RuntimeTab, rule: BrowserStyleRule) {
    if (!tab.page) return;
    await this.removeStyle(tab, rule.id);
    if (this.styles.match(tab.url).some((match) => match.id === rule.id)) {
      tab.styleKeys.set(rule.id, await tab.page.insertCSS(rule.css));
    }
  }

  private async applyStyleToLiveTabs(rule: BrowserStyleRule) {
    await Promise.all(this.tabs.map((tab) => this.applyStyle(tab, rule)));
  }

  async reapplyStyles(tabId: string) {
    const tab = this.requireTab(tabId);
    await Promise.all([...tab.styleKeys.keys()].map((id) => this.removeStyle(tab, id)));
    for (const rule of this.styles.match(tab.url)) await this.applyStyle(tab, rule);
  }
}
