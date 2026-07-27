import { useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { Task } from "@/types";
import { isBlocked } from "@/lib/deps";
import { positionOf } from "@/lib/quadrant";

/** 棋盘边缘留白（棋子半径），坐标映射时把可用区收进来 */
const PAD = 3.2; // %

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function pctFromPos(importance: number, urgency: number) {
  // x：左=紧急(1) → 右=不紧急(0)；y：上=重要(1) → 下=不重要(0)
  const x = (1 - urgency) * (100 - PAD * 2) + PAD;
  const y = (1 - importance) * (100 - PAD * 2) + PAD;
  return { x, y };
}

function posFromPct(xPct: number, yPct: number) {
  const usable = 100 - PAD * 2;
  return {
    urgency: clamp01(1 - (xPct - PAD) / usable),
    importance: clamp01(1 - (yPct - PAD) / usable),
  };
}

function Piece({
  task,
  blocked,
  boardRef,
}: {
  task: Task;
  blocked: boolean;
  boardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const selectTask = useAppStore((s) => s.selectTask);
  const setImportance = useAppStore((s) => s.setImportance);

  const pos = positionOf(task);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const moved = useRef(false);

  const { x, y } = drag ?? pctFromPos(pos.importance, pos.urgency);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    moved.current = false;
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const toPct = (ev: { clientX: number; clientY: number }) => ({
      x: clamp01((ev.clientX - rect.left) / rect.width) * 100,
      y: clamp01((ev.clientY - rect.top) / rect.height) * 100,
    });
    const onMove = (ev: PointerEvent) => {
      moved.current = true;
      setDrag(toPct(ev));
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved.current) {
        const p = toPct(ev);
        const { importance, urgency } = posFromPct(p.x, p.y);
        setImportance(task.id, importance, urgency);
      } else {
        selectTask(task.id);
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const selected = task.id === selectedTaskId;

  return (
    <div
      className={cn(
        "group absolute z-10 -translate-x-1/2 -translate-y-1/2 select-none",
        drag ? "z-20 cursor-grabbing" : "cursor-grab"
      )}
      style={{ left: `${x}%`, top: `${y}%` }}
      onPointerDown={onPointerDown}
      title={task.title}
    >
      {/* 棋子本体：围棋子质感的圆片 */}
      <div
        className={cn(
          "mx-auto flex size-7 items-center justify-center rounded-full border font-heading text-[11px] font-bold shadow-md transition-transform",
          "bg-gradient-to-b from-card to-muted text-foreground",
          drag && "scale-125 shadow-xl",
          selected && "ring-2 ring-primary ring-offset-1 ring-offset-background",
          blocked && "border-[var(--viz-blocked)] border-dashed"
        )}
        style={{
          borderColor: blocked
            ? undefined
            : task.status === "doing"
              ? "var(--viz-doing)"
              : "var(--border)",
        }}
      >
        {task.title.trim().charAt(0)}
      </div>
      {/* 名签：悬停或拖动时展示 */}
      <div
        className={cn(
          "pointer-events-none absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-md border bg-popover px-1.5 py-0.5 text-[10px] whitespace-nowrap text-popover-foreground opacity-0 shadow-sm transition-opacity",
          (drag || selected) && "opacity-100",
          "group-hover:opacity-100"
        )}
      >
        {task.title.slice(0, 14)}
        {task.title.length > 14 && "…"}
      </div>
    </div>
  );
}

/** 重要程度棋盘：自由拖动棋子，坐标即「重要 × 紧急」 */
export function MatrixPanel({
  tasks,
  byId,
}: {
  tasks: Task[];
  byId: Map<string, Task>;
}) {
  const boardRef = useRef<HTMLDivElement>(null);
  const open = useMemo(() => tasks.filter((t) => t.status !== "done"), [tasks]);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <div
        ref={boardRef}
        className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl border bg-card/30"
      >
        {/* 象限底色 */}
        <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
          <div className="bg-[var(--viz-blocked)]/4" />
          <div className="bg-[var(--viz-done)]/4" />
          <div className="bg-[var(--viz-doing)]/4" />
          <div className="bg-[var(--viz-ready)]/4" />
        </div>
        {/* 中轴线 */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border" />
        {/* 轴向文字 */}
        <span className="pointer-events-none absolute top-1.5 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.3em] text-muted-foreground">
          重要 ↑
        </span>
        <span className="pointer-events-none absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] tracking-[0.3em] text-muted-foreground">
          ↓ 不重要
        </span>
        <span className="pointer-events-none absolute top-1/2 left-1.5 -translate-y-1/2 text-[10px] tracking-[0.2em] text-muted-foreground [writing-mode:vertical-rl]">
          ← 紧急
        </span>
        <span className="pointer-events-none absolute top-1/2 right-1.5 -translate-y-1/2 text-[10px] tracking-[0.2em] text-muted-foreground [writing-mode:vertical-rl]">
          不紧急 →
        </span>
        {/* 象限角标 */}
        <span className="pointer-events-none absolute top-6 left-3 text-[10px] font-medium text-[var(--viz-blocked)]/70">
          马上做
        </span>
        <span className="pointer-events-none absolute top-6 right-3 text-[10px] font-medium text-[var(--viz-done)]/80">
          安排计划
        </span>
        <span className="pointer-events-none absolute bottom-6 left-3 text-[10px] font-medium text-[var(--viz-doing)]/80">
          快速处理 / 委托
        </span>
        <span className="pointer-events-none absolute right-3 bottom-6 text-[10px] font-medium text-muted-foreground">
          有空再说
        </span>

        {open.map((t) => (
          <Piece
            key={t.id}
            task={t}
            blocked={isBlocked(t, byId)}
            boardRef={boardRef}
          />
        ))}

        {open.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            没有未完成的任务
          </div>
        )}
      </div>
      <p className="pt-2 text-center text-[11px] text-muted-foreground">
        自由拖动棋子——位置即「重要程度 × 紧急程度」，优先级自动同步；单击棋子查看详情
      </p>
    </div>
  );
}
