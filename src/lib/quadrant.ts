import type { Priority, Task } from "@/types";

export interface Quadrant {
  important: boolean;
  urgent: boolean;
}

/** id 派生的确定性抖动（避免同优先级棋子完全重叠） */
function jitter(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return ((h >>> 8) % 1000) / 1000; // 0..1
}

/**
 * 任务在棋盘上的连续坐标（importance/urgency ∈ 0..1）。
 * 优先读连续值 → 旧版布尔 → priority 推导（带确定性抖动）。
 */
export function positionOf(task: Task): { importance: number; urgency: number } {
  if (task.importance !== undefined && task.urgency !== undefined) {
    return { importance: task.importance, urgency: task.urgency };
  }
  const spread = (base: number, j: number) => base + (j - 0.5) * 0.18;
  if (task.important !== undefined || task.urgent !== undefined) {
    return {
      importance: spread(task.important ? 0.75 : 0.25, jitter(task.id, 7)),
      urgency: spread(task.urgent ? 0.75 : 0.25, jitter(task.id, 13)),
    };
  }
  switch (task.priority) {
    case "high":
      return {
        importance: spread(0.78, jitter(task.id, 7)),
        urgency: spread(0.78, jitter(task.id, 13)),
      };
    case "low":
      return {
        importance: spread(0.25, jitter(task.id, 7)),
        urgency: spread(0.25, jitter(task.id, 13)),
      };
    default:
      return {
        importance: spread(0.72, jitter(task.id, 7)),
        urgency: spread(0.28, jitter(task.id, 13)),
      };
  }
}

export function quadrantOf(task: Task): Quadrant {
  const pos = positionOf(task);
  return { important: pos.importance >= 0.5, urgent: pos.urgency >= 0.5 };
}

/** 坐标 → 优先级（保持列表排序/徽章一致） */
export function priorityFromPosition(importance: number, urgency: number): Priority {
  const important = importance >= 0.5;
  const urgent = urgency >= 0.5;
  if (important && urgent) return "high";
  if (!important && !urgent) return "low";
  return "normal";
}

export function priorityFromQuadrant(q: Quadrant): Priority {
  return priorityFromPosition(q.important ? 0.75 : 0.25, q.urgent ? 0.75 : 0.25);
}

export const QUADRANTS: {
  key: string;
  important: boolean;
  urgent: boolean;
  title: string;
  hint: string;
  color: string;
}[] = [
  {
    key: "q1",
    important: true,
    urgent: true,
    title: "重要 · 紧急",
    hint: "马上做",
    color: "var(--viz-blocked)",
  },
  {
    key: "q2",
    important: true,
    urgent: false,
    title: "重要 · 不紧急",
    hint: "安排计划",
    color: "var(--viz-done)",
  },
  {
    key: "q3",
    important: false,
    urgent: true,
    title: "紧急 · 不重要",
    hint: "快速处理 / 委托",
    color: "var(--viz-doing)",
  },
  {
    key: "q4",
    important: false,
    urgent: false,
    title: "不重要 · 不紧急",
    hint: "有空再说",
    color: "var(--viz-ready)",
  },
];
