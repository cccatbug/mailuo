import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import { CalendarDays, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/types";
import { PRIORITY_LABEL } from "@/types";
import type { GraphDirection } from "@/store/useAppStore";

export type TaskNodeType = Node<
  {
    task: Task;
    blocked: boolean;
    direction: GraphDirection;
    colorSlot: number;
    /** 选中其他任务时，不在其链路内的节点变淡 */
    dimmed: boolean;
    /** 双击进入行内改名 */
    editing: boolean;
    onEditDone: (title: string) => void;
    onEditCancel: () => void;
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
        "task-node-card w-48 rounded-xl border px-3 py-2.5 shadow-sm transition-colors",
        selected && "task-node-selected border-primary ring-2 ring-ring",
        className
      )}
    >
      {children}
    </div>
  );
}

export const TaskNode = memo(function TaskNode({
  data,
  selected,
}: NodeProps<TaskNodeType>) {
  const { task, blocked, direction, colorSlot, dimmed, editing } = data;
  const done = task.status === "done";

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
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-2 shrink-0 rounded-full",
            done && "bg-status-done",
            task.status === "doing" && "bg-status-doing",
            task.status === "todo" && "bg-status-todo"
          )}
        />
        <span
          className={cn(
            "truncate text-sm font-medium",
            done && "text-muted-foreground line-through"
          )}
        >
          {task.title}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground">
          {blocked ? "受阻" : STATUS_TEXT[task.status]}
        </span>
        {blocked && <Lock className="size-3 text-primary" />}
        {task.priority !== "normal" && (
          <Badge
            variant={task.priority === "high" ? "default" : "secondary"}
            className="h-4 px-1.5 text-[10px]"
          >
            {PRIORITY_LABEL[task.priority]}
          </Badge>
        )}
        {task.dueDate && !done && (
          <span className="ml-auto flex items-center gap-1 text-[10px] text-muted-foreground tabular-nums">
            <CalendarDays className="size-3" />
            {task.dueDate.slice(5).replace("-", "/")}
          </span>
        )}
      </div>
      <Handle
        type="source"
        position={direction === "LR" ? Position.Right : Position.Bottom}
        className="!size-2.5 !border-2 !border-background !bg-[var(--graph-node-accent)]"
      />
    </NodeFrame>
  );
});
