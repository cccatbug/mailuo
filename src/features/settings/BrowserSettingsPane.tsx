import { useCallback, useEffect, useState } from "react";
import {
  Check,
  Code2,
  Cookie,
  Database,
  FolderOpen,
  Import,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  bridge,
  type BrowserSessionSnapshot,
} from "@/lib/bridge";
import { useAppStore } from "@/store/useAppStore";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

export function BrowserSettingsPane() {
  const { t } = useTranslation();
  const [snapshot, setSnapshot] = useState<BrowserSessionSnapshot | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const customCss = useAppStore((state) => state.settings.browserCustomCss);
  const setSettings = useAppStore((state) => state.setSettings);
  const [cssDraft, setCssDraft] = useState(customCss);

  useEffect(() => setCssDraft(customCss), [customCss]);

  const refresh = useCallback(async () => {
    if (!bridge) return;
    setBusy("refresh");
    try {
      setSnapshot(await bridge.getBrowserSession());
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
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
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
