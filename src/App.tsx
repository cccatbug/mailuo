import { useEffect } from "react";
import { FolderOpen, Minus, RotateCcw, Square, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/store/useAppStore";
import { Ribbon } from "@/components/Ribbon";
import {
  DockLayout,
  ensureWorkspace,
  relocateAssistant,
  focusOrOpenBrowser,
  openBrowserPanel,
  focusBrowserPanel,
  closeBrowserPanel,
} from "@/components/DockLayout";
import { ProjectSidebar } from "@/features/projects/ProjectSidebar";
import { CommandPalette } from "@/features/command/CommandPalette";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { AiDialogs } from "@/features/ai/AiDialogs";
import { bridge } from "@/lib/bridge";
import { flushPersist, setPersistErrorHandler } from "@/lib/persist";
import { toast } from "sonner";
import { isMac } from "@/lib/platform";
import { cn } from "@/lib/utils";
import i18n from "@/lib/i18n";

/** Windows / Linux 自绘窗口控制（macOS 用红绿灯） */
function WindowControls() {
  const b = bridge;
  if (isMac || !b) return null;
  return (
    <div className="app-no-drag flex items-center">
      <button
        aria-label="最小化"
        className="flex h-10 w-11 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => b.windowControl("minimize")}
      >
        <Minus className="size-4" />
      </button>
      <button
        aria-label="最大化 / 还原"
        className="flex h-10 w-11 items-center justify-center text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => b.windowControl("maximize")}
      >
        <Square className="size-3.5" />
      </button>
      <button
        aria-label="关闭"
        className="flex h-10 w-11 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white"
        onClick={() => b.windowControl("close")}
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

/** 顶部细条：窗口拖动区 + 居中标题（红绿灯 / 窗口控制在两端） */
function TopStrip() {
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const view = useAppStore((s) => s.view);
  const project = projects.find((p) => p.id === selectedProjectId);
  const viewLabel =
    view === "list"
      ? "列表"
      : view === "graph"
        ? "脉络图"
        : view === "stats"
          ? "统计"
          : "四象限";
  const title = project ? `${project.name} · ${viewLabel}` : "脉络";

  return (
    <header
      className={cn(
        "app-drag relative flex h-10 shrink-0 items-center border-b bg-sidebar",
        isMac ? "pl-[76px]" : "pl-3"
      )}
    >
      <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-xs text-muted-foreground">
        {title}
      </span>
      <div className="flex-1" />
      <WindowControls />
    </header>
  );
}

/**
 * 存档读不出来时的兜底页。
 *
 * 关键在于「什么都不做」：既不 seed 也不写盘，否则会把用户真实存档覆盖掉。
 */
function LoadErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-5 bg-background px-8">
      <div className="flex size-12 items-center justify-center rounded-2xl border-2 border-dashed border-destructive/50">
        <TriangleAlert className="size-6 text-destructive" />
      </div>
      <div className="max-w-md text-center">
        <p className="font-heading text-lg font-bold">没能读出你的存档</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          为了不覆盖原有数据，脉络已经停在这里，没有写入任何内容。
        </p>
        <p className="mt-3 rounded-lg border bg-card px-3 py-2 text-left font-mono text-xs break-all text-muted-foreground">
          {message}
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => window.location.reload()}>
          <RotateCcw data-icon="inline-start" />
          重试
        </Button>
        {bridge && (
          <Button variant="outline" onClick={() => void bridge?.openDataDir()}>
            <FolderOpen data-icon="inline-start" />
            打开数据目录
          </Button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const loaded = useAppStore((s) => s.loaded);
  const loadError = useAppStore((s) => s.loadError);
  const init = useAppStore((s) => s.init);
  const setView = useAppStore((s) => s.setView);
  const setCommandOpen = useAppStore((s) => s.setCommandOpen);
  const setSettingsOpen = useAppStore((s) => s.setSettingsOpen);
  const setAssistantOpen = useAppStore((s) => s.setAssistantOpen);
  const togglePanel = useAppStore((s) => s.togglePanel);
  const assistantMode = useAppStore((s) => s.assistantMode);
  const panelLeft = useAppStore((s) => s.panelLeft);
  const locale = useAppStore((s) => s.settings.locale);
  const assistantPermissionMode = useAppStore(
    (s) => s.settings.assistantPermissionMode
  );
  const browserCustomCss = useAppStore((s) => s.settings.browserCustomCss);

  useEffect(() => {
    void init();
  }, [init]);

  // 保存失败必须让用户看见，否则界面表现得像已保存
  useEffect(() => {
    setPersistErrorHandler((message) =>
      toast.error("保存失败，改动可能未写入磁盘", {
        description: message,
        duration: Infinity,
        action: { label: "重试", onClick: () => void flushPersist() },
      })
    );
  }, []);

  // 主进程关窗前会等这次落盘完成
  useEffect(() => bridge?.onFlushStateRequest(() => flushPersist()), []);

  // 关窗 / 隐藏前把防抖中的最后一次改动落盘
  useEffect(() => {
    const flush = () => void flushPersist();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  useEffect(() => {
    void i18n.changeLanguage(locale);
  }, [locale]);

  useEffect(() => {
    void bridge?.setAssistantPermissionMode(assistantPermissionMode);
  }, [assistantPermissionMode]);

  useEffect(() => {
    if (!loaded) return;
    void bridge?.setBrowserCustomCss(browserCustomCss).catch((error) => {
      console.error("应用浏览器自定义 CSS 失败", error);
    });
  }, [browserCustomCss, loaded]);

  useEffect(() => {
    return bridge?.onBrowserDownload((event) => {
      if (event.state === "started") {
        toast.info(`开始下载 ${event.filename}`);
      } else if (event.state === "completed") {
        toast.success(`已下载 ${event.filename}`, {
          action: {
            label: "打开",
            onClick: () => void bridge?.openBrowserDownload(event.path),
          },
        });
      } else {
        toast.error(`下载未完成：${event.filename}`);
      }
    });
  }, []);

  useEffect(() => bridge?.onBrowserOpenTab((url) => openBrowserPanel(url)), []);

  useEffect(
    () =>
      bridge?.onBrowserTabCommand(async (command) => {
        if (command.action === "open") {
          const tabId = openBrowserPanel(command.url);
          if (!tabId) throw new Error("工作区尚未准备好");
          return { tabId };
        }
        if (!command.tabId) throw new Error("缺少浏览器标签页 ID");
        const ok =
          command.action === "focus"
            ? focusBrowserPanel(command.tabId)
            : closeBrowserPanel(command.tabId);
        if (!ok) throw new Error("浏览器标签页不存在");
        return { tabId: command.tabId };
      }),
    []
  );

  // 原生窗口标题跟随当前项目与视图
  const projects = useAppStore((s) => s.projects);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const view = useAppStore((s) => s.view);
  useEffect(() => {
    const project = projects.find((p) => p.id === selectedProjectId);
    const viewLabel =
      view === "list"
        ? "列表"
        : view === "graph"
          ? "脉络图"
          : view === "stats"
            ? "统计"
            : "四象限";
    document.title = project
      ? `${project.name} · ${viewLabel} — 脉络`
      : "脉络 · Màiluò";
  }, [projects, selectedProjectId, view]);

  // 小枢 停靠⇄悬浮 切换
  useEffect(() => {
    relocateAssistant();
  }, [assistantMode]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === "k") {
        e.preventDefault();
        setCommandOpen(!useAppStore.getState().commandOpen);
      } else if (e.key === "1") {
        e.preventDefault();
        ensureWorkspace();
        setView("list");
      } else if (e.key === "2") {
        e.preventDefault();
        ensureWorkspace();
        setView("graph");
      } else if (e.key === "3") {
        e.preventDefault();
        ensureWorkspace();
        setView("stats");
      } else if (e.key === "4") {
        e.preventDefault();
        ensureWorkspace();
        setView("matrix");
      } else if (e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "j") {
        e.preventDefault();
        setAssistantOpen(!useAppStore.getState().assistantOpen);
      } else if (e.key.toLowerCase() === "b") {
        e.preventDefault();
        togglePanel(e.shiftKey ? "right" : "left");
      } else if (e.shiftKey && e.key.toLowerCase() === "g") {
        e.preventDefault();
        focusOrOpenBrowser();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setView, setCommandOpen, setSettingsOpen, setAssistantOpen, togglePanel]);

  if (loadError) return <LoadErrorScreen message={loadError} />;

  if (!loaded) {
    return (
      <div className="app-drag flex h-screen items-center justify-center bg-background" />
    );
  }

  return (
    <TooltipProvider delayDuration={400}>
      <div className="flex h-screen flex-col overflow-hidden">
        <TopStrip />
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Ribbon />
          {/* 项目栏：非 dock 窗口，宽度收放（保持挂载，切换零开销） */}
          <div
            className="shrink-0 overflow-hidden border-r transition-[width] duration-150 ease-out"
            style={{ width: panelLeft ? 260 : 0, borderRightWidth: panelLeft ? 1 : 0 }}
          >
            <div className="h-full w-[260px]">
              <ProjectSidebar />
            </div>
          </div>
          <div className="min-w-0 flex-1">
            <DockLayout />
          </div>
        </div>
      </div>
      <CommandPalette />
      <SettingsDialog />
      <AiDialogs />
      <Toaster position="bottom-right" richColors />
    </TooltipProvider>
  );
}
