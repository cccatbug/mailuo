import type { Task } from "@/types";

/** 任务是否受阻：存在未完成的前置任务 */
export function isBlocked(task: Task, byId: Map<string, Task>): boolean {
  if (task.status === "done") return false;
  return task.deps.some((d) => {
    const dep = byId.get(d);
    return dep !== undefined && dep.status !== "done";
  });
}

/** 直接后续任务（依赖了 taskId 的任务） */
export function dependentsOf(taskId: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => t.deps.includes(taskId));
}

/**
 * 若让 taskId 依赖 depId，是否会形成环：
 * 即 depId 沿它的前置链能否到达 taskId。
 */
export function wouldCreateCycle(
  taskId: string,
  depId: string,
  byId: Map<string, Task>
): boolean {
  if (taskId === depId) return true;
  const seen = new Set<string>();
  const stack = [depId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === taskId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const t = byId.get(cur);
    if (t) stack.push(...t.deps);
  }
  return false;
}
