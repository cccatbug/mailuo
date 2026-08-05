import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { zhCN } from "date-fns/locale";
import {
  ArrowDownToDot,
  ArrowUpFromDot,
  BookOpen,
  CalendarCheck2,
  CalendarDays,
  ExternalLink,
  Link2,
  Lock,
  Plus,
  ScrollText,
  Sparkles,
  SquareSplitVertical,
  Tag,
  Target,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useAppStore } from "@/store/useAppStore";
import type { Status, Task, TaskType } from "@/types";
import { PRIORITY_LABEL, STATUS_LABEL, TASK_TYPE_LABEL } from "@/types";
import { dependentsOf, isBlocked, wouldCreateCycle } from "@/lib/deps";
import { MiniBoard } from "@/features/matrix/MiniBoard";
import { polishNotesWithToast } from "@/features/tasks/TaskListPanel";
import { Md } from "@/features/ai/Markdown";
import { bridge } from "@/lib/bridge";
import type { AssetRecord } from "@/shared/assets";
import { openResource } from "@/features/files/resource-navigation";
import { taskTrackingSnapshot } from "@/lib/task-tracking";

/** Obsidian 式备注：失焦渲染 markdown，点击进入编辑 */
function NotesEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(!value);
  const projectId = useAppStore((state) => state.selectedProjectId);
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const [assetQuery, setAssetQuery] = useState<string | null>(null);
  if (editing) {
    return (
      <div className="relative">
        {assetQuery !== null && (
          <div className="absolute right-0 bottom-full left-0 z-20 mb-1 max-h-48 overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
            {assets
              .filter((asset) => !asset.trashed && `${asset.name} ${asset.relativePath}`.toLowerCase().includes(assetQuery.toLowerCase()))
              .slice(0, 8)
              .map((asset) => (
                <button
                  key={asset.id}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onChange(value.replace(/#([^\s#]*)$/, `[#${asset.name}](mailuo-asset:${asset.id}) `));
                    setAssetQuery(null);
                  }}
                >
                  <span className="truncate font-medium">#{asset.name}</span>
                  <span className="ml-auto max-w-48 truncate text-[10px] text-muted-foreground">{asset.relativePath}</span>
                </button>
              ))}
          </div>
        )}
        <Textarea
          autoFocus={Boolean(value)}
          value={value}
          placeholder="写点什么…（支持 markdown，输入 # 引用项目资产）"
          className="min-h-24 resize-y font-sans text-sm leading-relaxed"
          onChange={(e) => {
            onChange(e.target.value);
            const match = /(?:^|\s)#([^\s#]*)$/.exec(e.target.value.slice(0, e.target.selectionStart ?? 0));
            setAssetQuery(match?.[1] ?? null);
            if (match && projectId) void bridge?.listAssets(projectId).then(setAssets);
          }}
          onBlur={() => {
            setAssetQuery(null);
            if (value.trim()) setEditing(false);
          }}
        />
      </div>
    );
  }
  return (
    <div
      role="button"
      tabIndex={0}
      title="点击编辑"
      className="min-h-16 cursor-text rounded-md border bg-card px-3 py-2 hover:border-primary/40"
      onClick={() => setEditing(true)}
      onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
    >
      <Md text={value} />
    </div>
  );
}

function StatusDot({ status }: { status: Status }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        status === "done" && "bg-status-done",
        status === "doing" && "bg-status-doing",
        status === "todo" && "bg-status-todo"
      )}
    />
  );
}

function TaskChip({
  task,
  onRemove,
}: {
  task: Task;
  onRemove?: () => void;
}) {
  const selectTask = useAppStore((s) => s.selectTask);
  return (
    <div className="flex items-center overflow-hidden rounded-md border bg-card">
      <button
        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent"
        onClick={() => selectTask(task.id)}
      >
        <StatusDot status={task.status} />
        <span
          className={cn(
            "truncate",
            task.status === "done" && "text-muted-foreground line-through"
          )}
        >
          {task.title}
        </span>
      </button>
      {onRemove && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="rounded-none text-muted-foreground hover:text-destructive"
          aria-label="移除依赖"
          onClick={onRemove}
        >
          <X />
        </Button>
      )}
    </div>
  );
}

/** 上游脉络：递归展开前置链 */
function UpstreamTree({
  task,
  byId,
  depth,
  seen,
}: {
  task: Task;
  byId: Map<string, Task>;
  depth: number;
  seen: Set<string>;
}) {
  const selectTask = useAppStore((s) => s.selectTask);
  if (depth > 6 || seen.has(task.id)) return null;
  const next = new Set(seen);
  next.add(task.id);
  const deps = task.deps
    .map((d) => byId.get(d))
    .filter((t): t is Task => t !== undefined);
  return (
    <div>
      <button
        className={cn(
          "flex w-full items-center gap-2 truncate rounded-md px-2 py-1 text-left text-sm",
          depth === 0 ? "font-medium" : "hover:bg-accent",
          task.status === "done" && "text-muted-foreground line-through"
        )}
        disabled={depth === 0}
        onClick={() => selectTask(task.id)}
      >
        <StatusDot status={task.status} />
        <span className="truncate">{task.title}</span>
      </button>
      {deps.length > 0 && (
        <div className="ml-3 flex flex-col border-l border-dashed pl-2">
          {deps.map((d) => (
            <UpstreamTree
              key={d.id}
              task={d}
              byId={byId}
              depth={depth + 1}
              seen={next}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DepPicker({ task, byId }: { task: Task; byId: Map<string, Task> }) {
  const tasks = useAppStore((s) => s.tasks);
  const addDep = useAppStore((s) => s.addDep);
  const [open, setOpen] = useState(false);

  const candidates = useMemo(
    () =>
      tasks.filter(
        (t) =>
          t.projectId === task.projectId &&
          t.id !== task.id &&
          !task.deps.includes(t.id) &&
          !wouldCreateCycle(task.id, t.id, byId)
      ),
    [tasks, task, byId]
  );

  if (candidates.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-start">
          <Plus data-icon="inline-start" />
          添加前置任务
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="搜索任务…" />
          <CommandList>
            <CommandEmpty>没有可选任务</CommandEmpty>
            <CommandGroup>
              {candidates.map((c) => (
                <CommandItem
                  key={c.id}
                  value={c.title}
                  onSelect={() => {
                    const result = addDep(task.id, c.id);
                    if (result === "ok") {
                      toast.success(`已依赖「${c.title}」`);
                    } else if (result === "cycle") {
                      toast.error("无法建立依赖：会形成循环");
                    }
                    setOpen(false);
                  }}
                >
                  <StatusDot status={c.status} />
                  <span className="truncate">{c.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function TagEditor({ task }: { task: Task }) {
  const addTag = useAppStore((s) => s.addTag);
  const removeTag = useAppStore((s) => s.removeTag);
  const tagLibrary = useAppStore((s) => s.tagLibrary);
  const [draft, setDraft] = useState("");
  const suggestions = tagLibrary
    .filter((t) => !task.tags.includes(t))
    .filter((t) => !draft || t.toLowerCase().includes(draft.toLowerCase()))
    .slice(0, 10);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {task.tags.map((tag) => (
        <Badge key={tag} variant="secondary" className="gap-1 pr-1">
          {tag}
          <button
            aria-label={`移除标签 ${tag}`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
            onClick={() => removeTag(task.id, tag)}
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Input
        value={draft}
        placeholder="＋ 标签"
        className="h-6 w-20 border-dashed px-2 text-xs shadow-none"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim()) {
            addTag(task.id, draft);
            setDraft("");
          }
        }}
      />
      {suggestions.length > 0 && (
        <span className="flex w-full flex-wrap gap-1 pt-0.5">
          {suggestions.map((t) => (
            <button
              key={t}
              className="rounded-full border border-dashed px-1.5 py-0.5 text-[10px] text-muted-foreground hover:border-primary/50 hover:text-foreground"
              onClick={() => {
                addTag(task.id, t);
                setDraft("");
              }}
            >
              ＋{t}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

function TaskTrackingEditor({ task }: { task: Task }) {
  const trackTask = useAppStore((state) => state.trackTask);
  const snapshot = taskTrackingSnapshot(task);
  const tracking = task.tracking;

  return (
    <div className="flex flex-col gap-2.5">
      <ToggleGroup
        type="single"
        variant="outline"
        className="w-full"
        value={tracking.type}
        onValueChange={(value) => {
          if (!value || value === tracking.type) return;
          trackTask(task.id, {
            type: "set-type",
            taskType: value as TaskType,
          });
        }}
      >
        {(["standard", "progress", "checkin"] as TaskType[]).map((type) => (
          <ToggleGroupItem key={type} value={type} className="flex-1">
            {type === "standard" ? (
              <Target />
            ) : type === "progress" ? (
              <BookOpen />
            ) : (
              <CalendarCheck2 />
            )}
            {TASK_TYPE_LABEL[type]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {tracking.type === "standard" && (
        <p className="text-xs text-muted-foreground">
          一次性目标，由你手动标记完成。
        </p>
      )}

      {tracking.type === "progress" && (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">{snapshot.summary}</span>
            <span className="text-muted-foreground tabular-nums">
              {snapshot.percent}%
            </span>
          </div>
          <Progress value={snapshot.percent} className="mb-3 h-1.5" />
          <div className="grid grid-cols-[1fr_1fr_72px] gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              当前
              <Input
                type="number"
                min={0}
                max={tracking.target}
                step="any"
                key={`current-${tracking.current}`}
                defaultValue={tracking.current}
                className="h-7 text-xs tabular-nums"
                onBlur={(event) =>
                  trackTask(task.id, {
                    type: "set-progress",
                    current: Number(event.currentTarget.value),
                  })
                }
                onKeyDown={(event) =>
                  event.key === "Enter" && event.currentTarget.blur()
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              目标
              <Input
                type="number"
                min={1}
                step="any"
                key={`target-${tracking.target}`}
                defaultValue={tracking.target}
                className="h-7 text-xs tabular-nums"
                onBlur={(event) =>
                  trackTask(task.id, {
                    type: "set-progress",
                    target: Number(event.currentTarget.value),
                  })
                }
                onKeyDown={(event) =>
                  event.key === "Enter" && event.currentTarget.blur()
                }
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              单位
              <Input
                key={`unit-${tracking.unit}`}
                defaultValue={tracking.unit}
                maxLength={12}
                className="h-7 text-xs"
                onBlur={(event) =>
                  trackTask(task.id, {
                    type: "set-progress",
                    unit: event.currentTarget.value,
                  })
                }
                onKeyDown={(event) =>
                  event.key === "Enter" && event.currentTarget.blur()
                }
              />
            </label>
          </div>
        </div>
      )}

      {tracking.type === "checkin" && (
        <div className="rounded-lg border bg-card p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-xs">
            <span className="font-medium">{snapshot.summary}</span>
            <span className="text-muted-foreground">
              连续 {snapshot.streak} {tracking.cadence === "daily" ? "天" : "月"}
            </span>
          </div>
          <Progress value={snapshot.percent} className="mb-3 h-1.5" />
          <div className="mb-3 grid grid-cols-[1fr_96px] gap-2">
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              打卡周期
              <ToggleGroup
                type="single"
                variant="outline"
                value={tracking.cadence}
                className="h-7"
                onValueChange={(cadence) => {
                  if (!cadence) return;
                  trackTask(task.id, {
                    type: "set-checkin",
                    cadence: cadence as "daily" | "monthly",
                  });
                }}
              >
                <ToggleGroupItem value="daily" className="h-7 flex-1 text-xs">
                  每日
                </ToggleGroupItem>
                <ToggleGroupItem value="monthly" className="h-7 flex-1 text-xs">
                  每月
                </ToggleGroupItem>
              </ToggleGroup>
            </label>
            <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
              目标次数
              <Input
                type="number"
                min={1}
                key={`checkin-target-${tracking.target}`}
                defaultValue={tracking.target}
                className="h-7 text-xs tabular-nums"
                onBlur={(event) =>
                  trackTask(task.id, {
                    type: "set-checkin",
                    target: Number(event.currentTarget.value),
                  })
                }
                onKeyDown={(event) =>
                  event.key === "Enter" && event.currentTarget.blur()
                }
              />
            </label>
          </div>
          <Button
            variant={snapshot.checkedInCurrentPeriod ? "secondary" : "default"}
            className="w-full"
            onClick={() => trackTask(task.id, { type: "toggle-checkin" })}
          >
            <CalendarCheck2 data-icon="inline-start" />
            {snapshot.checkedInCurrentPeriod
              ? `撤销${snapshot.currentPeriodLabel}打卡`
              : `${snapshot.currentPeriodLabel}打卡`}
          </Button>
          <p className="mt-2 text-[10px] text-muted-foreground">
            同一{tracking.cadence === "daily" ? "自然日" : "自然月"}
            最多记录一次；切换周期会重新开始记录。
          </p>
        </div>
      )}
    </div>
  );
}

interface ResourceLink {
  label: string;
  url: string;
}

/** 从 markdown 备注中提取资源链接：Markdown 链接 [text](url) 和裸 URL */
function extractResources(notes: string): ResourceLink[] {
  const seen = new Set<string>();
  const result: ResourceLink[] = [];

  // Markdown 链接 [text](url)
  const mdLinkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  for (const m of notes.matchAll(mdLinkRe)) {
    const url = m[2].trim();
    if (!seen.has(url)) {
      seen.add(url);
      result.push({ label: m[1].trim() || url, url });
    }
  }

  // 裸 https?:// 和 file:// URL（排除已在 markdown 链接中的）
  const bareRe = /(?<![(\[])(https?:\/\/[^\s<>)]+)|(?<![(\[])(file:\/\/[^\s<>)]+)/g;
  for (const m of notes.matchAll(bareRe)) {
    const url = m[0].replace(/[.,;:!?]*$/, ""); // 去掉末尾标点
    if (!seen.has(url)) {
      seen.add(url);
      const label = url.length > 52 ? url.slice(0, 49) + "..." : url;
      result.push({ label, url });
    }
  }

  return result.slice(0, 12);
}

function ResourcesSection({
  resources,
  projectId,
}: {
  resources: ResourceLink[];
  projectId: string | null;
}) {
  if (resources.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {resources.map((r) => (
        <button
          key={r.url}
          className="flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs text-primary transition-colors hover:border-primary/50 hover:bg-accent"
          title={r.url}
          onClick={() => {
            void openResource(r.url, projectId).catch((error) =>
              toast.error(error instanceof Error ? error.message : "无法打开资源")
            );
          }}
        >
          <ExternalLink className="size-3 shrink-0" />
          <span className="max-w-[180px] truncate">{r.label}</span>
        </button>
      ))}
    </div>
  );
}

export function TaskDetailPanel() {
  const tasks = useAppStore((s) => s.tasks);
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const updateTask = useAppStore((s) => s.updateTask);
  const deleteTask = useAppStore((s) => s.deleteTask);
  const restoreTask = useAppStore((s) => s.restoreTask);
  const setStatus = useAppStore((s) => s.setStatus);
  const removeDep = useAppStore((s) => s.removeDep);
  const projectId = useAppStore((s) => s.selectedProjectId);

  const [dateOpen, setDateOpen] = useState(false);

  const task = tasks.find((t) => t.id === selectedTaskId) ?? null;
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  if (!task) {
    return (
      <aside className="flex h-full min-w-[250px] flex-col overflow-hidden bg-background">
        <div className="flex flex-1 items-center justify-center">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ScrollText />
            </EmptyMedia>
            <EmptyTitle className="font-heading">来龙去脉</EmptyTitle>
            <EmptyDescription>
              选中一件事，细看它的上下游脉络。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
        </div>
      </aside>
    );
  }

  const blocked = isBlocked(task, byId);
  const deps = task.deps
    .map((d) => byId.get(d))
    .filter((t): t is Task => t !== undefined);
  const unfinishedDeps = deps.filter((d) => d.status !== "done").length;
  const dependents = dependentsOf(task.id, tasks);
  const dueDate = task.dueDate ? parseISO(task.dueDate) : undefined;
  const resources = extractResources(task.notes);

  const remove = () => {
    const removed = deleteTask(task.id);
    if (removed) {
      toast(`已删除「${removed.task.title}」`, {
        action: { label: "撤销", onClick: () => restoreTask(removed) },
      });
    }
  };

  return (
    <aside className="flex h-full min-w-[250px] flex-col overflow-hidden bg-background">
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-4 pb-6">
        <Input
          value={task.title}
          onChange={(e) => updateTask(task.id, { title: e.target.value })}
          className="border-none px-0 font-heading text-lg font-bold shadow-none focus-visible:ring-0 dark:bg-transparent"
          aria-label="任务标题"
        />
        <Separator className="mb-4" />

        {blocked && (
          <Alert className="mb-4 border-primary/40 bg-primary/5 text-primary">
            <Lock />
            <AlertTitle>受阻中</AlertTitle>
            <AlertDescription>
              完成 {unfinishedDeps} 件前置任务后方可完成此事。
            </AlertDescription>
          </Alert>
        )}

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel>状态</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              className="w-full"
              value={task.status}
              onValueChange={(v) => {
                if (!v) return;
                if (task.tracking.type !== "standard") return;
                const ok = setStatus(task.id, v as Status);
                if (!ok) toast.warning("前置任务未完成，暂不可完成");
              }}
            >
              {(["todo", "doing", "done"] as Status[]).map((s) => (
                <ToggleGroupItem
                  key={s}
                  value={s}
                  disabled={
                    task.tracking.type !== "standard" ||
                    (s === "done" && blocked)
                  }
                  className="flex-1"
                >
                  {STATUS_LABEL[s]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {task.tracking.type !== "standard" && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                状态随{task.tracking.type === "progress" ? "进度" : "打卡"}
                自动更新。
              </p>
            )}
          </Field>

          <Field>
            <FieldLabel>
              {task.tracking.type === "checkin" ? (
                <CalendarCheck2 className="size-3.5" />
              ) : task.tracking.type === "progress" ? (
                <BookOpen className="size-3.5" />
              ) : (
                <Target className="size-3.5" />
              )}
              任务类型
            </FieldLabel>
            <TaskTrackingEditor task={task} />
          </Field>

          <Field>
            <FieldLabel>
              重要程度
              <span className="font-normal text-muted-foreground">
                · {PRIORITY_LABEL[task.priority]}
              </span>
            </FieldLabel>
            <MiniBoard task={task} />
          </Field>

          <Field>
            <FieldLabel>期限</FieldLabel>
            <div className="flex items-center gap-1.5">
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="flex-1 justify-start font-normal"
                  >
                    <CalendarDays data-icon="inline-start" />
                    {dueDate
                      ? format(dueDate, "yyyy年M月d日 EEEE", { locale: zhCN })
                      : "设定日期"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    locale={zhCN}
                    selected={dueDate}
                    onSelect={(d) => {
                      updateTask(task.id, {
                        dueDate: d ? format(d, "yyyy-MM-dd") : null,
                      });
                      setDateOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
              {task.dueDate && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="清除期限"
                  onClick={() => updateTask(task.id, { dueDate: null })}
                >
                  <X />
                </Button>
              )}
            </div>
          </Field>

          <Field>
            <FieldLabel>
              <Tag className="size-3.5" />
              标签
            </FieldLabel>
            <TagEditor task={task} />
          </Field>

          {resources.length > 0 && (
            <Field>
              <FieldLabel>
                <ExternalLink className="size-3.5" />
                资源链接
              </FieldLabel>
              <ResourcesSection resources={resources} projectId={projectId} />
            </Field>
          )}

          <Field>
            <FieldTitle className="w-full">
              备注
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="AI 撰写或润色备注"
                className="ml-auto text-primary"
                onClick={() => polishNotesWithToast(task.id)}
              >
                <Sparkles />
              </Button>
            </FieldTitle>
            <NotesEditor
              key={task.id}
              value={task.notes}
              onChange={(v) => updateTask(task.id, { notes: v })}
            />
          </Field>

          <Field>
            <FieldLabel>
              <ArrowDownToDot className="size-3.5" />
              前置任务
              <span className="font-normal text-muted-foreground">
                · 须先完成它们
              </span>
            </FieldLabel>
            {deps.length > 0 ? (
              <div className="flex flex-col gap-1.5">
                {deps.map((d) => (
                  <TaskChip
                    key={d.id}
                    task={d}
                    onRemove={() => {
                      removeDep(task.id, d.id);
                      toast("已移除依赖");
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                无 —— 此事可即刻着手
              </p>
            )}
            <DepPicker task={task} byId={byId} />
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start text-primary"
              onClick={() =>
                useAppStore
                  .getState()
                  .setAiDialog({ type: "breakdown", taskId: task.id })
              }
            >
              <SquareSplitVertical data-icon="inline-start" />
              AI 拆解此任务为子任务
            </Button>
          </Field>

          {dependents.length > 0 && (
            <Field>
              <FieldLabel>
                <ArrowUpFromDot className="size-3.5" />
                后续任务
                <span className="font-normal text-muted-foreground">
                  · 正等待此事完成
                </span>
              </FieldLabel>
              <div className="flex flex-col gap-1.5">
                {dependents.map((d) => (
                  <TaskChip key={d.id} task={d} />
                ))}
              </div>
            </Field>
          )}

          {deps.length > 0 && (
            <Field>
              <FieldLabel>
                <Link2 className="size-3.5" />
                上游脉络
              </FieldLabel>
              <div className="rounded-lg border bg-card/50 p-2">
                <UpstreamTree
                  task={task}
                  byId={byId}
                  depth={0}
                  seen={new Set()}
                />
              </div>
            </Field>
          )}
        </FieldGroup>

        <Separator className="my-5" />

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="w-full text-muted-foreground hover:text-destructive"
            >
              <Trash2 data-icon="inline-start" />
              删除此事
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除「{task.title}」？</AlertDialogTitle>
              <AlertDialogDescription>
                {dependents.length > 0
                  ? `有 ${dependents.length} 件后续任务依赖它，删除后这些依赖将被解除。`
                  : "删除后可通过提示中的「撤销」恢复。"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>取消</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={remove}>
                删除
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </aside>
  );
}
