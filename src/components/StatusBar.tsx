import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  AlertTriangle,
  Bot,
  CalendarClock,
  Check,
  CircleDashed,
  Cloud,
  CloudOff,
  Loader2,
  Lock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore } from "@/store/useAppStore";
import { useChat } from "@/features/ai/AssistantPanel";
import {
  flushPersist,
  getLastSavedAt,
  getPersistState,
  subscribePersistState,
} from "@/lib/persist";
import { isBlocked } from "@/lib/deps";
import { buildOverview } from "@/features/home/overview";
import { todayISO } from "@/lib/task-schedule";
import { ensureWorkspace } from "@/components/DockLayout";

/** 状态栏的一格：可点、可加提示，样式统一 */
function Cell({
  icon: Icon,
  label,
  tone,
  tooltip,
  onClick,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: React.ReactNode;
  tone?: "muted" | "primary" | "destructive" | "warning" | "done";
  tooltip?: string;
  onClick?: () => void;
}) {
  const content = (
    <span
      className={cn(
        "flex h-full items-center gap-1 rounded px-1.5 tabular-nums transition-colors",
        tone === "primary" && "text-primary",
        tone === "destructive" && "text-destructive",
        tone === "warning" && "text-status-doing",
        tone === "done" && "text-status-done",
        (!tone || tone === "muted") && "text-muted-foreground",
        onClick && "cursor-pointer hover:bg-accent hover:text-foreground"
      )}
    >
      {Icon && <Icon className="size-3" />}
      {label}
    </span>
  );
  const node = onClick ? (
    <button className="flex h-full items-center" onClick={onClick}>
      {content}
    </button>
  ) : (
    content
  );
  if (!tooltip) return node;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function Divider() {
  return <span className="h-3 w-px shrink-0 bg-border" />;
}

/** 保存状态：脏 / 写盘中 / 已保存 / 失败 */
function SaveCell() {
  const state = useSyncExternalStore(subscribePersistState, getPersistState);
  const [, tick] = useState(0);
  // 「x 分钟前」得自己走时钟，保存事件不会替它刷新
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (state === "error") {
    return (
      <Cell
        icon={CloudOff}
        tone="destructive"
        label="保存失败"
        tooltip="点击重试写盘"
        onClick={() => void flushPersist()}
      />
    );
  }
  if (state === "saving") {
    return (
      <span className="[&_svg]:animate-spin">
        <Cell icon={Loader2} label="保存中" tooltip="正在写入本地存档" />
      </span>
    );
  }
  if (state === "dirty") {
    return (
      <Cell
        icon={Cloud}
        label="待保存"
        tooltip="点击立即写盘"
        onClick={() => void flushPersist()}
      />
    );
  }
  const savedAt = getLastSavedAt();
  const minutes = savedAt ? Math.floor((Date.now() - savedAt) / 60_000) : null;
  return (
    <Cell
      icon={Check}
      tone="done"
      label={
        minutes === null ? "已保存" : minutes < 1 ? "刚刚保存" : `${minutes} 分钟前保存`
      }
      tooltip="所有改动都已写入本地存档"
    />
  );
}

/** 小枢当前状态与上下文占用 */
function AssistantCell() {
  const busy = useChat((s) => s.busy);
  const usage = useChat((s) => s.contextUsage);
  const setAssistantOpen = useAppStore((s) => s.setAssistantOpen);
  const assistantOpen = useAppStore((s) => s.assistantOpen);
  const percent = usage?.percent ?? null;

  return (
    <Cell
      icon={busy ? Sparkles : Bot}
      tone={busy ? "primary" : assistantOpen ? "primary" : "muted"}
      label={
        busy
          ? "小枢思考中…"
          : percent !== null
            ? `小枢 · 上下文 ${Math.round(percent)}%`
            : "小枢"
      }
      tooltip={assistantOpen ? "关闭小枢面板" : "唤起小枢（⌘J）"}
      onClick={() => setAssistantOpen(!assistantOpen)}
    />
  );
}

/**
 * 底部状态栏。
 *
 * Obsidian 的做法：一行常驻信息，永远不抢注意力，但每一格都能点。
 */
export function StatusBar() {
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const setStatusFilter = useAppStore((s) => s.setStatusFilter);
  const setView = useAppStore((s) => s.setView);

  const project = projects.find((p) => p.id === selectedProjectId) ?? null;
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === selectedProjectId),
    [tasks, selectedProjectId]
  );
  const overview = useMemo(() => {
    const byId = new Map(projectTasks.map((t) => [t.id, t]));
    return buildOverview(projectTasks, byId, todayISO());
  }, [projectTasks]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const selectedBlocked =
    selectedTask !== null &&
    isBlocked(selectedTask, new Map(projectTasks.map((t) => [t.id, t])));

  const goList = (filter: Parameters<typeof setStatusFilter>[0]) => {
    ensureWorkspace();
    setView("list");
    setStatusFilter(filter);
  };

  return (
    <footer className="flex h-6 shrink-0 items-center gap-1 border-t bg-sidebar px-2 text-[11px] select-none">
      {project ? (
        <>
          <span className="flex items-center gap-1.5 px-1">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: project.color }}
            />
            <span className="max-w-40 truncate font-medium">{project.name}</span>
          </span>
          <Divider />
          <Cell
            label={`${overview.doneCount}/${overview.total}`}
            tone="muted"
            tooltip={`已完成 ${overview.doneCount} 项，共 ${overview.total} 项（${overview.percent}%）`}
            onClick={() => goList("done")}
          />
          {overview.doingCount > 0 && (
            <Cell
              icon={CircleDashed}
              tone="warning"
              label={overview.doingCount}
              tooltip={`${overview.doingCount} 项进行中`}
              onClick={() => goList("doing")}
            />
          )}
          {overview.blockedCount > 0 && (
            <Cell
              icon={Lock}
              tone="primary"
              label={overview.blockedCount}
              tooltip={`${overview.blockedCount} 项受阻，等待前置任务`}
              onClick={() => goList("blocked")}
            />
          )}
          {overview.buckets.overdue.length > 0 && (
            <Cell
              icon={AlertTriangle}
              tone="destructive"
              label={`逾期 ${overview.buckets.overdue.length}`}
              tooltip="点击回到主页查看逾期任务"
              onClick={() => {
                ensureWorkspace();
                setView("home");
              }}
            />
          )}
          {overview.buckets.today.length > 0 && (
            <Cell
              icon={CalendarClock}
              tone="primary"
              label={`今日 ${overview.buckets.today.length}`}
              tooltip="点击回到主页查看今天要处理的事"
              onClick={() => {
                ensureWorkspace();
                setView("home");
              }}
            />
          )}
        </>
      ) : (
        <span className="px-1 text-muted-foreground">未选择项目</span>
      )}

      <div className="min-w-0 flex-1" />

      {selectedTask && (
        <>
          <span className="flex min-w-0 items-center gap-1 px-1 text-muted-foreground">
            {selectedBlocked && <Lock className="size-3 shrink-0 text-primary" />}
            <span className="max-w-56 truncate">{selectedTask.title}</span>
          </span>
          <Divider />
        </>
      )}
      <AssistantCell />
      <Divider />
      <SaveCell />
    </footer>
  );
}
