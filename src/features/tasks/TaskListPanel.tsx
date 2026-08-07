import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToDot,
  ArrowUpFromDot,
  Bot,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CopyPlus,
  Gauge,
  ListTree,
  Lock,
  Play,
  Plus,
  Flag,
  MessageCircleMore,
  NotebookPen,
  RotateCcw,
  Search,
  Sparkles,
  SquareKanban,
  SquareSplitVertical,
  Trash2,
  X,
} from "lucide-react";
import { addDays, format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useAppStore,
  type StatusFilter,
  type ViewMode,
} from "@/store/useAppStore";
import type { Task } from "@/types";
import { PRIORITY_LABEL } from "@/types";
import { dependentsOf, isBlocked } from "@/lib/deps";
import { isSubmitKey, isTextEditingTarget } from "@/lib/keyboard";
import { useDebouncedCommit } from "@/lib/useDebouncedValue";
import { taskTrackingSnapshot } from "@/lib/task-tracking";
import { TaskFlow } from "@/features/graph/TaskFlow";
import { StatsPanel } from "@/features/stats/StatsPanel";
import { MatrixPanel } from "@/features/matrix/MatrixPanel";

export function polishNotesWithToast(taskId: string) {
  useAppStore.getState().setAiDialog({ type: "polish", taskId });
}

function fmtDue(due: string): { text: string; overdue: boolean } {
  const d = new Date(due + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return {
    text: `${d.getMonth() + 1}/${d.getDate()}`,
    overdue: d.getTime() < today.getTime(),
  };
}

function StatusIcon({ task, blocked }: { task: Task; blocked: boolean }) {
  if (task.status === "done")
    return (
      <span className="flex size-5 items-center justify-center rounded-full bg-status-done text-white">
        <Check className="size-3.5" />
      </span>
    );
  if (blocked) return <Lock className="size-5 p-0.5 text-muted-foreground" />;
  if (task.tracking.type === "progress")
    return <Gauge className="size-5 text-primary" />;
  if (task.tracking.type === "checkin")
    return <CalendarCheck2 className="size-5 text-primary" />;
  if (task.status === "doing")
    return <CircleDashed className="size-5 text-status-doing" />;
  return <Circle className="size-5 text-muted-foreground/60" />;
}

function TaskRow({
  task,
  byId,
  selected,
}: {
  task: Task;
  byId: Map<string, Task>;
  selected: boolean;
}) {
  const selectTask = useAppStore((s) => s.selectTask);
  const setStatus = useAppStore((s) => s.setStatus);
  const trackTask = useAppStore((s) => s.trackTask);
  const setPriority = useAppStore((s) => s.setPriority);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const restoreTask = useAppStore((s) => s.restoreTask);
  const duplicateTask = useAppStore((s) => s.duplicateTask);
  const setAiDialog = useAppStore((s) => s.setAiDialog);
  const setAssistantOpen = useAppStore((s) => s.setAssistantOpen);
  const tasks = useAppStore((s) => s.tasks);

  const blocked = isBlocked(task, byId);
  const done = task.status === "done";
  const dependents = dependentsOf(task.id, tasks).length;
  const due = task.dueDate ? fmtDue(task.dueDate) : null;
  const tracking = taskTrackingSnapshot(task);

  const toggleDone = () => {
    if (task.tracking.type === "checkin") {
      trackTask(task.id, { type: "toggle-checkin" });
      return;
    }
    if (task.tracking.type === "progress") {
      selectTask(task.id);
      return;
    }
    if (blocked) {
      toast.warning("前置任务未完成，暂不可完成");
      return;
    }
    setStatus(task.id, done ? "todo" : "done");
  };

  const remove = () => {
    const removed = deleteTask(task.id);
    if (removed) {
      toast(`已删除「${removed.task.title}」`, {
        action: { label: "撤销", onClick: () => restoreTask(removed) },
      });
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          // 行本身不声明 role=button：里面还嵌着状态按钮和 tooltip 触发器，
          // 嵌套交互控件是无效 ARIA。选中状态交给外层 li 的 aria-selected。
          className={cn(
            "group relative flex w-full items-center gap-3 py-2 pr-3 pl-4 text-left transition-colors",
            "before:absolute before:inset-y-1 before:left-0 before:w-[3px] before:rounded-full before:transition-colors",
            selected
              ? "bg-accent/60 before:bg-primary"
              : "before:bg-transparent hover:bg-accent/30",
            blocked && !selected && "bg-muted/25"
          )}
          onClick={() => selectTask(task.id)}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="shrink-0"
                aria-label={
                  task.tracking.type === "checkin"
                    ? tracking.checkedInCurrentPeriod
                      ? `撤销${tracking.currentPeriodLabel}打卡`
                      : `${tracking.currentPeriodLabel}打卡`
                    : task.tracking.type === "progress"
                      ? "调整任务进度"
                      : done
                        ? "标记为未完成"
                        : "标记完成"
                }
                onClick={(e) => {
                  e.stopPropagation();
                  toggleDone();
                }}
              >
                <StatusIcon task={task} blocked={blocked} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {task.tracking.type === "checkin"
                ? tracking.checkedInCurrentPeriod
                  ? `撤销${tracking.currentPeriodLabel}打卡`
                  : `${tracking.currentPeriodLabel}打卡`
                : task.tracking.type === "progress"
                  ? "在任务详情中调整进度"
                  : blocked
                    ? "受阻：前置任务未完成"
                    : done
                      ? "点击恢复为待办"
                      : "点击标记完成"}
            </TooltipContent>
          </Tooltip>

          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              done && "text-muted-foreground line-through"
            )}
          >
            {task.title}
          </span>

          {/* 次要信息：标签最先让位，其次追踪摘要，保证右侧几列对齐 */}
          {task.tags.length > 0 && (
            <span className="hidden min-w-0 shrink items-center gap-1 xl:flex">
              {task.tags.slice(0, 2).map((tag) => (
                <span
                  key={tag}
                  className="truncate rounded-full bg-foreground/6 px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </span>
          )}

          {task.tracking.type !== "standard" && (
            <span className="hidden max-w-32 shrink-0 items-center gap-1 truncate text-[11px] text-muted-foreground tabular-nums md:flex">
              {task.tracking.type === "checkin" ? (
                <CalendarCheck2 className="size-3" />
              ) : (
                <Gauge className="size-3" />
              )}
              {tracking.summary}
            </span>
          )}

          {/* 依赖计数：固定宽度，没有也占位，避免每行右缘参差 */}
          <span className="hidden w-14 shrink-0 items-center justify-end gap-2 sm:flex">
            {task.deps.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums">
                    <ArrowDownToDot className="size-3.5" />
                    {task.deps.length}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{task.deps.length} 个前置任务</TooltipContent>
              </Tooltip>
            )}
            {dependents > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center gap-0.5 text-[11px] text-status-done tabular-nums">
                    <ArrowUpFromDot className="size-3.5" />
                    {dependents}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{dependents} 个后续任务等待它</TooltipContent>
              </Tooltip>
            )}
          </span>

          <span className="w-9 shrink-0 text-right">
            {task.priority !== "normal" && (
              <span
                className={cn(
                  "text-[11px] font-medium",
                  task.priority === "high"
                    ? "text-primary"
                    : "text-muted-foreground/70"
                )}
              >
                {PRIORITY_LABEL[task.priority]}
              </span>
            )}
          </span>

          <span className="w-12 shrink-0 text-right">
            {due && !done && (
              <span
                className={cn(
                  "text-[11px] tabular-nums",
                  due.overdue
                    ? "font-medium text-primary"
                    : "text-muted-foreground"
                )}
              >
                {due.text}
              </span>
            )}
          </span>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuGroup>
          {task.tracking.type === "standard" && task.status !== "doing" && !done && (
            <ContextMenuItem onClick={() => setStatus(task.id, "doing")}>
              <Play />
              开始进行
            </ContextMenuItem>
          )}
          {task.tracking.type === "standard" && !done && (
            <ContextMenuItem disabled={blocked} onClick={toggleDone}>
              <Check />
              标记完成
            </ContextMenuItem>
          )}
          {task.tracking.type === "standard" && done && (
            <ContextMenuItem onClick={() => setStatus(task.id, "todo")}>
              <RotateCcw />
              恢复为待办
            </ContextMenuItem>
          )}
          {task.tracking.type === "checkin" && (
            <ContextMenuItem onClick={toggleDone}>
              <CalendarCheck2 />
              {tracking.checkedInCurrentPeriod
                ? `撤销${tracking.currentPeriodLabel}打卡`
                : `${tracking.currentPeriodLabel}打卡`}
            </ContextMenuItem>
          )}
          {task.tracking.type === "progress" && (
            <ContextMenuItem onClick={() => selectTask(task.id)}>
              <Gauge />
              调整进度
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onClick={() => {
              duplicateTask(task.id);
              toast.success("已创建副本");
            }}
          >
            <CopyPlus />
            复制任务
          </ContextMenuItem>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Flag />
              优先级
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              {(["high", "normal", "low"] as const).map((p) => (
                <ContextMenuItem
                  key={p}
                  onClick={() => setPriority(task.id, p)}
                  className={cn(task.priority === p && "font-semibold")}
                >
                  {PRIORITY_LABEL[p]}
                  {task.priority === p && " ✓"}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <CalendarDays />
              期限
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                onClick={() =>
                  updateTask(task.id, {
                    dueDate: format(new Date(), "yyyy-MM-dd"),
                  })
                }
              >
                今天
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  updateTask(task.id, {
                    dueDate: format(addDays(new Date(), 1), "yyyy-MM-dd"),
                  })
                }
              >
                明天
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() =>
                  updateTask(task.id, {
                    dueDate: format(addDays(new Date(), 7), "yyyy-MM-dd"),
                  })
                }
              >
                下周
              </ContextMenuItem>
              {task.dueDate && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onClick={() => updateTask(task.id, { dueDate: null })}
                  >
                    清除期限
                  </ContextMenuItem>
                </>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <Sparkles />
              AI
            </ContextMenuSubTrigger>
            <ContextMenuSubContent>
              <ContextMenuItem
                onClick={() => setAiDialog({ type: "breakdown", taskId: task.id })}
              >
                <SquareSplitVertical />
                拆解为子任务
              </ContextMenuItem>
              <ContextMenuItem onClick={() => polishNotesWithToast(task.id)}>
                <NotebookPen />
                撰写 / 润色备注
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => {
                  useAppStore.getState().selectTask(task.id);
                  setAssistantOpen(true);
                }}
              >
                <MessageCircleMore />
                和小枢讨论
              </ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuItem variant="destructive" onClick={remove}>
            <Trash2 />
            删除任务
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function Group({
  title,
  items,
  byId,
  selectedTaskId,
  collapsible = false,
  accent,
}: {
  title: string;
  items: Task[];
  byId: Map<string, Task>;
  selectedTaskId: string | null;
  collapsible?: boolean;
  accent?: string;
}) {
  // 折叠状态放在 store 里，切视图/重挂载不再把「已完成」重新展开
  const collapsedGroups = useAppStore((s) => s.collapsedGroups);
  const toggleGroup = useAppStore((s) => s.toggleGroup);
  const open = !collapsible || !collapsedGroups.includes(title);
  if (items.length === 0) return null;
  return (
    <section className="mb-4">
      <button
        className={cn(
          // 中文不加 letter-spacing，靠字重和颜色分层级
          "mb-1 flex items-center gap-1.5 px-4 text-xs font-medium text-muted-foreground",
          collapsible && "cursor-pointer hover:text-foreground"
        )}
        onClick={() => collapsible && toggleGroup(title)}
        disabled={!collapsible}
        aria-expanded={collapsible ? open : undefined}
      >
        {collapsible &&
          (open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          ))}
        <span className={accent}>{title}</span>
        <span className="text-muted-foreground/60 tabular-nums">
          {items.length}
        </span>
      </button>
      {open && (
        <ul className="flex flex-col">
          {items.map((t) => (
            <li
              key={t.id}
              id={`task-row-${t.id}`}
              role="option"
              aria-selected={t.id === selectedTaskId}
            >
              <TaskRow task={t} byId={byId} selected={t.id === selectedTaskId} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 } as const;

export function TaskListPanel({ fixedView }: { fixedView?: ViewMode } = {}) {
  const projects = useAppStore((s) => s.projects);
  const tasks = useAppStore((s) => s.tasks);
  const selectedProjectId = useAppStore((s) => s.selectedProjectId);
  const storeView = useAppStore((s) => s.view);
  const view = fixedView ?? storeView;
  const addTask = useAppStore((s) => s.addTask);
  const search = useAppStore((s) => s.search);
  const setSearch = useAppStore((s) => s.setSearch);
  const statusFilter = useAppStore((s) => s.statusFilter);
  const setStatusFilter = useAppStore((s) => s.setStatusFilter);

  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const selectTask = useAppStore((s) => s.selectTask);
  const setStatus = useAppStore((s) => s.setStatus);
  const trackTask = useAppStore((s) => s.trackTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const restoreTask = useAppStore((s) => s.restoreTask);
  const collapsedGroups = useAppStore((s) => s.collapsedGroups);

  const [draft, setDraft] = useState("");
  // 搜索框本地即时回显，防抖后再驱动全局过滤，避免每敲一键就重算整棵列表
  const [searchDraft, setSearchDraft] = useDebouncedCommit(search, setSearch, 200);
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // ⌘N 新建、⌘F 搜索：面板可见时才接管
  useEffect(() => {
    const focusAdd = () => addRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const key = e.key.toLowerCase();
      if (key !== "n" && key !== "f") return;
      if (!listRef.current?.offsetParent) return;
      e.preventDefault();
      (key === "n" ? addRef : searchRef).current?.focus();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mailuo:new-task", focusAdd);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mailuo:new-task", focusAdd);
    };
  }, []);

  const project = projects.find((p) => p.id === selectedProjectId) ?? null;

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === selectedProjectId),
    [tasks, selectedProjectId]
  );
  const byId = useMemo(
    () => new Map(projectTasks.map((t) => [t.id, t])),
    [projectTasks]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return projectTasks.filter((t) => {
      if (q) {
        const hit =
          t.title.toLowerCase().includes(q) ||
          t.notes.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q));
        if (!hit) return false;
      }
      switch (statusFilter) {
        case "todo":
          return t.status === "todo";
        case "doing":
          return t.status === "doing";
        case "done":
          return t.status === "done";
        case "blocked":
          return t.status !== "done" && isBlocked(t, byId);
        default:
          return true;
      }
    });
  }, [projectTasks, search, statusFilter, byId]);

  const groups = useMemo(() => {
    const sortFn = (a: Task, b: Task) =>
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      a.createdAt - b.createdAt;
    return {
      doing: filtered.filter((t) => t.status === "doing").sort(sortFn),
      ready: filtered
        .filter((t) => t.status === "todo" && !isBlocked(t, byId))
        .sort(sortFn),
      blocked: filtered
        .filter((t) => t.status === "todo" && isBlocked(t, byId))
        .sort(sortFn),
      done: filtered
        .filter((t) => t.status === "done")
        .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)),
    };
  }, [filtered, byId]);

  // 分组展开后的可见顺序，方向键就沿着它走
  const visibleOrder = useMemo(
    () =>
      [
        ...groups.doing,
        ...groups.ready,
        ...groups.blocked,
        ...(collapsedGroups.includes("已完成") ? [] : groups.done),
      ].map((t) => t.id),
    [groups, collapsedGroups]
  );

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (isTextEditingTarget(e.target)) return;
    if (visibleOrder.length === 0) return;
    const at = selectedTaskId ? visibleOrder.indexOf(selectedTaskId) : -1;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const forward = e.key === "ArrowDown";
      const next =
        at === -1
          ? forward
            ? 0
            : visibleOrder.length - 1
          : (at + (forward ? 1 : -1) + visibleOrder.length) % visibleOrder.length;
      const id = visibleOrder[next];
      selectTask(id);
      listRef.current
        ?.querySelector(`#task-row-${CSS.escape(id)}`)
        ?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (at === -1) return;
    const task = byId.get(visibleOrder[at]);
    if (!task) return;

    if (e.key === " ") {
      e.preventDefault();
      if (task.tracking.type === "checkin") {
        trackTask(task.id, { type: "toggle-checkin" });
      } else if (task.tracking.type === "standard") {
        if (isBlocked(task, byId)) toast.warning("前置任务未完成，暂不可完成");
        else setStatus(task.id, task.status === "done" ? "todo" : "done");
      }
    } else if (e.key === "Delete" || (e.metaKey && e.key === "Backspace")) {
      e.preventDefault();
      const removed = deleteTask(task.id);
      if (removed) {
        // 删完把选中挪到下一条，手不用离开键盘
        const after = visibleOrder[at + 1] ?? visibleOrder[at - 1] ?? null;
        selectTask(after);
        toast(`已删除「${removed.task.title}」`, {
          action: { label: "撤销", onClick: () => restoreTask(removed) },
        });
      }
    }
  };

  const doneCount = projectTasks.filter((t) => t.status === "done").length;
  const blockedCount = projectTasks.filter(
    (t) => t.status === "todo" && isBlocked(t, byId)
  ).length;
  const pct =
    projectTasks.length === 0 ? 0 : (doneCount / projectTasks.length) * 100;

  if (!project) {
    return (
      <main className="flex h-full flex-col bg-background">
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <div className="flex size-14 items-center justify-center rounded-2xl border-2 border-dashed">
            <SquareKanban className="size-6 text-muted-foreground" />
          </div>
          <div className="text-center">
            <p className="font-heading text-lg font-bold">从一条脉络开始</p>
            <p className="mt-1 text-sm text-muted-foreground">
              新建一个项目，或者先和小枢聊聊你想做什么。
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              onClick={() => {
                const store = useAppStore.getState();
                if (!store.panelLeft) store.togglePanel("left");
                // 等侧栏这一帧挂载完再派发，比赌 50ms 可靠
                requestAnimationFrame(() =>
                  window.dispatchEvent(new CustomEvent("mailuo:new-project"))
                );
              }}
            >
              <Plus data-icon="inline-start" />
              新建项目
            </Button>
            <Button
              variant="outline"
              onClick={() => useAppStore.getState().setAssistantOpen(true)}
            >
              <Bot data-icon="inline-start" />
              与小枢对话
            </Button>
          </div>
        </div>
      </main>
    );
  }

  const submitDraft = () => {
    if (!draft.trim()) return;
    const task = addTask(draft);
    if (task) {
      toast.success(`已添加「${task.title}」`);
      setDraft("");
    }
  };

  return (
    <main className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-3 pb-2.5">
        <span
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: project.color }}
        />
        <span className="min-w-0 truncate font-heading text-sm font-bold">
          {project.name}
        </span>
        <Progress
          value={pct}
          className="h-1 min-w-8 flex-1 **:data-[slot=progress-indicator]:bg-[var(--indicator)]"
          style={{ "--indicator": project.color } as React.CSSProperties}
        />
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {doneCount}/{projectTasks.length}
          {blockedCount > 0 && (
            <span className="text-primary"> · {blockedCount} 受阻</span>
          )}
        </span>
      </header>

      {view === "list" ? (
        <>
          {/* 添加 / 搜索 / 筛选压到一行，别让正文被三层 chrome 顶下去 */}
          <div className="flex items-center gap-2 px-4 pb-2.5">
            <InputGroup className="min-w-0 flex-[2]">
              <InputGroupAddon>
                <Plus />
              </InputGroupAddon>
              <InputGroupInput
                ref={addRef}
                value={draft}
                placeholder="添加一件事，回车记入脉络…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => isSubmitKey(e, { allowShift: true }) && submitDraft()}
              />
            </InputGroup>
            <InputGroup className="min-w-0 flex-1">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                ref={searchRef}
                value={searchDraft}
                placeholder="搜索…"
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearchDraft("")}
              />
              {searchDraft && (
                <InputGroupAddon align="inline-end">
                  <button aria-label="清除搜索" onClick={() => setSearchDraft("")}>
                    <X className="size-3.5" />
                  </button>
                </InputGroupAddon>
              )}
            </InputGroup>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as StatusFilter)}
            >
              <SelectTrigger className="w-24 shrink-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="todo">待办</SelectItem>
                  <SelectItem value="doing">进行中</SelectItem>
                  <SelectItem value="blocked">受阻</SelectItem>
                  <SelectItem value="done">已完成</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div
            ref={listRef}
            role="listbox"
            aria-label="任务列表"
            // 列表整体是一个 tab stop，内部用方向键走——这样行里嵌的状态按钮
            // 不会把 Tab 顺序撑成上百站
            tabIndex={0}
            aria-activedescendant={
              selectedTaskId ? `task-row-${selectedTaskId}` : undefined
            }
            onKeyDown={onListKeyDown}
            className="flex-1 overflow-y-auto py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:ring-inset"
          >
            {filtered.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Search />
                  </EmptyMedia>
                  <EmptyTitle>
                    {projectTasks.length === 0 ? "此处空空如也" : "没有匹配的任务"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {projectTasks.length === 0
                      ? "添上第一件事，让脉络生长。"
                      : "换个关键词或筛选条件试试。"}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              <>
                <Group
                  title="进行中"
                  items={groups.doing}
                  byId={byId}
                  selectedTaskId={selectedTaskId}
                />
                <Group
                  title="可着手"
                  items={groups.ready}
                  byId={byId}
                  selectedTaskId={selectedTaskId}
                />
                <Group
                  title="受阻 · 待前置"
                  items={groups.blocked}
                  byId={byId}
                  selectedTaskId={selectedTaskId}
                  accent="text-primary"
                />
                <Group
                  title="已完成"
                  items={groups.done}
                  byId={byId}
                  selectedTaskId={selectedTaskId}
                  collapsible
                />
              </>
            )}
          </div>
        </>
      ) : view === "graph" ? (
        <div className="min-h-0 flex-1">
          {projectTasks.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ListTree />
                  </EmptyMedia>
                  <EmptyTitle>脉络图为空</EmptyTitle>
                  <EmptyDescription>
                    先在列表中添加任务，再回来编织依赖。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <TaskFlow tasks={projectTasks} />
          )}
        </div>
      ) : view === "stats" ? (
        <StatsPanel tasks={projectTasks} byId={byId} />
      ) : (
        <MatrixPanel tasks={projectTasks} byId={byId} />
      )}
    </main>
  );
}
