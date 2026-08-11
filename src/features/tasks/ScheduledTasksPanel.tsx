import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  Pencil,
  Play,
  Plus,
  Repeat,
  Square,
  Trash2,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import { useScheduledTasksStore } from "@/store/useScheduledTasksStore";
import { Md } from "@/features/ai/Markdown";
import {
  describeScheduledTaskSchedule,
  formatNextRunCountdown,
  type ScheduledJob,
  type ScheduledRun,
  type ScheduledRunStatus,
} from "@/shared/scheduled-tasks";
import { ScheduledTaskEditorDialog } from "./ScheduledTaskEditorDialog";

const RUN_STATUS_LABEL: Record<ScheduledRunStatus, string> = {
  running: "运行中",
  ok: "已完成",
  error: "失败",
  missed: "已错过",
  cancelled: "已取消",
};

function RunStatusIcon({ status, className }: { status: ScheduledRunStatus; className?: string }) {
  switch (status) {
    case "running":
      return <Loader2 className={cn("size-3.5 animate-spin text-primary", className)} />;
    case "ok":
      return <CheckCircle2 className={cn("size-3.5 text-emerald-500", className)} />;
    case "error":
      return <XCircle className={cn("size-3.5 text-red-500", className)} />;
    case "missed":
      return <Clock3 className={cn("size-3.5 text-muted-foreground", className)} />;
    case "cancelled":
      return <Ban className={cn("size-3.5 text-muted-foreground", className)} />;
  }
}

/** 小号开关（UI 库未提供 Switch，就地实现） */
function MiniSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted-foreground/25"
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 size-3 rounded-full bg-background shadow-sm transition-transform",
          checked && "translate-x-3"
        )}
      />
    </button>
  );
}

function formatDuration(run: ScheduledRun): string | null {
  if (run.finishedAt == null) return null;
  const seconds = Math.max(0, Math.round((run.finishedAt - run.startedAt) / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function formatNextRunAt(nextRunAt: number | null): string {
  if (nextRunAt == null) return "—";
  const date = new Date(nextRunAt);
  const weekday = "周" + "一二三四五六日"[(date.getDay() + 6) % 7];
  return `${format(date, "MM-dd")}（${weekday}）${format(date, "HH:mm")}`;
}

/* ---------- 任务卡片（左栏） ---------- */

function JobCard({
  job,
  projectName,
  projectColor,
  selected,
  running,
  now,
  onSelect,
  onToggle,
}: {
  job: ScheduledJob;
  projectName: string;
  projectColor: string;
  selected: boolean;
  running: boolean;
  now: number;
  onSelect: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const status: ScheduledRunStatus = running ? "running" : (job.lastStatus ?? "ok");
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-lg border bg-card p-2.5 text-left transition-all",
        selected
          ? "border-primary/40 bg-accent/70 shadow-sm"
          : "hover:border-foreground/15 hover:bg-accent/40",
        !job.enabled && !selected && "opacity-55"
      )}
    >
      <div className="flex items-center gap-1.5">
        <RunStatusIcon status={status} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {job.name}
        </span>
        <MiniSwitch checked={job.enabled} onChange={onToggle} label={`启用「${job.name}」`} />
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-xs text-muted-foreground">
        <Repeat className="size-3 shrink-0" />
        <span className="shrink-0">{describeScheduledTaskSchedule(job.schedule)}</span>
        <span className="opacity-50">·</span>
        <span
          className={cn(
            "truncate tabular-nums",
            job.enabled && job.nextRunAt != null && job.nextRunAt - now < 3_600_000 && "text-primary"
          )}
        >
          {formatNextRunCountdown(job.nextRunAt, now)}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="size-1.5 shrink-0 rounded-full" style={{ background: projectColor }} />
        <span className="truncate">{projectName}</span>
      </div>
    </button>
  );
}

/* ---------- 运行历史行 ---------- */

function RunRow({
  run,
  onCancel,
}: {
  run: ScheduledRun;
  onCancel: (runId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const duration = formatDuration(run);
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left text-xs transition-colors hover:bg-accent/40"
        onClick={() => setExpanded((v) => !v)}
      >
        <RunStatusIcon status={run.status} />
        <span className="font-medium">{RUN_STATUS_LABEL[run.status]}</span>
        <span className="tabular-nums text-muted-foreground">
          {format(new Date(run.startedAt), "MM-dd HH:mm")}
        </span>
        {duration && (
          <span className="rounded bg-muted px-1 py-px tabular-nums text-muted-foreground">
            {duration}
          </span>
        )}
        <span
          className={cn(
            "rounded px-1 py-px",
            run.trigger === "manual"
              ? "bg-primary/10 text-primary"
              : "bg-muted text-muted-foreground"
          )}
        >
          {run.trigger === "manual" ? "手动" : "定时"}
        </span>
        {run.status === "running" ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto size-5"
            aria-label="停止运行"
            onClick={(e) => {
              e.stopPropagation();
              onCancel(run.id);
            }}
          >
            <Square className="size-3" />
          </Button>
        ) : (
          <ChevronRight
            className={cn(
              "ml-auto size-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
          />
        )}
      </button>
      {expanded && run.status !== "running" && (
        <div className="border-t bg-muted/30 px-3 py-2.5">
          {run.error ? (
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-red-500">{run.error}</p>
          ) : run.resultMarkdown ? (
            <Md text={run.resultMarkdown} />
          ) : (
            <p className="text-xs text-muted-foreground">没有产出内容</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------- 主面板 ---------- */

export function ScheduledTasksPanel() {
  const jobs = useScheduledTasksStore((s) => s.jobs);
  const runs = useScheduledTasksStore((s) => s.runs);
  const loaded = useScheduledTasksStore((s) => s.loaded);
  const error = useScheduledTasksStore((s) => s.error);
  const load = useScheduledTasksStore((s) => s.load);
  const filterProjectId = useScheduledTasksStore((s) => s.filterProjectId);
  const setFilterProject = useScheduledTasksStore((s) => s.setFilterProject);
  const removeJob = useScheduledTasksStore((s) => s.remove);
  const setEnabled = useScheduledTasksStore((s) => s.setEnabled);
  const runNow = useScheduledTasksStore((s) => s.runNow);
  const cancelRun = useScheduledTasksStore((s) => s.cancelRun);

  const projects = useAppStore((s) => s.projects);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);
  const [deleting, setDeleting] = useState<ScheduledJob | null>(null);
  const [busyRunNow, setBusyRunNow] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    void load();
  }, [load]);

  // 倒计时每分钟刷新一次
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const projectMap = useMemo(
    () => new Map(projects.map((p) => [p.id, p])),
    [projects]
  );

  const visibleJobs = useMemo(() => {
    const list = filterProjectId
      ? jobs.filter((j) => j.projectId === filterProjectId)
      : jobs;
    return [...list].sort((a, b) => {
      if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
      return (a.nextRunAt ?? Infinity) - (b.nextRunAt ?? Infinity);
    });
  }, [jobs, filterProjectId]);

  const selected = jobs.find((j) => j.id === selectedId) ?? null;
  const selectedRuns = useMemo(
    () =>
      runs
        .filter((r) => r.jobId === selected?.id)
        .sort((a, b) => b.startedAt - a.startedAt),
    [runs, selected?.id]
  );
  const selectedRunning = selectedRuns.some((r) => r.status === "running");
  const enabledCount = visibleJobs.filter((j) => j.enabled).length;

  const openNew = () => {
    setEditingJob(null);
    setEditorOpen(true);
  };
  const openEdit = (job: ScheduledJob) => {
    setEditingJob(job);
    setEditorOpen(true);
  };

  const handleToggle = async (job: ScheduledJob, enabled: boolean) => {
    try {
      await setEnabled(job.id, enabled);
      toast(enabled ? `「${job.name}」已启用` : `「${job.name}」已停用`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "操作失败");
    }
  };

  const handleRunNow = async (job: ScheduledJob) => {
    setBusyRunNow(true);
    try {
      await runNow(job.id);
      toast(`「${job.name}」开始运行`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "启动失败");
    } finally {
      setBusyRunNow(false);
    }
  };

  const handleDelete = async (job: ScheduledJob) => {
    try {
      await removeJob(job.id);
      if (selectedId === job.id) setSelectedId(null);
      toast(`已删除「${job.name}」`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "删除失败");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      {/* 工具栏 */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-background/80 px-2 backdrop-blur">
        <Select
          value={filterProjectId ?? "all"}
          onValueChange={(v) => setFilterProject(v === "all" ? null : v)}
        >
          <SelectTrigger className="h-7 w-40 text-xs" aria-label="按项目过滤">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部项目</SelectItem>
            {projects.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: p.color }} />
                  {p.name}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {visibleJobs.length > 0 && (
          <span className="text-xs text-muted-foreground">
            {visibleJobs.length} 个任务 · {enabledCount} 个启用
          </span>
        )}
        <div className="flex-1" />
        <Button size="sm" className="h-7 gap-1 text-xs" onClick={openNew}>
          <Plus className="size-3.5" />
          新建定时任务
        </Button>
      </div>

      {!loaded ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">加载中…</span>
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : visibleJobs.length === 0 ? (
        /* 空状态 */
        <div className="flex flex-1 items-center justify-center p-8">
          <Empty className="border-none">
            <EmptyMedia variant="icon">
              <CalendarClock />
            </EmptyMedia>
            <EmptyTitle>还没有定时任务</EmptyTitle>
            <EmptyDescription>
              让{filterProjectId ? "这个项目的" : ""}小枢在固定时间自动执行预设的提示词并生成报告，
              比如每周五 18:00 汇总本周的任务进展。
            </EmptyDescription>
            <EmptyContent>
              <Button size="sm" className="gap-1" onClick={openNew}>
                <Plus className="size-3.5" />
                新建定时任务
              </Button>
            </EmptyContent>
          </Empty>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          {/* 左栏：任务列表 */}
          <div className="flex w-[300px] shrink-0 flex-col border-r bg-background/40">
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-2 p-2">
                {visibleJobs.map((job) => {
                  const project = projectMap.get(job.projectId);
                  return (
                    <JobCard
                      key={job.id}
                      job={job}
                      projectName={project?.name ?? "未知项目"}
                      projectColor={project?.color ?? "#888"}
                      selected={job.id === selectedId}
                      running={runs.some((r) => r.jobId === job.id && r.status === "running")}
                      now={now}
                      onSelect={() => setSelectedId(job.id)}
                      onToggle={(enabled) => void handleToggle(job, enabled)}
                    />
                  );
                })}
              </div>
            </ScrollArea>
          </div>

          {/* 右栏：详情与历史 */}
          <div className="flex min-w-0 flex-1 flex-col">
            {selected ? (
              <>
                <div className="flex h-10 shrink-0 items-center gap-1.5 border-b bg-background/60 px-3">
                  <RunStatusIcon status={selectedRunning ? "running" : (selected.lastStatus ?? "ok")} />
                  <h2 className="min-w-0 truncate text-sm font-semibold">{selected.name}</h2>
                  {!selected.enabled && (
                    <span className="rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                      已停用
                    </span>
                  )}
                  <div className="flex-1" />
                  {selectedRunning ? (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="停止运行"
                      onClick={() => {
                        const running = selectedRuns.find((r) => r.status === "running");
                        if (running) void cancelRun(running.id);
                      }}
                    >
                      <Square className="size-3.5" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title="立即运行"
                      disabled={busyRunNow}
                      onClick={() => void handleRunNow(selected)}
                    >
                      {busyRunNow ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="编辑"
                    onClick={() => openEdit(selected)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title="删除"
                    className="text-muted-foreground hover:text-red-500"
                    onClick={() => setDeleting(selected)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <ScrollArea className="min-h-0 flex-1">
                  <div className="mx-auto max-w-2xl space-y-3 p-4">
                    {/* 概要 */}
                    <div className="rounded-lg border bg-card">
                      <dl className="grid grid-cols-[64px_1fr] gap-y-2 p-3 text-sm">
                        <dt className="text-muted-foreground">执行时间</dt>
                        <dd>{describeScheduledTaskSchedule(selected.schedule)}</dd>
                        <dt className="text-muted-foreground">下次运行</dt>
                        <dd className="tabular-nums">
                          {selected.enabled ? formatNextRunAt(selected.nextRunAt) : "已停用"}
                        </dd>
                        <dt className="text-muted-foreground">所属项目</dt>
                        <dd className="flex items-center gap-1.5">
                          <span
                            className="size-2 rounded-full"
                            style={{ background: projectMap.get(selected.projectId)?.color ?? "#888" }}
                          />
                          {projectMap.get(selected.projectId)?.name ?? "未知项目"}
                        </dd>
                        <dt className="text-muted-foreground">模型</dt>
                        <dd className="text-muted-foreground">
                          {selected.modelOverride ? selected.modelOverride.modelId : "跟随「定时任务」路由"}
                        </dd>
                        {selected.lastRunAt != null && (
                          <>
                            <dt className="text-muted-foreground">上次运行</dt>
                            <dd className="flex items-center gap-1.5 tabular-nums">
                              {selected.lastStatus && <RunStatusIcon status={selected.lastStatus} />}
                              {format(new Date(selected.lastRunAt), "MM-dd HH:mm")}
                            </dd>
                          </>
                        )}
                      </dl>
                    </div>

                    {/* 提示词 */}
                    <div className="rounded-lg border bg-card p-3">
                      <div className="mb-1.5 text-xs font-medium text-muted-foreground">提示词</div>
                      <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap font-sans text-[13px] leading-relaxed">
                        {selected.prompt}
                      </pre>
                    </div>

                    {/* 运行历史 */}
                    <div>
                      <div className="mb-2 text-xs font-medium text-muted-foreground">
                        运行历史（{selectedRuns.length}）
                      </div>
                      {selectedRuns.length === 0 ? (
                        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                          还没有运行记录，点击右上方「立即运行」试一次
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {selectedRuns.map((run) => (
                            <RunRow
                              key={run.id}
                              run={run}
                              onCancel={(runId) => void cancelRun(runId)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </ScrollArea>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center p-8">
                <Empty className="border-none">
                  <EmptyMedia variant="icon">
                    <CalendarClock />
                  </EmptyMedia>
                  <EmptyTitle>选择一个定时任务</EmptyTitle>
                  <EmptyDescription>
                    在左侧查看任务详情、运行历史，或立即运行一轮。
                  </EmptyDescription>
                </Empty>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部提示 */}
      <div className="shrink-0 border-t bg-background/60 px-3 py-1.5 text-center text-[11px] text-muted-foreground">
        定时任务只在脉络运行时执行 · macOS 关闭窗口后仍会按时运行，Windows / Linux 请保持应用开启
      </div>

      {/* 编辑弹窗与删除确认 */}
      <ScheduledTaskEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        job={editingJob}
        defaultProjectId={filterProjectId}
      />
      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{deleting?.name}」？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后不再按时执行，历史运行记录也会一并清除，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 text-white hover:bg-red-600"
              onClick={() => {
                if (deleting) void handleDelete(deleting);
                setDeleting(null);
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
