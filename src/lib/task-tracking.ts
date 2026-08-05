import type {
  CheckInCadence,
  Task,
  TaskTracking,
  TaskType,
} from "@/types";

const MAX_TRACKING_VALUE = 1_000_000_000;

export type TaskTrackingAction =
  | { type: "set-type"; taskType: TaskType }
  | { type: "set-progress"; current?: number; target?: number; unit?: string }
  | { type: "set-checkin"; cadence?: CheckInCadence; target?: number }
  | { type: "toggle-checkin" };

export interface TaskTrackingSnapshot {
  type: TaskType;
  current: number;
  target: number;
  unit: string;
  percent: number;
  complete: boolean;
  summary: string;
  streak: number;
  checkedInCurrentPeriod: boolean;
  currentPeriodLabel: string;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function periodKey(date: Date, cadence: CheckInCadence): string {
  const month = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
  return cadence === "monthly" ? month : `${month}-${pad(date.getDate())}`;
}

function shiftPeriod(key: string, cadence: CheckInCadence, offset: number): string {
  const [year, month, day = 1] = key.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  if (cadence === "daily") date.setDate(date.getDate() + offset);
  else date.setMonth(date.getMonth() + offset);
  return periodKey(date, cadence);
}

function checkInStreak(
  records: string[],
  cadence: CheckInCadence,
  now: Date
): number {
  const recordSet = new Set(records);
  const current = periodKey(now, cadence);
  let cursor = recordSet.has(current)
    ? current
    : shiftPeriod(current, cadence, -1);
  let streak = 0;
  while (recordSet.has(cursor)) {
    streak += 1;
    cursor = shiftPeriod(cursor, cadence, -1);
  }
  return streak;
}

export function normalizeTaskTracking(value: unknown): TaskTracking {
  if (!value || typeof value !== "object") return { type: "standard" };
  const raw = value as Partial<TaskTracking> & Record<string, unknown>;
  if (raw.type === "progress") {
    const target = clamp(finite(raw.target, 100), 0.01, MAX_TRACKING_VALUE);
    return {
      type: "progress",
      current: clamp(finite(raw.current, 0), 0, target),
      target,
      unit:
        typeof raw.unit === "string" && raw.unit.trim()
          ? raw.unit.trim().slice(0, 12)
          : "%",
    };
  }
  if (raw.type === "checkin") {
    const cadence = raw.cadence === "monthly" ? "monthly" : "daily";
    const target = clamp(
      Math.round(finite(raw.target, cadence === "daily" ? 30 : 12)),
      1,
      MAX_TRACKING_VALUE
    );
    const records = Array.isArray(raw.records)
      ? [...new Set(raw.records.filter((entry): entry is string => typeof entry === "string"))]
          .filter((entry) =>
            cadence === "daily"
              ? /^\d{4}-\d{2}-\d{2}$/.test(entry)
              : /^\d{4}-\d{2}$/.test(entry)
          )
          .sort()
      : [];
    return { type: "checkin", cadence, target, records };
  }
  return { type: "standard" };
}

export function taskTrackingSnapshot(
  task: Task,
  now = new Date()
): TaskTrackingSnapshot {
  const tracking = normalizeTaskTracking(task.tracking);
  if (tracking.type === "standard") {
    const complete = task.status === "done";
    return {
      type: "standard",
      current: complete ? 1 : 0,
      target: 1,
      unit: "项",
      percent: complete ? 100 : 0,
      complete,
      summary: complete ? "已完成" : "手动完成",
      streak: 0,
      checkedInCurrentPeriod: false,
      currentPeriodLabel: "",
    };
  }
  if (tracking.type === "progress") {
    const percent = Math.round((tracking.current / tracking.target) * 100);
    return {
      type: "progress",
      current: tracking.current,
      target: tracking.target,
      unit: tracking.unit,
      percent,
      complete: tracking.current >= tracking.target,
      summary: `${tracking.current}/${tracking.target} ${tracking.unit}`,
      streak: 0,
      checkedInCurrentPeriod: false,
      currentPeriodLabel: "",
    };
  }

  const key = periodKey(now, tracking.cadence);
  const current = tracking.records.length;
  return {
    type: "checkin",
    current,
    target: tracking.target,
    unit: "次",
    percent: Math.min(100, Math.round((current / tracking.target) * 100)),
    complete: current >= tracking.target,
    summary: `打卡 ${current}/${tracking.target} 次`,
    streak: checkInStreak(tracking.records, tracking.cadence, now),
    checkedInCurrentPeriod: tracking.records.includes(key),
    currentPeriodLabel: tracking.cadence === "daily" ? "今日" : "本月",
  };
}

function statusForTracking(task: Task, dependenciesComplete: boolean, now: Date): Task {
  if (task.tracking.type === "standard") return task;
  const snapshot = taskTrackingSnapshot(task, now);
  const status =
    snapshot.complete && dependenciesComplete
      ? "done"
      : snapshot.current > 0
        ? "doing"
        : "todo";
  if (status === task.status) return task;
  return {
    ...task,
    status,
    completedAt:
      status === "done"
        ? task.completedAt ?? now.getTime()
        : null,
  };
}

export function updateTaskTracking(
  task: Task,
  action: TaskTrackingAction,
  now = new Date()
): Task {
  const current = normalizeTaskTracking(task.tracking);
  let tracking: TaskTracking = current;
  if (action.type === "set-type") {
    tracking =
      action.taskType === "progress"
        ? { type: "progress", current: 0, target: 100, unit: "%" }
        : action.taskType === "checkin"
          ? { type: "checkin", cadence: "daily", target: 30, records: [] }
          : { type: "standard" };
  } else if (action.type === "set-progress") {
    const previous =
      current.type === "progress"
        ? current
        : { type: "progress" as const, current: 0, target: 100, unit: "%" };
    tracking = normalizeTaskTracking({
      ...previous,
      ...(action.current === undefined ? {} : { current: action.current }),
      ...(action.target === undefined ? {} : { target: action.target }),
      ...(action.unit === undefined ? {} : { unit: action.unit }),
    });
  } else if (action.type === "set-checkin") {
    const cadence = action.cadence ?? (current.type === "checkin" ? current.cadence : "daily");
    const previous =
      current.type === "checkin" && current.cadence === cadence
        ? current
        : {
            type: "checkin" as const,
            cadence,
            target: cadence === "daily" ? 30 : 12,
            records: [],
          };
    tracking = normalizeTaskTracking({
      ...previous,
      ...(action.target === undefined ? {} : { target: action.target }),
    });
  } else if (current.type === "checkin") {
    const key = periodKey(now, current.cadence);
    tracking = {
      ...current,
      records: current.records.includes(key)
        ? current.records.filter((entry) => entry !== key)
        : [...current.records, key].sort(),
    };
  }

  const changed = {
    ...task,
    tracking,
    ...(action.type === "set-type" && action.taskType !== "standard"
      ? { status: "todo" as const, completedAt: null }
      : {}),
  };
  return statusForTracking(changed, true, now);
}

/**
 * 统一派生进度/打卡任务状态，并按依赖完成情况迭代到稳定状态。
 * 这样已达目标但曾受阻的任务会在前置任务完成后自动结项。
 */
export function reconcileTrackedTaskStatuses(
  tasks: Task[],
  now = new Date()
): Task[] {
  let next = tasks;
  for (let pass = 0; pass <= tasks.length; pass += 1) {
    const byId = new Map(next.map((task) => [task.id, task]));
    let changed = false;
    const reconciled = next.map((task) => {
      const dependenciesComplete = task.deps.every(
        (dependencyId) => {
          const dependency = byId.get(dependencyId);
          return dependency === undefined || dependency.status === "done";
        }
      );
      const result = statusForTracking(task, dependenciesComplete, now);
      if (result !== task) changed = true;
      return result;
    });
    next = reconciled;
    if (!changed) break;
  }
  return next;
}
