import { useMemo, useState } from "react";
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
import { Badge } from "@/components/ui/badge";
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
import { isSubmitKey } from "@/lib/keyboard";
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

function TaskRow({ task, byId }: { task: Task; byId: Map<string, Task> }) {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
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
          role="button"
          tabIndex={0}
          className={cn(
            "group flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-all",
            "hover:shadow-sm",
            task.id === selectedTaskId
              ? "border-primary ring-2 ring-ring"
              : "border-border/60",
            blocked && "bg-muted/40"
          )}
          onClick={() => selectTask(task.id)}
          onKeyDown={(e) => e.key === "Enter" && selectTask(task.id)}
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

          {task.tracking.type !== "standard" && (
            <Badge
              variant="secondary"
              className="hidden max-w-36 gap-1 truncate tabular-nums md:inline-flex"
            >
              {task.tracking.type === "checkin" ? (
                <CalendarCheck2 className="size-3" />
              ) : (
                <Gauge className="size-3" />
              )}
              {tracking.summary}
            </Badge>
          )}

          {task.tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline" className="hidden lg:inline-flex">
              {tag}
            </Badge>
          ))}
          {task.priority !== "normal" && (
            <Badge variant={task.priority === "high" ? "default" : "secondary"}>
              {PRIORITY_LABEL[task.priority]}
            </Badge>
          )}
          {due && !done && (
            <span
              className={cn(
                "flex items-center gap-1 text-xs tabular-nums",
                due.overdue ? "font-medium text-primary" : "text-muted-foreground"
              )}
            >
              <CalendarDays className="size-3.5" />
              {due.text}
            </span>
          )}
          {task.deps.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-0.5 text-xs text-muted-foreground tabular-nums">
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
                <span className="flex items-center gap-0.5 text-xs text-status-done tabular-nums">
                  <ArrowUpFromDot className="size-3.5" />
                  {dependents}
                </span>
              </TooltipTrigger>
              <TooltipContent>{dependents} 个后续任务等待它</TooltipContent>
            </Tooltip>
          )}
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
  collapsible = false,
  accent,
}: {
  title: string;
  items: Task[];
  byId: Map<string, Task>;
  collapsible?: boolean;
  accent?: string;
}) {
  const [open, setOpen] = useState(!collapsible);
  if (items.length === 0) return null;
  return (
    <section className="mb-5">
      <button
        className={cn(
          "mb-2 flex items-center gap-1.5 text-xs font-medium tracking-[0.2em] text-muted-foreground",
          collapsible && "cursor-pointer hover:text-foreground"
        )}
        onClick={() => collapsible && setOpen(!open)}
        disabled={!collapsible}
      >
        {collapsible &&
          (open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          ))}
        <span className={accent}>{title}</span>
        <Badge variant="secondary" className="h-4.5 px-1.5 tabular-nums">
          {items.length}
        </Badge>
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {items.map((t) => (
            <TaskRow key={t.id} task={t} byId={byId} />
          ))}
        </div>
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

  const [draft, setDraft] = useState("");
  // 搜索框本地即时回显，防抖后再驱动全局过滤，避免每敲一键就重算整棵列表
  const [searchDraft, setSearchDraft] = useDebouncedCommit(search, setSearch, 200);

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
                setTimeout(
                  () =>
                    window.dispatchEvent(new CustomEvent("mailuo:new-project")),
                  50
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
      <header className="px-6 pt-3">
        <div className="mb-3 flex items-center gap-3">
          <Progress
            value={pct}
            className="h-1.5 flex-1 **:data-[slot=progress-indicator]:bg-[var(--indicator)]"
            style={{ "--indicator": project.color } as React.CSSProperties}
          />
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {doneCount}/{projectTasks.length} 已成
            {blockedCount > 0 && (
              <span className="text-primary"> · {blockedCount} 受阻</span>
            )}
          </span>
        </div>
      </header>

      {view === "list" ? (
        <>
          <div className="flex items-center gap-2 px-6 pb-3">
            <InputGroup className="flex-1">
              <InputGroupAddon>
                <Plus />
              </InputGroupAddon>
              <InputGroupInput
                value={draft}
                placeholder="添加一件事，回车记入脉络…"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => isSubmitKey(e, { allowShift: true }) && submitDraft()}
              />
            </InputGroup>
            <Button onClick={submitDraft} disabled={!draft.trim()}>
              添加
            </Button>
          </div>

          <div className="flex items-center gap-2 px-6 pb-3">
            <InputGroup className="flex-1">
              <InputGroupAddon>
                <Search />
              </InputGroupAddon>
              <InputGroupInput
                value={searchDraft}
                placeholder="搜索任务、备注、标签…"
                onChange={(e) => setSearchDraft(e.target.value)}
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
              <SelectTrigger className="w-28">
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

          <div className="flex-1 overflow-y-auto px-6 py-4">
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
                <Group title="进行中" items={groups.doing} byId={byId} />
                <Group title="可着手" items={groups.ready} byId={byId} />
                <Group
                  title="受阻 · 待前置"
                  items={groups.blocked}
                  byId={byId}
                  accent="text-primary"
                />
                <Group
                  title="已完成"
                  items={groups.done}
                  byId={byId}
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
