import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Code2,
  Cookie,
  Database,
  FolderOpen,
  History as HistoryIcon,
  Home,
  Import,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { isSubmitKey } from "@/lib/keyboard";
import {
  bridge,
  type BrowserSessionSnapshot,
} from "@/lib/bridge";
import {
  BROWSER_SEARCH_ENGINES,
  isBrowserSearchEngine,
  type BrowserSearchEngine,
} from "@/lib/browser-address";
import { useAppStore } from "@/store/useAppStore";

const SEARCH_ENGINE_LABELS: Record<BrowserSearchEngine, string> = {
  google: "Google",
  bing: "Bing",
  baidu: "百度",
  duckduckgo: "DuckDuckGo",
};

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function BrowserSettingsPane() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<BrowserSessionSnapshot | null>(null);
  const [historyCount, setHistoryCount] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const customCss = useAppStore((state) => state.settings.browserCustomCss);
  const homepage = useAppStore((state) => state.settings.browserHomepage);
  const searchEngine = useAppStore((state) => state.settings.browserSearchEngine);
  const setSettings = useAppStore((state) => state.setSettings);
  const [cssDraft, setCssDraft] = useState(customCss);
  const [homepageDraft, setHomepageDraft] = useState(homepage);

  useEffect(() => setCssDraft(customCss), [customCss]);
  useEffect(() => setHomepageDraft(homepage), [homepage]);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    setBusy("refresh");
    try {
      const [session, entries] = await Promise.all([
        bridge.getBrowserSession(),
        bridge.listBrowserHistory(),
      ]);
      setSnapshot(session);
      setHistoryCount(entries.length);
    } catch (error) {
      toast.error("读取浏览器会话失败", { description: String(error) });
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const clear = async (scope: "cookies" | "all") => {
    if (!bridge) return;
    const text =
      scope === "cookies"
        ? "清除所有内置浏览器 Cookie、登录态和 HTTP 认证信息？"
        : "清除所有内置浏览器 Cookie、缓存、站点存储和登录态？";
    if (!window.confirm(text)) return;
    setBusy(scope);
    try {
      await bridge.clearBrowserData(scope);
      await refresh();
      toast.success(scope === "cookies" ? "登录态已清除" : "浏览数据已清除");
    } catch (error) {
      toast.error("清除失败", { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const importCookies = async () => {
    if (!bridge) return;
    if (
      !window.confirm(
        "导入会替换脉络当前的浏览器 Cookie，但不会清除缓存和 localStorage。是否继续？"
      )
    ) return;
    setBusy("import");
    try {
      const result = await bridge.importBrowserCookies();
      if (!result) return;
      await refresh();
      toast.success(`已导入 ${result.imported} 个 Cookie`, {
        description: result.skipped ? `${result.skipped} 个不兼容条目已跳过` : undefined,
      });
    } catch (error) {
      toast.error("Cookie 导入失败", { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const clearHistory = async () => {
    if (!bridge) return;
    if (!window.confirm(t("browser.clearHistoryConfirm"))) return;
    setBusy("history");
    try {
      await bridge.clearBrowserHistory();
      setHistoryCount(0);
      toast.success(t("browser.clearHistoryDone"));
    } catch (error) {
      toast.error(t("browser.clearHistoryFailed"), { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  const applyHomepage = () => {
    setSettings({ browserHomepage: homepageDraft.trim() });
    toast.success(homepageDraft.trim() ? "主页已更新" : "已恢复默认主页", {
      description: "新打开的浏览器标签页会使用该网址。",
    });
  };

  const applyCustomCss = async () => {
    setBusy("css");
    try {
      await bridge?.setBrowserCustomCss(cssDraft);
      setSettings({ browserCustomCss: cssDraft });
      toast.success(cssDraft.trim() ? "自定义 CSS 已应用" : "已恢复网页默认样式", {
        description: "已打开的网页和之后新开的页面都会同步更新。",
      });
    } catch (error) {
      toast.error("应用自定义 CSS 失败", { description: String(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="font-heading text-xl font-bold">
          {t("browser.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          内置浏览器使用全局共享、持久化的 Chromium 会话。所有项目标签及 CAS/OAuth
          弹窗共享 Cookie、缓存与认证信息。
        </p>
      </div>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b p-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <ShieldCheck className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">全局浏览会话</p>
            <p className="text-xs text-muted-foreground">
              {snapshot?.persistent ? "持久化已启用" : "正在读取状态…"}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            disabled={busy !== null}
            onClick={() => void refresh()}
          >
            {busy === "refresh" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}
          </Button>
        </div>
        <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-4 gap-y-3 p-4 text-sm">
          <dt className="flex items-center gap-2 text-muted-foreground"><Cookie className="size-4" />Cookie</dt>
          <dd>{snapshot?.cookieCount ?? "—"} 个</dd>
          <dt className="flex items-center gap-2 text-muted-foreground"><Database className="size-4" />HTTP 缓存</dt>
          <dd>{snapshot ? formatBytes(snapshot.cacheSize) : "—"}</dd>
          <dt className="text-muted-foreground">存储位置</dt>
          <dd className="min-w-0 truncate font-mono text-xs" title={snapshot?.storagePath ?? ""}>
            {snapshot?.storagePath ?? "—"}
          </dd>
          <dt className="text-muted-foreground">User-Agent</dt>
          <dd className="min-w-0 break-all font-mono text-xs">{snapshot?.userAgent ?? "—"}</dd>
        </dl>
        <div className="flex flex-wrap gap-2 border-t p-3">
          <Button variant="outline" size="sm" onClick={() => void bridge?.openBrowserStorage()}>
            <FolderOpen />打开存储目录
          </Button>
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void importCookies()}>
            <Import />从 Cookie JSON 导入
          </Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b p-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Home className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {t("browser.homepage")} 与 {t("browser.searchEngine")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("browser.homepageDescription")} {t("browser.searchEngineDescription")}
            </p>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <div className="space-y-1.5">
            <Label htmlFor="browser-homepage">{t("browser.homepage")}</Label>
            <Input
              id="browser-homepage"
              value={homepageDraft}
              placeholder={t("browser.homepagePlaceholder")}
              spellCheck={false}
              onChange={(event) => setHomepageDraft(event.target.value)}
              onKeyDown={(event) => {
                if (
                  (event.metaKey || event.ctrlKey) &&
                  isSubmitKey(event, { allowShift: true })
                ) {
                  event.preventDefault();
                  applyHomepage();
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label>{t("browser.searchEngine")}</Label>
            <Select
              value={searchEngine}
              onValueChange={(value) => {
                if (isBrowserSearchEngine(value)) {
                  setSettings({ browserSearchEngine: value });
                  toast.success(`地址栏搜索已切换到 ${SEARCH_ENGINE_LABELS[value]}`);
                }
              }}
            >
              <SelectTrigger className="w-56" aria-label={t("browser.searchEngine")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BROWSER_SEARCH_ENGINES.map((engine) => (
                  <SelectItem key={engine} value={engine}>
                    <span className="flex items-center gap-2">
                      <Search className="size-3.5 text-muted-foreground" />
                      {SEARCH_ENGINE_LABELS[engine]}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              Ctrl/⌘ + Enter 应用
            </span>
            <Button
              size="sm"
              className="ml-auto"
              disabled={homepageDraft.trim() === homepage}
              onClick={applyHomepage}
            >
              <Check />
              应用主页
            </Button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b p-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <HistoryIcon className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">{t("browser.history")}</p>
            <p className="text-xs text-muted-foreground">
              {t("browser.historyDescription")}
            </p>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {historyCount === null ? "—" : `${historyCount} 条`}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-4">
          <Button
            variant="destructive"
            size="sm"
            disabled={busy !== null || !historyCount}
            onClick={() => void clearHistory()}
          >
            {busy === "history" ? <LoaderCircle className="animate-spin" /> : <Trash2 />}
            {t("browser.clearHistory")}
          </Button>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="flex items-center gap-3 border-b p-4">
          <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Code2 className="size-4" />
          </div>
          <div>
            <p className="text-sm font-medium">网页自定义 CSS</p>
            <p className="text-xs text-muted-foreground">
              注入所有内置浏览器标签页与登录弹窗，仅改变显示样式。
            </p>
          </div>
        </div>
        <div className="space-y-3 p-4">
          <Textarea
            value={cssDraft}
            spellCheck={false}
            aria-label="浏览器自定义 CSS"
            placeholder={`/* 示例：统一网页字体 */\nhtml, body, input, textarea, button {\n  font-family: "Microsoft YaHei", sans-serif !important;\n}`}
            className="min-h-52 resize-y font-mono text-xs leading-relaxed"
            onChange={(event) => setCssDraft(event.target.value)}
            onKeyDown={(event) => {
              if (
                (event.metaKey || event.ctrlKey) &&
                isSubmitKey(event, { allowShift: true })
              ) {
                event.preventDefault();
                void applyCustomCss();
              }
            }}
          />
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {cssDraft.length.toLocaleString()} 字符 · Ctrl/⌘ + Enter 应用
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              disabled={!cssDraft || busy !== null}
              onClick={() => setCssDraft("")}
            >
              清空
            </Button>
            <Button
              size="sm"
              disabled={cssDraft === customCss || busy !== null}
              onClick={() => void applyCustomCss()}
            >
              {busy === "css" ? <LoaderCircle className="animate-spin" /> : <Check />}
              应用样式
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-destructive/20 bg-destructive/3 p-4">
        <h3 className="text-sm font-medium">清理浏览数据</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          登录异常时可只清理 Cookie。完整清理还会移除缓存、localStorage、IndexedDB
          和 Service Worker，无法撤销。
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => void clear("cookies")}>
            <Cookie />仅清除登录态
          </Button>
          <Button variant="destructive" size="sm" disabled={busy !== null} onClick={() => void clear("all")}>
            <Trash2 />清除全部浏览数据
          </Button>
        </div>
      </section>
    </div>
  );
}
