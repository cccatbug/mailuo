import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import {
  ArrowDownToDot,
  ArrowUpFromDot,
  CalendarCheck2,
  CalendarDays,
  Check,
  Flame,
  Gauge,
  Lock,
  NotebookPen,
  Plus,
  Repeat,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isImeComposing } from "@/lib/keyboard";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/types";
import { PRIORITY_LABEL } from "@/types";
import type { GraphDirection } from "@/store/useAppStore";
import { taskTrackingSnapshot } from "@/lib/task-tracking";
import { describeSchedule, scheduleStatus, taskSchedule } from "@/lib/task-schedule";

export type TaskNodeType = Node<
  {
    task: Task;
    blocked: boolean;
    direction: GraphDirection;
    colorSlot: number;
    /** 直接后续任务数量（由图统一算好，节点不必自己扫全表） */
    dependents: number;
    /** 选中其他任务时，不在其链路内的节点变淡 */
    dimmed: boolean;
    /** 双击进入行内改名 */
    editing: boolean;
    onEditDone: (title: string) => void;
    onEditCancel: () => void;
    /** 卡片上的快捷动作 */
    onComplete: () => void;
    onAddNext: () => void;
  },
  "task"
>;

const STATUS_TEXT: Record<Task["status"], string> = {
  todo: "可着手",
  doing: "进行中",
  done: "已完成",
};

function NodeFrame({
  colorSlot,
  selected,
  className,
  onClick,
  onDoubleClick,
  children,
}: {
  colorSlot: number;
  selected: boolean;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      style={
        {
          "--graph-node-accent": `var(--graph-node-${colorSlot + 1})`,
        } as CSSProperties
      }
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        "task-node-card group/node relative w-60 rounded-xl border px-3 py-2.5 shadow-sm transition-colors",
        selected && "task-node-selected border-primary ring-2 ring-ring",
        className
      )}
    >
      {children}
    </div>
  );
}

/** 卡片右上角的快捷动作，只在悬停或选中时出现 */
function QuickActions({
  task,
  blocked,
  onComplete,
  onAddNext,
}: {
  task: Task;
  blocked: boolean;
  onComplete: () => void;
  onAddNext: () => void;
}) {
  const tracking = taskTrackingSnapshot(task);
  const completeLabel =
    task.tracking.type === "checkin"
      ? tracking.checkedInCurrentPeriod
        ? `撤销${tracking.currentPeriodLabel}打卡`
        : `${tracking.currentPeriodLabel}打卡`
      : task.status === "done"
        ? "恢复为待办"
        : "标记完成";

  return (
    <div className="nodrag absolute -top-2.5 right-2 z-10 flex items-center gap-0.5 rounded-full border bg-popover px-0.5 py-0.5 opacity-0 shadow-sm transition-opacity group-hover/node:opacity-100 has-[:focus-visible]:opacity-100">
      <button
        aria-label={completeLabel}
        title={completeLabel}
        disabled={blocked && task.status !== "done" && task.tracking.type === "standard"}
        className={cn(
          "flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors",
          "hover:bg-status-done/15 hover:text-status-done disabled:pointer-events-none disabled:opacity-40",
          task.tracking.type === "checkin" &&
            tracking.checkedInCurrentPeriod &&
            "text-status-done"
        )}
        onClick={(event) => {
          event.stopPropagation();
          onComplete();
        }}
      >
        {task.tracking.type === "checkin" ? (
          <Flame className="size-3" />
        ) : (
          <Check className="size-3" />
        )}
      </button>
      <button
        aria-label="新建后继任务"
        title="新建一个依赖它的任务"
        className="flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/15 hover:text-primary"
        onClick={(event) => {
          event.stopPropagation();
          onAddNext();
        }}
      >
        <Plus className="size-3" />
      </button>
    </div>
  );
}

export const TaskNode = memo(function TaskNode({
  data,
  selected,
}: NodeProps<TaskNodeType>) {
  const { task, blocked, direction, colorSlot, dimmed, editing, dependents } = data;
  const done = task.status === "done";
  const tracking = taskTrackingSnapshot(task);
  const schedule = taskSchedule(task);
  const scheduleState = scheduleStatus(schedule);

  // 双击进入的行内改名
  if (editing) {
    return (
      <NodeFrame
        colorSlot={colorSlot}
        selected={selected}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          defaultValue={task.title}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (isImeComposing(e)) return;
            if (e.key === "Enter") e.currentTarget.blur();
            else if (e.key === "Escape") {
              e.currentTarget.value = task.title;
              e.currentTarget.blur();
            }
          }}
          onBlur={(e) => {
            const title = e.currentTarget.value.trim();
            if (title && title !== task.title) data.onEditDone(title);
            data.onEditCancel();
          }}
          className="w-full rounded border border-transparent bg-transparent px-0.5 text-sm font-medium outline-none focus:border-primary"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          ⏎ 保存 · Esc 取消
        </p>
      </NodeFrame>
    );
  }

  return (
    <NodeFrame
      colorSlot={colorSlot}
      selected={selected}
      className={cn(dimmed && "task-node-dimmed", done && "task-node-done")}
    >
      <Handle
        type="target"
        position={direction === "LR" ? Position.Left : Position.Top}
        className="!size-2.5 !border-2 !border-background !bg-[var(--graph-node-accent)]"
      />

      {!dimmed && (
        <QuickActions
          task={task}
          blocked={blocked}
          onComplete={data.onComplete}
          onAddNext={data.onAddNext}
        />
      )}

      {/* 第一行：状态点 + 标题 + 优先级 */}
      <div className="flex items-start gap-2">
        <span
          className={cn(
            "mt-1.5 size-2 shrink-0 rounded-full",
            done && "bg-status-done",
            task.status === "doing" && "bg-status-doing",
            task.status === "todo" && "bg-status-todo"
          )}
        />
        <span
          className={cn(
            "min-w-0 flex-1 text-sm leading-snug font-medium",
            // 两行内的标题完整可见，超长才截断——图上最重要的信息就是名字
            "line-clamp-2",
            done && "text-muted-foreground line-through"
          )}
          title={task.title}
        >
          {task.title}
        </span>
        {task.priority !== "normal" && (
          <Badge
            variant={task.priority === "high" ? "default" : "secondary"}
            className="mt-0.5 h-4 shrink-0 px-1.5 text-[10px]"
          >
            {PRIORITY_LABEL[task.priority]}
          </Badge>
        )}
      </div>

      {/* 第二行：状态 + 依赖计数 + 备注标记 */}
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-0.5">
          {blocked && <Lock className="size-2.5 text-primary" />}
          {task.tracking.type === "progress" ? (
            <Gauge className="size-2.5" />
          ) : task.tracking.type === "checkin" ? (
            <CalendarCheck2 className="size-2.5" />
          ) : (
            <Target className="size-2.5" />
          )}
          {blocked ? "受阻" : STATUS_TEXT[task.status]}
        </span>
        {task.deps.length > 0 && (
          <span
            className="flex items-center gap-0.5 tabular-nums"
            title={`${task.deps.length} 个前置任务`}
          >
            <ArrowDownToDot className="size-2.5" />
            {task.deps.length}
          </span>
        )}
        {dependents > 0 && (
          <span
            className="flex items-center gap-0.5 text-status-done tabular-nums"
            title={`${dependents} 个后续任务等待它`}
          >
            <ArrowUpFromDot className="size-2.5" />
            {dependents}
          </span>
        )}
        {task.notes.trim() && (
          <NotebookPen className="size-2.5" aria-label="有备注" />
        )}
        {schedule.type !== "none" && (
          <span
            className={cn(
              "ml-auto flex items-center gap-0.5 tabular-nums",
              scheduleState.state === "overdue"
                ? "font-medium text-destructive"
                : scheduleState.state === "today"
                  ? "font-medium text-primary"
                  : ""
            )}
            title={describeSchedule(schedule)}
          >
            {schedule.type === "recurring" ? (
              <Repeat className="size-2.5" />
            ) : (
              <CalendarDays className="size-2.5" />
            )}
            {scheduleState.state === "overdue"
              ? `逾期${-scheduleState.days}`
              : scheduleState.state === "today"
                ? "今天"
                : scheduleState.state === "tomorrow"
                  ? "明天"
                  : schedule.due.slice(5).replace("-", "/")}
          </span>
        )}
      </div>

      {/* 标签 */}
      {task.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1 overflow-hidden">
          {task.tags.slice(0, 3).map((tag) => (
            <span
              key={tag}
              className="max-w-20 truncate rounded-full bg-foreground/6 px-1.5 py-0.5 text-[9px] text-muted-foreground"
            >
              {tag}
            </span>
          ))}
          {task.tags.length > 3 && (
            <span className="text-[9px] text-muted-foreground/70 tabular-nums">
              +{task.tags.length - 3}
            </span>
          )}
        </div>
      )}

      {/* 进度 / 打卡 */}
      {task.tracking.type !== "standard" && (
        <div className="mt-2">
          <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            <span className="truncate tabular-nums">{tracking.summary}</span>
            <span className="ml-auto shrink-0 tabular-nums">
              {task.tracking.type === "checkin"
                ? `连续 ${tracking.streak}`
                : `${tracking.percent}%`}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${tracking.percent}%` }}
            />
          </div>
        </div>
      )}

      <Handle
        type="source"
        position={direction === "LR" ? Position.Right : Position.Bottom}
        className="!size-2.5 !border-2 !border-background !bg-[var(--graph-node-accent)]"
      />
    </NodeFrame>
  );
});
