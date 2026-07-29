import type { Task } from "@/types";

export const TASK_COLOR_SLOT_COUNT = 24;

function hashTaskId(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function assignTaskColorSlots(tasks: Task[]): Map<string, number> {
  const ordered = [...tasks].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  );
  const known = new Set(ordered.map((task) => task.id));
  const neighbors = new Map<string, Set<string>>(
    ordered.map((task) => [task.id, new Set<string>()])
  );
  for (const task of ordered) {
    for (const dependencyId of task.deps) {
      if (!known.has(dependencyId)) continue;
      neighbors.get(task.id)?.add(dependencyId);
      neighbors.get(dependencyId)?.add(task.id);
    }
  }

  const assigned = new Map<string, number>();
  for (const task of ordered) {
    const unavailable = new Set(
      [...(neighbors.get(task.id) ?? [])]
        .map((id) => assigned.get(id))
        .filter((slot): slot is number => slot !== undefined)
    );
    if (assigned.size < TASK_COLOR_SLOT_COUNT) {
      for (const slot of assigned.values()) unavailable.add(slot);
    }
    const start = hashTaskId(task.id) % TASK_COLOR_SLOT_COUNT;
    let slot = start;
    for (let offset = 0; offset < TASK_COLOR_SLOT_COUNT; offset += 1) {
      const candidate = (start + offset) % TASK_COLOR_SLOT_COUNT;
      if (!unavailable.has(candidate)) {
        slot = candidate;
        break;
      }
    }
    assigned.set(task.id, slot);
  }
  return assigned;
}
