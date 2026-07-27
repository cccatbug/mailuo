import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/useAppStore";
import type { Task } from "@/types";
import { positionOf } from "@/lib/quadrant";

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const PAD = 7; // % 边缘留白（棋子半径）

/** 任务详情里的迷你重要程度棋盘：单颗棋子自由拖放 / 点击落子 */
export function MiniBoard({ task }: { task: Task }) {
  const setImportance = useAppStore((s) => s.setImportance);
  const boardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  const pos = positionOf(task);
  const usable = 100 - PAD * 2;
  const x = drag?.x ?? (1 - pos.urgency) * usable + PAD;
  const y = drag?.y ?? (1 - pos.importance) * usable + PAD;

  const commit = (xPct: number, yPct: number) => {
    setImportance(
      task.id,
      clamp01(1 - (yPct - PAD) / usable),
      clamp01(1 - (xPct - PAD) / usable)
    );
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const board = boardRef.current;
    if (!board) return;
    const rect = board.getBoundingClientRect();
    const toPct = (ev: { clientX: number; clientY: number }) => ({
      x: clamp01((ev.clientX - rect.left) / rect.width) * 100,
      y: clamp01((ev.clientY - rect.top) / rect.height) * 100,
    });
    // 点哪落哪，随后可继续拖
    setDrag(toPct(e));
    const onMove = (ev: PointerEvent) => setDrag(toPct(ev));
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const p = toPct(ev);
      commit(p.x, p.y);
      setDrag(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <div
      ref={boardRef}
      className="relative h-40 w-full cursor-crosshair touch-none overflow-hidden rounded-lg border bg-card/40 select-none"
      onPointerDown={onPointerDown}
    >
      {/* 象限底色 */}
      <div className="pointer-events-none absolute inset-0 grid grid-cols-2 grid-rows-2">
        <div className="bg-[var(--viz-blocked)]/5" />
        <div className="bg-[var(--viz-done)]/5" />
        <div className="bg-[var(--viz-doing)]/5" />
        <div className="bg-[var(--viz-ready)]/5" />
      </div>
      {/* 中轴线 */}
      <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border" />
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border" />
      {/* 角标 */}
      <span className="pointer-events-none absolute top-1 left-1.5 text-[9px] text-[var(--viz-blocked)]/70">
        重要·紧急
      </span>
      <span className="pointer-events-none absolute top-1 right-1.5 text-[9px] text-[var(--viz-done)]/80">
        重要·不紧急
      </span>
      <span className="pointer-events-none absolute bottom-1 left-1.5 text-[9px] text-[var(--viz-doing)]/80">
        紧急·不重要
      </span>
      <span className="pointer-events-none absolute right-1.5 bottom-1 text-[9px] text-muted-foreground/70">
        都不
      </span>

      {/* 棋子 */}
      <div
        className={cn(
          "pointer-events-none absolute z-10 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-primary font-heading text-[10px] font-bold shadow-md transition-transform",
          "bg-gradient-to-b from-card to-muted text-foreground",
          drag && "scale-125 shadow-lg"
        )}
        style={{ left: `${x}%`, top: `${y}%` }}
      >
        {task.title.trim().charAt(0)}
      </div>
    </div>
  );
}
