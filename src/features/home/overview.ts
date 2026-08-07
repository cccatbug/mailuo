import type { Task } from "@/types";
import { isBlocked } from "@/lib/deps";
import { taskTrackingSnapshot } from "@/lib/task-tracking";
import {
  daysBetween,
  scheduleStatus,
  taskSchedule,
  todayISO,
} from "@/lib/task-schedule";

export interface TaskBuckets {
  /** 处理日已经过去 */
  overdue: Task[];
  /** 今天要处理 */
  today: Task[];
  /** 明天要处理 */
  tomorrow: Task[];
  /** 一周内要处理 */
  soon: Task[];
  doing: Task[];
  /** 待办且没有未完成前置 */
  ready: Task[];
  blocked: Task[];
  done: Task[];
  /** 本周期还没打卡的打卡任务 */
  checkinPending: Task[];
}

export interface DayActivity {
  date: string;
  created: number;
  completed: number;
}

export interface ProjectOverview {
  today: string;
  total: number;
  doneCount: number;
  doingCount: number;
  todoCount: number;
  blockedCount: number;
  percent: number;
  buckets: TaskBuckets;
  /** 建议今天推进的事：逾期 → 今天 → 进行中 → 高优先可着手 */
  focus: Task[];
  /** 最近 7 天完成的事，最新在前 */
  recentlyCompleted: Task[];
  /** 最近 14 天的新增 / 完成活动 */
  activity: DayActivity[];
  /** 本周（最近 7 天）完成数 */
  completedThisWeek: number;
  /** 标签分布，按数量降序 */
  tagStats: { tag: string; total: number; done: number }[];
}

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 } as const;

/** 逾期最狠的排前面；同样紧急时高优先级先做 */
function byUrgency(a: Task, b: Task): number {
  const aDue = a.dueDate ?? "9999-12-31";
  const bDue = b.dueDate ?? "9999-12-31";
  if (aDue !== bDue) return aDue < bDue ? -1 : 1;
  return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
}

function isoDayList(today: string, days: number): string[] {
  const result: string[] = [];
  const base = new Date(`${today}T12:00:00`);
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(base);
    date.setDate(date.getDate() - offset);
    result.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
        date.getDate()
      ).padStart(2, "0")}`
    );
  }
  return result;
}

function timestampDay(value: number): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}`;
}

export function buildOverview(
  tasks: Task[],
  byId: Map<string, Task>,
  today = todayISO()
): ProjectOverview {
  const buckets: TaskBuckets = {
    overdue: [],
    today: [],
    tomorrow: [],
    soon: [],
    doing: [],
    ready: [],
    blocked: [],
    done: [],
    checkinPending: [],
  };
  const notStartedIds = new Set<string>();

  for (const task of tasks) {
    if (task.status === "done") {
      buckets.done.push(task);
      continue;
    }
    const blocked = isBlocked(task, byId);
    if (blocked) buckets.blocked.push(task);
    else if (task.status === "doing") buckets.doing.push(task);
    else buckets.ready.push(task);

    // 未开始的任务（起始日还没到）不该混进今天的待办里
    const status = scheduleStatus(taskSchedule(task), today);
    if (status.notStarted) {
      notStartedIds.add(task.id);
      continue;
    }
    if (task.tracking.type === "checkin") {
      const snapshot = taskTrackingSnapshot(task);
      if (!snapshot.checkedInCurrentPeriod) buckets.checkinPending.push(task);
    }
    if (status.state === "overdue") buckets.overdue.push(task);
    else if (status.state === "today") buckets.today.push(task);
    else if (status.state === "tomorrow") buckets.tomorrow.push(task);
    else if (status.state === "soon") buckets.soon.push(task);
  }

  for (const key of Object.keys(buckets) as (keyof TaskBuckets)[]) {
    if (key !== "done") buckets[key].sort(byUrgency);
  }
  buckets.done.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));

  // 今天该做什么：先救火，再推进手上的事，最后才是新开的高优先事项
  const focusIds = new Set<string>();
  const focus: Task[] = [];
  const push = (list: Task[]) => {
    for (const task of list) {
      if (focusIds.has(task.id)) continue;
      focusIds.add(task.id);
      focus.push(task);
    }
  };
  push(buckets.overdue);
  push(buckets.today);
  push(buckets.checkinPending);
  push(buckets.doing.filter((task) => !notStartedIds.has(task.id)));
  push(
    buckets.ready.filter(
      (task) => task.priority === "high" && !notStartedIds.has(task.id)
    )
  );

  const weekAgo = Date.now() - 7 * 86_400_000;
  const activityDays = isoDayList(today, 14);
  const activityIndex = new Map(
    activityDays.map((date) => [date, { date, created: 0, completed: 0 }])
  );
  for (const task of tasks) {
    const created = activityIndex.get(timestampDay(task.createdAt));
    if (created) created.created += 1;
    if (task.completedAt) {
      const completed = activityIndex.get(timestampDay(task.completedAt));
      if (completed) completed.completed += 1;
    }
  }

  const tagTotals = new Map<string, { tag: string; total: number; done: number }>();
  for (const task of tasks) {
    for (const tag of task.tags) {
      const entry = tagTotals.get(tag) ?? { tag, total: 0, done: 0 };
      entry.total += 1;
      if (task.status === "done") entry.done += 1;
      tagTotals.set(tag, entry);
    }
  }

  const doneCount = buckets.done.length;
  return {
    today,
    total: tasks.length,
    doneCount,
    doingCount: buckets.doing.length,
    todoCount: buckets.ready.length + buckets.blocked.length,
    blockedCount: buckets.blocked.length,
    percent: tasks.length === 0 ? 0 : Math.round((doneCount / tasks.length) * 100),
    buckets,
    focus,
    recentlyCompleted: buckets.done.filter(
      (task) => (task.completedAt ?? 0) >= weekAgo
    ),
    activity: activityDays.map((date) => activityIndex.get(date)!),
    completedThisWeek: buckets.done.filter(
      (task) => (task.completedAt ?? 0) >= weekAgo
    ).length,
    tagStats: [...tagTotals.values()].sort((a, b) => b.total - a.total),
  };
}

/** 逾期天数，供列表和卡片显示 */
export function overdueDays(task: Task, today = todayISO()): number {
  if (!task.dueDate) return 0;
  return Math.max(0, -daysBetween(today, task.dueDate));
}
