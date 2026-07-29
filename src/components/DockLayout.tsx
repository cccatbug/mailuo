import { useEffect, useRef } from "react";
import {
  DockviewReact,
  themeDark,
  themeLight,
  type DockviewApi,
  type DockviewReadyEvent,
  type IDockviewHeaderActionsProps,
  type IDockviewPanelProps,
} from "dockview-react";
import "dockview-react/dist/styles/dockview.css";
import {
  Brain,
  ChartPie,
  Grid2x2,
  History,
  ListTree,
  Maximize,
  MoveHorizontal,
  MoveVertical,
  PanelRight,
  PictureInPicture2,
  RotateCcw,
  Sparkles,
  SquareKanban,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { TaskListPanel } from "@/features/tasks/TaskListPanel";
import { TaskDetailPanel } from "@/features/details/TaskDetailPanel";
import {
  AssistantPanel,
  deleteConversation,
  openMemoryFile,
  resetShuConversation,
  switchConversation,
  useChat,
} from "@/features/ai/AssistantPanel";
import { FileEditor } from "@/features/files/FileEditor";
import { BrowserPanel } from "@/features/files/BrowserPanel";
import { useAppStore, type ViewMode } from "@/store/useAppStore";

const LAYOUT_KEY = "mailuo-dock-v1";

/* ---------- 面板内容 ---------- */

const components: Record<string, React.FunctionComponent<IDockviewPanelProps>> = {
  tasks: () => <TaskListPanel />,
  "view-list": () => <TaskListPanel fixedView="list" />,
  "view-graph": () => <TaskListPanel fixedView="graph" />,
  "view-stats": () => <TaskListPanel fixedView="stats" />,
  "view-matrix": () => <TaskListPanel fixedView="matrix" />,
  detail: () => <TaskDetailPanel />,
  shu: () => <AssistantPanel />,
  file: (props) => (
    <FileEditor
      path={String(props.params?.path ?? "")}
      mimeType={
        typeof props.params?.mimeType === "string"
          ? props.params.mimeType
          : undefined
      }
    />
  ),
  browser: (props) => (
    <BrowserPanel
      initialUrl={
        typeof props.params?.url === "string" ? props.params.url : undefined
      }
    />
  ),
};

const VIEW_PANEL_TITLE: Record<ViewMode, string> = {
  list: "列表",
  graph: "脉络图",
  stats: "统计",
  matrix: "四象限",
};

/** 确保工作区面板存在并聚焦（⌘1/2/3、水印按钮调用） */
export function ensureWorkspace() {
  const api = dockRef.api;
  if (!api) return;
  const existing = api.getPanel("tasks");
  if (existing) {
    existing.api.setActive();
    return;
  }
  const detail = api.getPanel("detail");
  api.addPanel({
    id: "tasks",
    component: "tasks",
    title: "工作区",
    minimumWidth: 380,
    ...(detail
      ? { position: { referencePanel: "detail", direction: "left" } }
      : {}),
  });
}

/** 打开 ~/.mailuo 内的文件为查看/编辑标签页（同文件复用） */
export function openFilePanel(
  filePath: string,
  mimeType?: string,
  displayName?: string
) {
  const api = dockRef.api;
  if (!api) return;
  const id = `file:${filePath}`;
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  api.addPanel({
    id,
    component: "file",
    title: displayName ?? filePath.split("/").pop() ?? "文件",
    minimumWidth: 300,
    params: { path: filePath, mimeType },
    position: { referencePanel: api.getPanel("tasks") ? "tasks" : undefined as never, direction: "within" },
  });
}

/** 打开基于 Electron Chromium webview 的原生网页标签。 */
export function openBrowserPanel(url = "https://www.google.com") {
  const api = dockRef.api;
  if (!api) return;
  const id = `browser:${crypto.randomUUID()}`;
  api.addPanel({
    id,
    component: "browser",
    title: "浏览器",
    minimumWidth: 420,
    params: { url },
    position: {
      referencePanel: api.getPanel("tasks") ? "tasks" : undefined as never,
      direction: "within",
    },
  });
}

/** 把某个视图作为独立标签页打开（已存在则聚焦） */
export function openViewPanel(view: ViewMode) {
  const api = dockRef.api;
  if (!api) return;
  const id = `view-${view}`;
  const existing = api.getPanel(id);
  if (existing) {
    existing.api.setActive();
    return;
  }
  api.addPanel({
    id,
    component: id,
    title: VIEW_PANEL_TITLE[view],
    minimumWidth: 320,
    position: { referencePanel: "tasks", direction: "within" },
  });
}

/* ---------- 组头右侧工具（跟随活动面板） ---------- */

const VIEW_TABS: { key: ViewMode; label: string; icon: React.ReactNode }[] = [
  { key: "list", label: "列表", icon: <SquareKanban /> },
  { key: "graph", label: "脉络图", icon: <ListTree /> },
  { key: "stats", label: "统计", icon: <ChartPie /> },
  { key: "matrix", label: "四象限", icon: <Grid2x2 /> },
];

function TasksActions() {
  const view = useAppStore((s) => s.view);
  const setView = useAppStore((s) => s.setView);
  const graphDirection = useAppStore((s) => s.graphDirection);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  return (
    <div className="flex h-full items-center gap-1 pr-1.5">
      <div className="flex items-center gap-0.5">
        {VIEW_TABS.map((t) => (
          <Tooltip key={t.key}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  "flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors [&_svg]:size-3.5",
                  view === t.key
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                )}
                onClick={() => setView(t.key)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openViewPanel(t.key);
                }}
                onAuxClick={(e) => {
                  if (e.button === 1) openViewPanel(t.key);
                }}
              >
                {t.icon}
                {t.label}
              </button>
            </TooltipTrigger>
            <TooltipContent>右键 / 中键：在新标签页打开</TooltipContent>
          </Tooltip>
        ))}
      </div>
      {view === "graph" && (
        <>
          <ToggleGroup
            type="single"
            size="sm"
            value={graphDirection}
            onValueChange={(v) =>
              v && useAppStore.getState().setGraphDirection(v as "LR" | "TB")
            }
          >
            <ToggleGroupItem value="LR" aria-label="横向布局" className="size-6 p-0">
              <MoveHorizontal />
            </ToggleGroupItem>
            <ToggleGroupItem value="TB" aria-label="纵向布局" className="size-6 p-0">
              <MoveVertical />
            </ToggleGroupItem>
          </ToggleGroup>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="适配视野"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => window.dispatchEvent(new CustomEvent("mailuo:fitview"))}
          >
            <Maximize />
          </Button>
        </>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="AI 依赖建议"
            className="size-6 text-primary"
            onClick={() => {
              if (selectedProjectId) {
                useAppStore
                  .getState()
                  .setAiDialog({ type: "suggestDeps", projectId: selectedProjectId });
              }
            }}
          >
            <Sparkles />
          </Button>
        </TooltipTrigger>
        <TooltipContent>AI 依赖建议</TooltipContent>
      </Tooltip>
    </div>
  );
}

function ShuActions() {
  const mode = useAppStore((s) => s.assistantMode);
  const setMode = useAppStore((s) => s.setAssistantMode);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const conversations = useChat((s) => s.conversations);
  const currentId = useChat((s) => s.currentId);
  const history = conversations
    .filter((c) => c.projectId === selectedProjectId && c.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 15);
  return (
    <div className="flex h-full items-center pr-1.5">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="会话历史"
            className="size-6 text-muted-foreground hover:text-foreground"
          >
            <History />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs">会话历史</DropdownMenuLabel>
          <DropdownMenuGroup>
            {history.length === 0 && (
              <DropdownMenuItem disabled>暂无历史会话</DropdownMenuItem>
            )}
            {history.map((c) => (
              <DropdownMenuItem
                key={c.id}
                className="group"
                onClick={() => switchConversation(c.id)}
              >
                <span
                  className={cn(
                    "truncate",
                    c.id === currentId && "font-medium text-primary"
                  )}
                >
                  {c.title}
                </span>
                <button
                  aria-label="删除会话"
                  className="ml-auto rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(c.id);
                  }}
                >
                  <Trash2 className="size-3" />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => void openMemoryFile()}>
              <Brain />
              长期记忆…
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="新对话"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={resetShuConversation}
          >
            <RotateCcw />
          </Button>
        </TooltipTrigger>
        <TooltipContent>新对话</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={mode === "dock" ? "改为悬浮窗" : "停靠到右侧"}
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => setMode(mode === "dock" ? "float" : "dock")}
          >
            {mode === "dock" ? <PictureInPicture2 /> : <PanelRight />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {mode === "dock" ? "改为悬浮窗" : "停靠到右侧"}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

function GraphPanelActions() {
  const graphDirection = useAppStore((s) => s.graphDirection);
  return (
    <div className="flex h-full items-center gap-1 pr-1.5">
      <ToggleGroup
        type="single"
        size="sm"
        value={graphDirection}
        onValueChange={(v) =>
          v && useAppStore.getState().setGraphDirection(v as "LR" | "TB")
        }
      >
        <ToggleGroupItem value="LR" aria-label="横向布局" className="size-6 p-0">
          <MoveHorizontal />
        </ToggleGroupItem>
        <ToggleGroupItem value="TB" aria-label="纵向布局" className="size-6 p-0">
          <MoveVertical />
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="适配视野"
        className="size-6 text-muted-foreground hover:text-foreground"
        onClick={() => window.dispatchEvent(new CustomEvent("mailuo:fitview"))}
      >
        <Maximize />
      </Button>
    </div>
  );
}

function HeaderActions(props: IDockviewHeaderActionsProps) {
  const active = props.group.activePanel?.id;
  if (active === "tasks") return <TasksActions />;
  if (active === "shu") return <ShuActions />;
  if (active === "view-graph") return <GraphPanelActions />;
  return null;
}

/* ---------- API 桥（App 的快捷键 / store 开关驱动面板增删） ---------- */

/* dev 模式 HMR 会重估本模块，把 api 引用挂到 globalThis 防止丢失 */
const g = globalThis as unknown as {
  __mailuoDock?: {
    api: DockviewApi | null;
    handleRemove?: (panelId: string) => void;
  };
};
g.__mailuoDock ??= { api: null };
const dockRef = g.__mailuoDock;

// 每次模块求值（含 HMR）都刷新处理器，事件订阅只调用指针，避免旧闭包复活
dockRef.handleRemove = (panelId: string) => {
  const store = useAppStore.getState();
  if (panelId === "detail") store.setPanelOpen("right", false);
  else if (panelId === "shu") store.setAssistantOpen(false);
};
/** 程序化增删面板期间置真，onDidRemovePanel 据此忽略非用户操作 */
let internalOp = false;

function buildDefaultLayout(api: DockviewApi) {
  api.addPanel({
    id: "tasks",
    component: "tasks",
    title: "工作区",
    minimumWidth: 380,
  });
  api.addPanel({
    id: "detail",
    component: "detail",
    title: "任务详情",
    minimumWidth: 260,
    position: { referencePanel: "tasks", direction: "right" },
  });
  api.getPanel("detail")?.api.setSize({ width: 310 });
  api.getPanel("tasks")?.api.setActive();
}

/** 按 store 状态增删面板（幂等） */
function syncPanels() {
  const api = dockRef.api;
  if (!api) return;
  const { panelRight, assistantOpen, assistantMode } = useAppStore.getState();

  const has = (id: string) => api.getPanel(id) !== undefined;
  internalOp = true;
  try {

  if (panelRight && !has("detail")) {
    api.addPanel({
      id: "detail",
      component: "detail",
      title: "任务详情",
      minimumWidth: 260,
      position: { direction: "right" },
      initialWidth: 310,
    });
  } else if (!panelRight && has("detail")) {
    api.removePanel(api.getPanel("detail")!);
  }

  if (assistantOpen && !has("shu")) {
    if (assistantMode === "float") {
      api.addPanel({
        id: "shu",
        component: "shu",
        title: "小枢",
        minimumWidth: 320,
        minimumHeight: 360,
        floating: { width: 420, height: 560, x: 0, y: 0, position: { right: 48, top: 24 } },
      });
    } else {
      api.addPanel({
        id: "shu",
        component: "shu",
        title: "小枢",
        minimumWidth: 320,
        position: { direction: "right" },
        initialWidth: 400,
      });
    }
  } else if (!assistantOpen && has("shu")) {
    api.removePanel(api.getPanel("shu")!);
  }
  } finally {
    internalOp = false;
  }
}

/** 小枢 停靠⇄悬浮 切换：删掉重加 */
export function relocateAssistant() {
  const api = dockRef.api;
  if (!api) return;
  const panel = api.getPanel("shu");
  if (panel) {
    internalOp = true;
    try {
      api.removePanel(panel);
    } finally {
      internalOp = false;
    }
  }
  syncPanels();
}

function Watermark() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <p>所有面板都关掉了</p>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => ensureWorkspace()}>
          打开工作区
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => useAppStore.getState().setAssistantOpen(true)}
        >
          呼叫小枢
        </Button>
      </div>
    </div>
  );
}

export function DockLayout() {
  const theme = useAppStore((s) => s.theme);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onReady = (event: DockviewReadyEvent) => {
    dockRef.api = event.api;
    let restored = false;
    try {
      const raw = localStorage.getItem(LAYOUT_KEY);
      // 旧版布局里 projects 还是 dock 面板，直接放弃恢复重建
      if (raw && !raw.includes('"projects"')) {
        event.api.fromJSON(JSON.parse(raw));
        restored = true;
      }
    } catch (e) {
      console.warn("布局恢复失败，使用默认布局", e);
    }
    if (!restored || event.api.panels.length === 0) {
      buildDefaultLayout(event.api);
    }

    // 恢复后的面板存在性 → 回写 store 开关
    const store = useAppStore.getState();
    store.setPanelOpen("right", event.api.getPanel("detail") !== undefined);
    store.setAssistantOpen(event.api.getPanel("shu") !== undefined);

    event.api.onDidLayoutChange(() => {
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(LAYOUT_KEY, JSON.stringify(event.api.toJSON()));
        } catch {
          // 忽略序列化失败
        }
      }, 300);
    });

    // 用户通过 tab 关闭面板 → 回写 store（经全局指针，HMR 后始终指向最新逻辑）
    event.api.onDidRemovePanel((panel) => {
      if (internalOp) return;
      dockRef.handleRemove?.(panel.id);
    });
  };

  // store 开关 → 面板增删
  const panelRight = useAppStore((s) => s.panelRight);
  const assistantOpen = useAppStore((s) => s.assistantOpen);
  useEffect(() => {
    syncPanels();
  }, [panelRight, assistantOpen]);

  return (
    <DockviewReact
      className="h-full w-full"
      theme={theme === "dark" ? themeDark : themeLight}
      components={components}
      rightHeaderActionsComponent={HeaderActions}
      watermarkComponent={Watermark}
      onReady={onReady}
      floatingGroupBounds="boundedWithinViewport"
    />
  );
}
