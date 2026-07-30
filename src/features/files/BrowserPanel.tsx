import { createElement, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  LoaderCircle,
  MoreVertical,
  RefreshCw,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bridge } from "@/lib/bridge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { shouldLoadBrowserAddress } from "./browser-navigation";

interface MailuoWebview extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  loadURL(url: string): Promise<void>;
  executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>;
  openDevTools(): void;
  closeDevTools(): void;
  isDevToolsOpened(): boolean;
  getWebContentsId(): number;
}

const SEARCH_TEMPLATES: Record<string, string> = {
  google: "https://www.google.com/search?q=%s",
  bing: "https://www.bing.com/search?q=%s",
  baidu: "https://www.baidu.com/s?wd=%s",
  duckduckgo: "https://duckduckgo.com/?q=%s",
};

function normalizeAddress(value: string): string {
  const input = value.trim();
  if (!input) return "https://www.google.com";
  if (/^[a-z][a-z\d+.-]*:/i.test(input)) return input;
  if (/^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:\/|$)/i.test(input)) {
    return `https://${input}`;
  }
  const provider = localStorage.getItem("mailuo-browser-search-provider") ?? "google";
  const template =
    provider === "custom"
      ? localStorage.getItem("mailuo-browser-search-template")
      : SEARCH_TEMPLATES[provider];
  const safeTemplate =
    template?.startsWith("https://") && template.includes("%s")
      ? template
      : SEARCH_TEMPLATES.google;
  return safeTemplate.replace("%s", encodeURIComponent(input));
}

interface AddressSuggestion {
  kind: "tab" | "history" | "search";
  tabId?: string;
  url?: string;
  title?: string;
  query?: string;
}

export function BrowserPanel({
  initialUrl,
  tabId,
  onTitleChange,
}: {
  initialUrl?: string;
  tabId?: string;
  onTitleChange?: (title: string) => void;
}) {
  const webviewRef = useRef<MailuoWebview | null>(null);
  // webview 的 src 只能用于首次导航。把网页自身导航写回 src 会触发重载，
  // 从而打断 CAS/OAuth 的 302、POST 和 window.opener 回跳链。
  const initialUrlRef = useRef(normalizeAddress(initialUrl ?? "https://www.google.com"));
  const currentUrlRef = useRef(initialUrlRef.current);
  const [currentUrl, setCurrentUrl] = useState(initialUrlRef.current);
  const [address, setAddress] = useState(initialUrlRef.current);
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [addressFocused, setAddressFocused] = useState(false);

  useEffect(() => {
    const browserBridge = bridge;
    if (!addressFocused || !browserBridge) return;
    const timer = window.setTimeout(() => {
      void browserBridge
        .suggestBrowserAddress(address)
        .then((items) => setSuggestions(items as AddressSuggestion[]))
        .catch(() => setSuggestions([]));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [address, addressFocused]);

  useEffect(() => {
    const view = webviewRef.current;
    if (!view) return;
    const register = () => {
      const id = view.getWebContentsId?.();
      if (id) void bridge?.browserTabForContents(id, tabId);
    };
    const sync = (event?: Event) => {
      const navigationEvent = event as Event & {
        url?: string;
        detail?: { url?: string };
        isMainFrame?: boolean;
      };
      if (navigationEvent?.isMainFrame === false) return;
      const next =
        navigationEvent?.url ||
        navigationEvent?.detail?.url ||
        view.getURL?.() ||
        currentUrlRef.current;
      currentUrlRef.current = next;
      setAddress(next);
      setCurrentUrl(next);
      setCanBack(view.canGoBack?.() ?? false);
      setCanForward(view.canGoForward?.() ?? false);
    };
    const start = () => {
      setLoading(true);
      setLoadError(null);
    };
    const stop = (event: Event) => {
      setLoading(false);
      sync(event);
    };
    const failed = (event: Event) => {
      const failure = event as Event & {
        errorCode?: number;
        errorDescription?: string;
        validatedURL?: string;
        isMainFrame?: boolean;
      };
      if (failure.isMainFrame === false || failure.errorCode === -3) return;
      setLoading(false);
      setLoadError(failure.errorDescription || "页面加载失败");
    };
    const titleChanged = (event: Event) => {
      const titleEvent = event as Event & { title?: string };
      const title = titleEvent.title || view.getTitle?.();
      if (title) onTitleChange?.(title);
    };
    view.addEventListener("did-start-loading", start);
    view.addEventListener("dom-ready", register);
    view.addEventListener("did-stop-loading", stop);
    view.addEventListener("did-navigate", sync);
    view.addEventListener("did-navigate-in-page", sync);
    view.addEventListener("did-redirect-navigation", sync);
    view.addEventListener("did-fail-load", failed);
    view.addEventListener("page-title-updated", titleChanged);
    return () => {
      view.removeEventListener("did-start-loading", start);
      view.removeEventListener("dom-ready", register);
      view.removeEventListener("did-stop-loading", stop);
      view.removeEventListener("did-navigate", sync);
      view.removeEventListener("did-navigate-in-page", sync);
      view.removeEventListener("did-redirect-navigation", sync);
      view.removeEventListener("did-fail-load", failed);
      view.removeEventListener("page-title-updated", titleChanged);
    };
  }, [onTitleChange, tabId]);

  const navigateTo = (value: string) => {
    const raw = value.trim();
    const next = normalizeAddress(value);
    const view = webviewRef.current;
    const live = view?.getURL?.() || currentUrlRef.current || null;
    const declared = view?.getAttribute?.("src") ?? null;
    if (!shouldLoadBrowserAddress(next, live, declared)) return;
    currentUrlRef.current = next;
    setCurrentUrl(next);
    setAddress(next);
    if (
      raw &&
      !/^[a-z][a-z\d+.-]*:/i.test(raw) &&
      !/^(localhost|[\w-]+(?:\.[\w-]+)+)(:\d+)?(?:\/|$)/i.test(raw)
    ) {
      void bridge?.recordBrowserSearch(raw);
    }
    void view?.loadURL(next);
  };
  const navigate = () => navigateTo(address);

  const selectSuggestion = (suggestion: AddressSuggestion) => {
    setAddressFocused(false);
    if (suggestion.kind === "tab" && suggestion.tabId) {
      void bridge?.activateBrowserTab(suggestion.tabId);
      return;
    }
    const value = suggestion.kind === "search" ? suggestion.query : suggestion.url;
    if (!value) return;
    setAddress(value);
    navigateTo(value);
  };

  return (
    <div className="relative flex h-full min-w-0 flex-col overflow-hidden bg-background">
      <div className="flex h-10 shrink-0 items-center gap-1 border-b bg-background px-2">
        <Button variant="ghost" size="icon-sm" disabled={!canBack} onClick={() => webviewRef.current?.goBack()}>
          <ArrowLeft />
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!canForward} onClick={() => webviewRef.current?.goForward()}>
          <ArrowRight />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => webviewRef.current?.reload()}>
          {loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
        </Button>
        <form
          className="relative min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            navigate();
          }}
        >
          <Globe2 className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={address}
            className="h-7 rounded-full bg-muted/50 pr-8 pl-8 text-xs"
            aria-label="网址或搜索"
            onChange={(event) => setAddress(event.target.value)}
            onFocus={() => setAddressFocused(true)}
            onBlur={() => window.setTimeout(() => setAddressFocused(false), 100)}
          />
          <Search className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          {addressFocused && suggestions.length > 0 && (
            <div className="absolute top-8 inset-x-0 z-30 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
              {suggestions.map((suggestion, index) => (
                <button
                  type="button"
                  key={`${suggestion.kind}:${suggestion.tabId ?? suggestion.url ?? suggestion.query}:${index}`}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectSuggestion(suggestion)}
                >
                  <span className="w-12 shrink-0 text-[10px] text-muted-foreground">
                    {suggestion.kind === "tab" ? "已打开" : suggestion.kind === "search" ? "搜索" : "历史"}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {suggestion.title ?? suggestion.query ?? suggestion.url}
                  </span>
                </button>
              ))}
            </div>
          )}
        </form>
        <Button variant="ghost" size="icon-sm" title="在系统浏览器打开" onClick={() => bridge?.openExternal(currentUrl)}>
          <ExternalLink />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="浏览器工具"><MoreVertical /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => webviewRef.current?.openDevTools()}>
              打开开发者工具
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const view = webviewRef.current;
              if (!view) return;
              if (view.isDevToolsOpened()) view.closeDevTools();
              else view.openDevTools();
            }}>
              切换网页控制台
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                if (!window.confirm("清除内置浏览器的 Cookie、缓存、登录态和认证信息？")) return;
                setActionError(null);
                void bridge?.clearBrowserData()
                  .then(() => webviewRef.current?.reload())
                  .catch((error) => setActionError(String(error)));
              }}
            >
              清除 Cookie 与缓存…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {createElement("webview", {
        ref: (node: MailuoWebview | null) => {
          webviewRef.current = node;
        },
        // 保持声明值稳定；后续导航一律由 Chromium 或显式 loadURL 驱动。
        src: initialUrlRef.current,
        partition: "persist:mailuo-browser",
        allowpopups: "true",
        className: "min-h-0 flex-1 bg-white",
      })}
      {loadError && (
        <div className="pointer-events-none absolute inset-x-3 top-13 z-10 rounded-lg border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
          {loadError}。如果这是扫码登录回跳，请确认对应客户端已安装；HTTP(S) 登录弹窗会保留在脉络浏览会话中。
        </div>
      )}
      {actionError && (
        <div className="absolute inset-x-3 top-13 z-10 rounded-lg border border-destructive/30 bg-background/95 px-3 py-2 text-xs text-destructive shadow-sm">
          {actionError}
        </div>
      )}
    </div>
  );
}
