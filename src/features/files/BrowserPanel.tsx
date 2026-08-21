import {
  createElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe2,
  History as HistoryIcon,
  LoaderCircle,
  MoreVertical,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { bridge } from "@/lib/bridge";
import {
  normalizeAddress,
  isLikelyAddress,
  type BrowserSearchEngine,
} from "@/lib/browser-address";
import {
  formatRelativeTime,
  suggestBrowserHistory,
} from "@/lib/browser-history";
import type { BrowserHistoryEntry } from "@/shared/browser";
import { useAppStore } from "@/store/useAppStore";
import { cn } from "@/lib/utils";
import { shouldLoadBrowserAddress } from "./browser-navigation";

interface MailuoWebview extends HTMLElement {
  src: string;
  getURL(): string;
  getTitle(): string;
  getWebContentsId(): number;
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
}

const ENGINE_LABELS: Record<BrowserSearchEngine, string> = {
  google: "Google",
  bing: "Bing",
  baidu: "百度",
  duckduckgo: "DuckDuckGo",
};

type SuggestionItem =
  | { kind: "history"; entry: BrowserHistoryEntry }
  | { kind: "search"; url: string };

export function BrowserPanel({
  tabId,
  active,
  initialUrl,
  onTitleChange,
}: {
  tabId: string;
  active: boolean;
  initialUrl?: string;
  onTitleChange?: (title: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const homepage = useAppStore((s) => s.settings.browserHomepage);
  const searchEngine = useAppStore((s) => s.settings.browserSearchEngine);
  const webviewRef = useRef<MailuoWebview | null>(null);
  // webview 的 src 只能用于首次导航。把网页自身导航写回 src 会触发重载，
  // 从而打断 CAS/OAuth 的 302、POST 和 window.opener 回跳链。
  const initialUrlRef = useRef(
    normalizeAddress(initialUrl ?? "", { homepage, searchEngine })
  );
  const currentUrlRef = useRef(initialUrlRef.current);
  const [currentUrl, setCurrentUrl] = useState(initialUrlRef.current);
  const [address, setAddress] = useState(initialUrlRef.current);
  const [loading, setLoading] = useState(true);
  const [canBack, setCanBack] = useState(false);
  const [canForward, setCanForward] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [history, setHistory] = useState<BrowserHistoryEntry[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);

  const refreshHistory = useCallback(() => {
    void bridge
      ?.listBrowserHistory()
      .then(setHistory)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshHistory();
    const view = webviewRef.current;
    if (!view) return;
    let registeredWebContentsId: number | undefined;
    const updateRegistration = (
      update: {
        title?: string;
        url?: string;
        active?: boolean;
        loading?: boolean;
        navigation?: boolean;
      }
    ) => {
      void bridge?.updateBrowserTab(tabId, update).catch(() => undefined);
    };
    const register = () => {
      const webContentsId = view.getWebContentsId?.();
      if (!webContentsId) return;
      registeredWebContentsId = webContentsId;
      const title = view.getTitle?.() || "浏览器";
      const url = view.getURL?.() || currentUrlRef.current;
      onTitleChange?.(title);
      void bridge
        ?.registerBrowserTab({
          tabId,
          webContentsId,
          title,
          url,
          active,
          loading,
        })
        .catch((error) => {
          console.warn("浏览器标签页注册失败", error);
        });
    };
    const sync = (event?: Event, navigation = false) => {
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
      updateRegistration({
        url: next,
        title: view.getTitle?.() || "浏览器",
        loading: false,
        navigation,
      });
    };
    const start = () => {
      setLoading(true);
      setLoadError(null);
      updateRegistration({ loading: true });
    };
    const stop = (event: Event) => {
      setLoading(false);
      sync(event);
      refreshHistory();
    };
    const navigated = (event: Event) => sync(event, true);
    const titleUpdated = (event: Event) => {
      const titleEvent = event as Event & { title?: string };
      const title = titleEvent.title || view.getTitle?.() || "浏览器";
      onTitleChange?.(title);
      updateRegistration({ title });
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
      updateRegistration({ loading: false });
    };
    view.addEventListener("dom-ready", register);
    view.addEventListener("did-start-loading", start);
    view.addEventListener("did-stop-loading", stop);
    view.addEventListener("did-navigate", navigated);
    view.addEventListener("did-navigate-in-page", navigated);
    view.addEventListener("did-redirect-navigation", navigated);
    view.addEventListener("page-title-updated", titleUpdated);
    view.addEventListener("did-fail-load", failed);
    return () => {
      view.removeEventListener("dom-ready", register);
      view.removeEventListener("did-start-loading", start);
      view.removeEventListener("did-stop-loading", stop);
      view.removeEventListener("did-navigate", navigated);
      view.removeEventListener("did-navigate-in-page", navigated);
      view.removeEventListener("did-redirect-navigation", navigated);
      view.removeEventListener("page-title-updated", titleUpdated);
      view.removeEventListener("did-fail-load", failed);
      void bridge
        ?.unregisterBrowserTab(tabId, registeredWebContentsId)
        .catch(() => undefined);
    };
    // active/onTitleChange 只取挂载时的值：重挂监听会导致导航事件丢失
  }, [tabId, refreshHistory]);

  const navigate = useCallback(
    (raw?: string) => {
      const next = normalizeAddress(raw ?? address, { homepage, searchEngine });
      const view = webviewRef.current;
      const live = view?.getURL?.() || currentUrlRef.current || null;
      const declared = view?.getAttribute?.("src") ?? null;
      if (!shouldLoadBrowserAddress(next, live, declared)) return;
      currentUrlRef.current = next;
      setCurrentUrl(next);
      setAddress(next);
      setSuggestOpen(false);
      setActiveIndex(-1);
      void view?.loadURL(next);
    },
    [address, homepage, searchEngine]
  );

  const suggestions = useMemo(
    () => suggestBrowserHistory(history, address, 8),
    [history, address]
  );

  const items = useMemo<SuggestionItem[]>(() => {
    const list: SuggestionItem[] = suggestions.map((entry) => ({
      kind: "history",
      entry,
    }));
    const query = address.trim();
    // 非网址输入时补一条「去搜索引擎搜索」的提示行
    if (query && !isLikelyAddress(query)) {
      list.push({
        kind: "search",
        url: normalizeAddress(query, { homepage, searchEngine }),
      });
    }
    return list;
  }, [suggestions, address, homepage, searchEngine]);

  const pickItem = (item: SuggestionItem) => {
    navigate(item.kind === "history" ? item.entry.url : item.url);
  };

  const onAddressKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!suggestOpen) {
        setSuggestOpen(true);
        setActiveIndex(0);
        return;
      }
      setActiveIndex((index) =>
        items.length === 0 ? -1 : (index + 1) % items.length
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!suggestOpen) {
        setSuggestOpen(true);
        setActiveIndex(items.length - 1);
        return;
      }
      setActiveIndex((index) =>
        items.length === 0 ? -1 : (index - 1 + items.length) % items.length
      );
    } else if (event.key === "Escape") {
      if (suggestOpen) {
        event.preventDefault();
        setSuggestOpen(false);
        setActiveIndex(-1);
        setAddress(currentUrlRef.current);
      }
    } else if (event.key === "Enter") {
      if (suggestOpen && activeIndex >= 0 && items[activeIndex]) {
        event.preventDefault();
        pickItem(items[activeIndex]);
      }
    }
  };

  const clearHistory = () => {
    if (!window.confirm(t("browser.clearHistoryConfirm"))) return;
    void bridge
      ?.clearBrowserHistory()
      .then(() => {
        setHistory([]);
        setSuggestOpen(false);
        setActiveIndex(-1);
        toast.success(t("browser.clearHistoryDone"));
      })
      .catch((error) => {
        toast.error(t("browser.clearHistoryFailed"), {
          description: String(error),
        });
      });
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
            aria-label={t("browser.address")}
            onFocus={(event) => {
              event.target.select();
              setSuggestOpen(true);
            }}
            onBlur={() => {
              setSuggestOpen(false);
              setActiveIndex(-1);
            }}
            onChange={(event) => {
              setAddress(event.target.value);
              setSuggestOpen(true);
              setActiveIndex(-1);
            }}
            onKeyDown={onAddressKeyDown}
          />
          <Search className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          {suggestOpen && items.length > 0 && (
            <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
              <div className="max-h-72 overflow-y-auto py-1">
                {items.map((item, index) => (
                  <button
                    key={item.kind === "history" ? item.entry.id : "search"}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors",
                      index === activeIndex && "bg-accent text-accent-foreground"
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => pickItem(item)}
                  >
                    {item.kind === "history" ? (
                      <>
                        <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">
                            {item.entry.title || item.entry.domain}
                          </span>
                          <span className="block truncate text-muted-foreground">
                            {item.entry.url}
                          </span>
                        </span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {formatRelativeTime(item.entry.visitedAt, i18n.language)}
                        </span>
                      </>
                    ) : (
                      <>
                        <Search className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate">
                          {t("browser.searchFor", {
                            engine: ENGINE_LABELS[searchEngine],
                            query: address.trim(),
                          })}
                        </span>
                      </>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </form>
        <Button
          variant="ghost"
          size="icon-sm"
          title={t("browser.openExternal")}
          onClick={() => bridge?.openExternal(currentUrl)}
        >
          <ExternalLink />
        </Button>
        <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon-sm" title={t("browser.history")}>
              <HistoryIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              {t("browser.history")}
            </div>
            {history.length === 0 ? (
              <div className="px-3 py-8 text-center text-xs text-muted-foreground">
                {t("browser.historyEmpty")}
              </div>
            ) : (
              <div className="max-h-72 overflow-y-auto py-1">
                {history.slice(0, 12).map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors hover:bg-accent"
                    onClick={() => {
                      setHistoryOpen(false);
                      pickItem({ kind: "history", entry });
                    }}
                  >
                    <Globe2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">
                        {entry.title || entry.domain}
                      </span>
                      <span className="block truncate text-muted-foreground">
                        {entry.domain}
                      </span>
                    </span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {formatRelativeTime(entry.visitedAt, i18n.language)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <div className="border-t p-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start text-destructive hover:text-destructive"
                disabled={history.length === 0}
                onClick={clearHistory}
              >
                <Trash2 />
                {t("browser.clearHistory")}
              </Button>
            </div>
          </PopoverContent>
        </Popover>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" title={t("browser.tools")}>
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => webviewRef.current?.openDevTools()}>
              {t("browser.openDevTools")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => {
              const view = webviewRef.current;
              if (!view) return;
              if (view.isDevToolsOpened()) view.closeDevTools();
              else view.openDevTools();
            }}>
              {t("browser.toggleConsole")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => {
                if (!window.confirm("清除内置浏览器的 Cookie、缓存、登录态和认证信息？")) return;
                void bridge?.clearBrowserData().then(() => {
                  toast.success("浏览器会话数据已清除");
                  webviewRef.current?.reload();
                });
              }}
            >
              {t("browser.clearData")}
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
    </div>
  );
}
