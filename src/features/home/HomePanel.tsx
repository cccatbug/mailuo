import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Check,
  ChevronRight,
  CircleDashed,
  Flame,
  Gauge,
  ListTree,
  Lock,
  Plus,
  Repeat,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppStore, type StatusFilter } from "@/store/useAppStore";
import type { Project, Task } from "@/types";
import { PRIORITY_LABEL } from "@/types";
import { isSubmitKey } from "@/lib/keyboard";
import { taskTrackingSnapshot } from "@/lib/task-tracking";
import { scheduleStatus, taskSchedule, todayISO } from "@/lib/task-schedule";
import { buildOverview, type ProjectOverview } from "./overview";

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function greeting(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 14) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

function Section({
  icon: Icon,
  title,
  count,
  tone,
  action,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  tone?: "primary" | "destructive" | "warning";
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card">
      <header className="flex items-center gap-2 border-b px-3.5 py-2">
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            tone === "destructive"
              ? "text-destructive"
              : tone === "warning"
                ? "text-status-doing"
                : tone === "primary"
                  ? "text-primary"
                  : "text-muted-foreground"
          )}
        />
        <h3 className="text-xs font-medium">{title}</h3>
        {count !== undefined && (
          <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
        )}
        <div className="ml-auto">{action}</div>
      </header>
      {children}
    </section>
  );
}

/** 概览数字块：一眼看清盘子里有多少事 */
function Stat({
  label,
  value,
  suffix,
  tone,
  onClick,
}: {
  label: string;
  value: number | string;
  suffix?: string;
  tone?: "primary" | "destructive" | "warning" | "done";
  onClick?: () => void;
}) {
  return (
    <button
      disabled={!onClick}
      onClick={onClick}
      className={cn(
        "flex flex-col items-start gap-0.5 rounded-lg border bg-card px-3 py-2 text-left transition-colors",
        onClick && "hover:border-primary/40 hover:bg-accent/40"
      )}
    >
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span
        className={cn(
          "font-heading text-xl leading-none font-bold tabular-nums",
          tone === "destructive" && "text-destructive",
          tone === "warning" && "text-status-doing",
          tone === "primary" && "text-primary",
          tone === "done" && "text-status-done"
        )}
      >
        {value}
        {suffix && (
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">
            {suffix}
          </span>
        )}
      </span>
    </button>
  );
}

/** 主页里的一行任务：状态、标题、日期、快捷完成 */
function TaskLine({
  task,
  today,
  showProject,
  projects,
}: {
  task: Task;
  today: string;
  showProject?: boolean;
  projects?: Project[];
}) {
  const selectTask = useAppStore((s) => s.selectTask);
  const selectProject = useAppStore((s) => s.selectProject);
  const setStatus = useAppStore((s) => s.setStatus);
  const trackTask = useAppStore((s) => s.trackTask);
  const schedule = taskSchedule(task);
  const status = scheduleStatus(schedule, today);
  const tracking = taskTrackingSnapshot(task);
  const project = showProject
    ? projects?.find((p) => p.id === task.projectId)
    : undefined;

  const complete = () => {
    if (task.tracking.type === "checkin") {
      trackTask(task.id, { type: "toggle-checkin" });
      toast.success(`已${tracking.currentPeriodLabel}打卡`);
      return;
    }
    if (task.tracking.type === "progress") {
      selectTask(task.id);
      return;
    }
    if (!setStatus(task.id, "done")) {
      toast.warning("前置任务未完成，暂不可完成");
      return;
    }
    toast.success(
      schedule.type === "recurring"
        ? `已完成本轮，下次处理日已顺延`
        : `已完成「${task.title}」`
    );
  };

  return (
    <div className="group flex items-center gap-2 px-3.5 py-1.5 transition-colors hover:bg-accent/30">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={task.tracking.type === "checkin" ? "打卡" : "标记完成"}
            className="flex size-5 shrink-0 items-center justify-center rounded-full border border-muted-foreground/40 text-transparent transition-colors hover:border-status-done hover:bg-status-done hover:text-white"
            onClick={complete}
          >
            <Check className="size-3" />
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {task.tracking.type === "checkin"
            ? `${tracking.currentPeriodLabel}打卡`
            : task.tracking.type === "progress"
              ? "在详情里调整进度"
              : "标记完成"}
        </TooltipContent>
      </Tooltip>

      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onClick={() => {
          if (showProject && task.projectId) selectProject(task.projectId);
          selectTask(task.id);
        }}
      >
        <span className="min-w-0 truncate text-sm">{task.title}</span>
        {project && (
          <span
            className="shrink-0 rounded-full px-1.5 py-0.5 text-[10px]"
            style={{
              background: `color-mix(in oklch, ${project.color} 16%, transparent)`,
              color: project.color,
            }}
          >
            {project.name}
          </span>
        )}
        {task.priority === "high" && (
          <span className="shrink-0 text-[10px] font-medium text-primary">
            {PRIORITY_LABEL.high}
          </span>
        )}
      </button>

      {task.tracking.type !== "standard" && (
        <span className="hidden shrink-0 items-center gap-1 text-[10px] text-muted-foreground tabular-nums sm:flex">
          {task.tracking.type === "checkin" ? (
            <CalendarCheck2 className="size-3" />
          ) : (
            <Gauge className="size-3" />
          )}
          {tracking.summary}
        </span>
      )}

      {schedule.type !== "none" && (
        <span
          className={cn(
            "shrink-0 text-[10px] tabular-nums",
            status.state === "overdue"
              ? "font-medium text-destructive"
              : status.state === "today"
                ? "font-medium text-primary"
                : "text-muted-foreground"
          )}
        >
          {schedule.type === "recurring" && (
            <Repeat className="mr-0.5 inline size-2.5" />
          )}
          {status.state === "overdue"
            ? `逾期 ${-status.days} 天`
            : status.state === "today"
              ? "今天"
              : status.state === "tomorrow"
                ? "明天"
                : (status.due ?? "").slice(5).replace("-", "/")}
        </span>
      )}
    </div>
  );
}

function TaskLines({
  tasks,
  today,
  limit = 6,
  emptyText,
  showProject,
  projects,
}: {
  tasks: Task[];
  today: string;
  limit?: number;
  emptyText: string;
  showProject?: boolean;
  projects?: Project[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (tasks.length === 0) {
    return (
      <p className="px-3.5 py-3 text-xs text-muted-foreground">{emptyText}</p>
    );
  }
  const shown = expanded ? tasks : tasks.slice(0, limit);
  return (
    <div className="flex flex-col py-1">
      {shown.map((task) => (
        <TaskLine
          key={task.id}
          task={task}
          today={today}
          showProject={showProject}
          projects={projects}
        />
      ))}
      {tasks.length > limit && (
        <button
          className="mx-3.5 mt-1 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
        >
          <ChevronRight
            className={cn("size-3 transition-transform", expanded && "rotate-90")}
          />
          {expanded ? "收起" : `还有 ${tasks.length - limit} 项`}
        </button>
      )}
    </div>
  );
}

/** 最近两周的新增 / 完成活动条 */
function ActivityStrip({ overview }: { overview: ProjectOverview }) {
  const peak = Math.max(
    1,
    ...overview.activity.map((day) => Math.max(day.created, day.completed))
  );
  return (
    <div className="flex items-end gap-1 px-3.5 py-3">
      {overview.activity.map((day) => (
        <Tooltip key={day.date}>
          <TooltipTrigger asChild>
            <div className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <div className="flex h-14 w-full items-end justify-center gap-0.5">
                <div
                  className="w-1/2 rounded-t-sm bg-muted-foreground/25"
                  style={{ height: `${(day.created / peak) * 100}%` }}
                />
                <div
                  className="w-1/2 rounded-t-sm bg-[var(--viz-done)]"
                  style={{ height: `${(day.completed / peak) * 100}%` }}
                />
              </div>
              <span className="text-[9px] text-muted-foreground tabular-nums">
                {day.date.slice(8)}
              </span>
            </div>
          </TooltipTrigger>
          <TooltipContent>
            {day.date} · 新增 {day.created} · 完成 {day.completed}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

export function HomePanel({
  tasks,
  project,
}: {
  tasks: Task[];
  project: Project;
}) {
  const projects = useAppStore((s) => s.projects);
  const allTasks = useAppStore((s) => s.tasks);
  const addTask = useAppStore((s) => s.addTask);
  const setView = useAppStore((s) => s.setView);
  const setStatusFilter = useAppStore((s) => s.setStatusFilter);
  const setAssistantOpen = useAppStore((s) => s.setAssistantOpen);
  const setAiDialog = useAppStore((s) => s.setAiDialog);
  const [draft, setDraft] = useState("");

  const today = todayISO();
  const now = new Date();
  const overview = useMemo(() => {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return buildOverview(tasks, byId, today);
  }, [tasks, today]);

  // 跨项目的今天：主页也要回答「今天我一共有多少事」
  const crossProject = useMemo(() => {
    const byId = new Map(allTasks.map((t) => [t.id, t]));
    const other = allTasks.filter((t) => t.projectId !== project.id);
    const overall = buildOverview(other, byId, today);
    return [...overall.buckets.overdue, ...overall.buckets.today];
  }, [allTasks, project.id, today]);

  const goList = (filter: StatusFilter) => {
    setStatusFilter(filter);
    setView("list");
  };

  const submitDraft = () => {
    if (!draft.trim()) return;
    const task = addTask(draft);
    if (task) {
      toast.success(`已添加「${task.title}」`);
      setDraft("");
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-5 py-5">
        {/* 问候与今日总览 */}
        <header className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground tabular-nums">
            {now.getMonth() + 1} 月 {now.getDate()} 日 · {WEEKDAYS[now.getDay()]}
          </p>
          <h2 className="font-heading text-2xl font-bold">
            {greeting(now.getHours())}
            {overview.focus.length > 0
              ? `，今天有 ${overview.focus.length} 件事值得推进`
              : "，今天没有安排"}
          </h2>
          <p className="text-sm text-muted-foreground">
            「{project.name}」共 {overview.total} 件事，已完成 {overview.doneCount} 件
            {overview.completedThisWeek > 0 &&
              ` · 本周完成 ${overview.completedThisWeek} 件`}
          </p>
        </header>

        <div className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3">
          <Progress
            value={overview.percent}
            className="h-1.5 flex-1 **:data-[slot=progress-indicator]:bg-[var(--indicator)]"
            style={{ "--indicator": project.color } as React.CSSProperties}
          />
          <span className="shrink-0 font-heading text-lg font-bold tabular-nums">
            {overview.percent}%
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat
            label="逾期"
            value={overview.buckets.overdue.length}
            tone={overview.buckets.overdue.length > 0 ? "destructive" : undefined}
          />
          <Stat
            label="今天"
            value={overview.buckets.today.length}
            tone={overview.buckets.today.length > 0 ? "primary" : undefined}
          />
          <Stat
            label="进行中"
            value={overview.doingCount}
            tone={overview.doingCount > 0 ? "warning" : undefined}
            onClick={() => goList("doing")}
          />
          <Stat
            label="受阻"
            value={overview.blockedCount}
            onClick={() => goList("blocked")}
          />
        </div>

        {/* 快速添加 */}
        <InputGroup>
          <InputGroupAddon>
            <Plus />
          </InputGroupAddon>
          <InputGroupInput
            value={draft}
            placeholder="想到什么就记下来，回车记入脉络…"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) =>
              isSubmitKey(event, { allowShift: true }) && submitDraft()
            }
          />
        </InputGroup>

        {/* 今天该做什么 */}
        <Section
          icon={Target}
          title="今天推进"
          count={overview.focus.length}
          tone="primary"
          action={
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-[11px] text-muted-foreground"
              onClick={() => goList("all")}
            >
              全部任务
              <ArrowRight data-icon="inline-end" />
            </Button>
          }
        >
          <TaskLines
            tasks={overview.focus}
            today={today}
            limit={8}
            emptyText="今天没有待处理的事。可以看看「即将到来」，或者先规划一下。"
          />
        </Section>

        {overview.buckets.overdue.length > 0 && (
          <Section
            icon={AlertTriangle}
            title="已逾期"
            count={overview.buckets.overdue.length}
            tone="destructive"
          >
            <TaskLines
              tasks={overview.buckets.overdue}
              today={today}
              emptyText=""
            />
          </Section>
        )}

        {overview.buckets.checkinPending.length > 0 && (
          <Section
            icon={Flame}
            title="今天还没打卡"
            count={overview.buckets.checkinPending.length}
            tone="warning"
          >
            <TaskLines
              tasks={overview.buckets.checkinPending}
              today={today}
              emptyText=""
            />
          </Section>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Section
            icon={CalendarClock}
            title="即将到来"
            count={overview.buckets.tomorrow.length + overview.buckets.soon.length}
          >
            <TaskLines
              tasks={[...overview.buckets.tomorrow, ...overview.buckets.soon]}
              today={today}
              limit={5}
              emptyText="未来一周没有安排好的事。"
            />
          </Section>

          <Section
            icon={CircleDashed}
            title="进行中"
            count={overview.doingCount}
            tone="warning"
          >
            <TaskLines
              tasks={overview.buckets.doing}
              today={today}
              limit={5}
              emptyText="手上没有正在推进的事。"
            />
          </Section>
        </div>

        {crossProject.length > 0 && (
          <Section
            icon={CalendarDays}
            title="其他项目的今天"
            count={crossProject.length}
          >
            <TaskLines
              tasks={crossProject}
              today={today}
              limit={5}
              emptyText=""
              showProject
              projects={projects}
            />
          </Section>
        )}

        {overview.blockedCount > 0 && (
          <Section
            icon={Lock}
            title="受阻 · 等待前置"
            count={overview.blockedCount}
            tone="primary"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-[11px] text-muted-foreground"
                onClick={() => setView("graph")}
              >
                看脉络图
                <ListTree data-icon="inline-end" />
              </Button>
            }
          >
            <TaskLines
              tasks={overview.buckets.blocked}
              today={today}
              limit={5}
              emptyText=""
            />
          </Section>
        )}

        <Section icon={TrendingUp} title="最近两周" >
          <ActivityStrip overview={overview} />
          <div className="flex items-center gap-3 border-t px-3.5 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-muted-foreground/25" />
              新增
            </span>
            <span className="flex items-center gap-1">
              <span className="size-2 rounded-sm bg-[var(--viz-done)]" />
              完成
            </span>
            <span className="ml-auto">
              本周完成 {overview.completedThisWeek} 件
            </span>
          </div>
        </Section>

        {overview.tagStats.length > 0 && (
          <Section icon={ListTree} title="标签分布" count={overview.tagStats.length}>
            <div className="flex flex-wrap gap-1.5 px-3.5 py-3">
              {overview.tagStats.slice(0, 14).map((entry) => (
                <button
                  key={entry.tag}
                  className="flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-[11px] transition-colors hover:border-primary/40"
                  onClick={() => {
                    useAppStore.getState().setSearch(entry.tag);
                    goList("all");
                  }}
                >
                  <span>{entry.tag}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {entry.done}/{entry.total}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        )}

        {overview.total === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Target />
              </EmptyMedia>
              <EmptyTitle>这个项目还是一张白纸</EmptyTitle>
              <EmptyDescription>
                记下第一件事，或者让小枢帮你把目标拆成一条脉络。
              </EmptyDescription>
            </EmptyHeader>
            <div className="flex items-center gap-2">
              <Button
                onClick={() =>
                  setAiDialog({ type: "plan", projectId: project.id })
                }
              >
                <Sparkles data-icon="inline-start" />
                AI 规划项目
              </Button>
              <Button variant="outline" onClick={() => setAssistantOpen(true)}>
                与小枢对话
              </Button>
            </div>
          </Empty>
        )}

        <p className="pb-2 text-center text-[11px] text-muted-foreground/70">
          主页会随日期自动更新 · 定期任务完成后会自动顺延到下一次
        </p>
      </div>
    </div>
  );
}
