import type {
  RecurrenceRule,
  RecurrenceUnit,
  Task,
  TaskSchedule,
} from "@/types";
import { RECURRENCE_UNIT_LABEL, WEEKDAY_LABEL } from "@/types";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MAX_INTERVAL = 365;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** 本地日期 → YYYY-MM-DD（不经 UTC，避免跨时区把日期挪掉一天） */
export function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** YYYY-MM-DD → 当天正午的本地 Date（正午可避开夏令时边界） */
export function fromISODate(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

/** 两个日期相差的自然天数（b - a），只看日期部分 */
export function daysBetween(a: string, b: string): number {
  const from = fromISODate(a).getTime();
  const to = fromISODate(b).getTime();
  return Math.round((to - from) / 86_400_000);
}

export function addDaysISO(value: string, days: number): string {
  const date = fromISODate(value);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

/** ISO 星期：1=周一 … 7=周日 */
export function isoWeekday(value: string): number {
  const day = fromISODate(value).getDay();
  return day === 0 ? 7 : day;
}

function isISO(value: unknown): value is string {
  return typeof value === "string" && ISO.test(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeRule(value: unknown): RecurrenceRule {
  const raw = (value ?? {}) as Partial<RecurrenceRule>;
  const unit: RecurrenceUnit =
    raw.unit === "week" || raw.unit === "month" ? raw.unit : "day";
  const weekdays =
    unit === "week" && Array.isArray(raw.weekdays)
      ? [...new Set(raw.weekdays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7))].sort(
          (a, b) => a - b
        )
      : [];
  return {
    unit,
    interval: clampInt(raw.interval, 1, MAX_INTERVAL, 1),
    weekdays,
    monthDay: unit === "month" ? clampInt(raw.monthDay, 0, 31, 0) : 0,
  };
}

/**
 * 把任意存档值收敛成合法安排。
 *
 * 老存档只有 dueDate，没有 schedule：传入 legacyDue 即可平滑迁移，
 * 这样列表、脉络图和统计里已有的期限不会在升级后凭空消失。
 */
export function normalizeTaskSchedule(
  value: unknown,
  legacyDue?: string | null
): TaskSchedule {
  if (!value || typeof value !== "object") {
    return isISO(legacyDue) ? { type: "once", start: null, due: legacyDue } : { type: "none" };
  }
  const raw = value as Record<string, unknown>;

  if (raw.type === "once") {
    const due = isISO(raw.due) ? raw.due : isISO(legacyDue) ? legacyDue : null;
    if (!due) return { type: "none" };
    const start = isISO(raw.start) && raw.start <= due ? raw.start : null;
    return { type: "once", start, due };
  }

  if (raw.type === "recurring") {
    const rule = normalizeRule(raw.rule);
    const start = isISO(raw.start)
      ? raw.start
      : isISO(raw.due)
        ? (raw.due as string)
        : isISO(legacyDue)
          ? legacyDue
          : todayISO();
    const due = alignToRule(isISO(raw.due) ? raw.due : start, start, rule);
    const until = isISO(raw.until)
      ? raw.until < due
        ? due
        : raw.until
      : null;
    return {
      type: "recurring",
      start,
      // due 必须落在规则的合法日期上，否则「下一次」会一直算错
      due,
      rule,
      doneCount: clampInt(raw.doneCount, 0, 1_000_000, 0),
      lastDone: isISO(raw.lastDone) ? raw.lastDone : null,
      until,
    };
  }

  return { type: "none" };
}

function monthOffset(anchor: string, candidate: string): number {
  const from = fromISODate(anchor);
  const to = fromISODate(candidate);
  return (
    (to.getFullYear() - from.getFullYear()) * 12 +
    to.getMonth() -
    from.getMonth()
  );
}

function monthOccurrence(
  anchor: string,
  offset: number,
  monthDay: number
): string {
  const date = fromISODate(anchor);
  const targetDay = monthDay > 0 ? monthDay : date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  const lastDay = new Date(
    date.getFullYear(),
    date.getMonth() + 1,
    0
  ).getDate();
  date.setDate(Math.min(targetDay, lastDay));
  return toISODate(date);
}

/** 规则允许的最早日期（从 from 起，含 from；anchor 是周期锚点） */
function alignToRule(from: string, anchor: string, rule: RecurrenceRule): string {
  const start = from < anchor ? anchor : from;
  if (rule.unit === "day") {
    const gap = daysBetween(anchor, start);
    if (gap <= 0) return anchor;
    const remainder = gap % rule.interval;
    return remainder === 0 ? start : addDaysISO(start, rule.interval - remainder);
  }
  if (rule.unit === "week") {
    const weekdays =
      rule.weekdays.length > 0 ? rule.weekdays : [isoWeekday(anchor)];
    const anchorWeekStart = addDaysISO(anchor, 1 - isoWeekday(anchor));
    // 最坏只需跨过 interval 个周块，再在目标周内找 7 天。
    for (let offset = 0; offset <= rule.interval * 7 + 7; offset += 1) {
      const candidate = addDaysISO(start, offset);
      if (!weekdays.includes(isoWeekday(candidate))) continue;
      const candidateWeekStart = addDaysISO(
        candidate,
        1 - isoWeekday(candidate)
      );
      const week = Math.floor(
        daysBetween(anchorWeekStart, candidateWeekStart) / 7
      );
      if (week >= 0 && week % rule.interval === 0) return candidate;
    }
    return start;
  }

  let offset = Math.max(0, monthOffset(anchor, start));
  const remainder = offset % rule.interval;
  if (remainder !== 0) offset += rule.interval - remainder;
  let candidate = monthOccurrence(anchor, offset, rule.monthDay);
  if (candidate < start) {
    offset += rule.interval;
    candidate = monthOccurrence(anchor, offset, rule.monthDay);
  }
  return candidate;
}

/** 下一次处理日；from 之后的第一个规则日期 */
export function nextOccurrence(
  from: string,
  rule: RecurrenceRule,
  anchor = from
): string {
  return alignToRule(addDaysISO(from, 1), anchor, rule);
}

/** 完成一轮后滚动到下一轮；到达 until 后返回 null（安排结束） */
export function advanceRecurring(
  schedule: Extract<TaskSchedule, { type: "recurring" }>,
  completedOn = todayISO()
): TaskSchedule {
  const next = nextOccurrence(schedule.due, schedule.rule, schedule.start);
  if (schedule.until && next > schedule.until) {
    return { type: "once", start: schedule.start, due: schedule.due };
  }
  return {
    ...schedule,
    due: next,
    doneCount: schedule.doneCount + 1,
    lastDone: completedOn,
  };
}

/** 生效截止日：列表、图和统计都读这一个值 */
export function effectiveDue(schedule: TaskSchedule): string | null {
  return schedule.type === "none" ? null : schedule.due;
}

export function scheduleStart(schedule: TaskSchedule): string | null {
  if (schedule.type === "once") return schedule.start;
  if (schedule.type === "recurring") return schedule.start;
  return null;
}

/** 把 dueDate 写进 schedule（右键菜单「今天 / 明天」这类快捷入口用） */
export function scheduleWithDue(
  schedule: TaskSchedule,
  due: string | null
): TaskSchedule {
  if (!due) return { type: "none" };
  if (schedule.type === "recurring") {
    return normalizeTaskSchedule({ ...schedule, due });
  }
  const start = schedule.type === "once" && schedule.start && schedule.start <= due
    ? schedule.start
    : null;
  return { type: "once", start, due };
}

/** 读取任务的安排（老任务按 dueDate 迁移） */
export function taskSchedule(task: Task): TaskSchedule {
  return normalizeTaskSchedule(task.schedule, task.dueDate);
}

/**
 * 让 schedule 与 dueDate 永远一致。
 *
 * 两个字段各有各的入口——右键菜单只知道 dueDate，安排编辑器只知道 schedule——
 * 所以每次写任务都从这里过一遍，谁也不会把另一个甩在后面。
 */
export function applyDatePatch(
  task: Task,
  patch: { dueDate?: string | null; schedule?: TaskSchedule } = {}
): Task {
  const current = taskSchedule(task);
  const schedule =
    patch.schedule !== undefined
      ? normalizeTaskSchedule(patch.schedule)
      : patch.dueDate !== undefined
        ? scheduleWithDue(current, patch.dueDate)
        : current;
  const dueDate = effectiveDue(schedule);
  if (task.schedule === schedule && task.dueDate === dueDate) return task;
  return { ...task, schedule, dueDate };
}

/**
 * 完成一个定期任务：滚到下一轮而不是就此结项。
 *
 * 返回 null 表示这不是定期任务，调用方按普通完成处理。
 */
export function completeRecurring(task: Task, on = todayISO()): Task | null {
  const schedule = taskSchedule(task);
  if (schedule.type !== "recurring") return null;
  const next = advanceRecurring(schedule, on);
  return {
    ...task,
    schedule: next,
    dueDate: effectiveDue(next),
    // 滚到下一轮就重新变成待办；结项要靠改安排或删任务
    status: next.type === "recurring" ? ("todo" as const) : ("done" as const),
    completedAt: next.type === "recurring" ? null : Date.now(),
  };
}

export type ScheduleState =
  | "none"
  | "overdue"
  | "today"
  | "tomorrow"
  | "soon"
  | "later"
  | "upcoming";

export interface ScheduleStatus {
  state: ScheduleState;
  /** 距离处理日的自然天数：负数表示已逾期 */
  days: number;
  due: string | null;
  /** 起始日还没到（一次性任务的准备期） */
  notStarted: boolean;
}

/** soon 的界线：一周内都算「即将」，主页据此聚合 */
const SOON_DAYS = 7;

export function scheduleStatus(
  schedule: TaskSchedule,
  today = todayISO()
): ScheduleStatus {
  const due = effectiveDue(schedule);
  if (!due) return { state: "none", days: 0, due: null, notStarted: false };
  const start = scheduleStart(schedule);
  const notStarted = start !== null && start > today;
  const days = daysBetween(today, due);
  const state: ScheduleState =
    days < 0
      ? "overdue"
      : days === 0
        ? "today"
        : days === 1
          ? "tomorrow"
          : days <= SOON_DAYS
            ? "soon"
            : "later";
  return { state, days, due, notStarted };
}

/** 一句话描述，用在卡片、列表和小枢上下文里 */
export function describeSchedule(schedule: TaskSchedule): string {
  if (schedule.type === "none") return "不限期";
  const shortDue = schedule.due.slice(5).replace("-", "/");
  if (schedule.type === "once") {
    return schedule.start
      ? `${schedule.start.slice(5).replace("-", "/")} → ${shortDue}`
      : `截止 ${shortDue}`;
  }
  return `${describeRule(schedule.rule)} · 下次 ${shortDue}`;
}

export function describeRule(rule: RecurrenceRule): string {
  if (rule.unit === "day") {
    if (rule.interval === 1) return "每天";
    if (rule.interval === 2) return "隔天";
    return `每 ${rule.interval} 天`;
  }
  if (rule.unit === "week") {
    const every = rule.interval === 1 ? "每周" : `每 ${rule.interval} 周`;
    if (rule.weekdays.length === 0) return every;
    const names = rule.weekdays.map((day) => WEEKDAY_LABEL[day - 1]).join("、");
    return `${every}${names}`;
  }
  const every = rule.interval === 1 ? "每月" : `每 ${rule.interval} 个月`;
  return rule.monthDay > 0 ? `${every} ${rule.monthDay} 日` : every;
}

export const RECURRENCE_PRESETS: {
  key: string;
  label: string;
  rule: RecurrenceRule;
}[] = [
  { key: "daily", label: "每天", rule: { unit: "day", interval: 1, weekdays: [], monthDay: 0 } },
  { key: "every-2-days", label: "隔天", rule: { unit: "day", interval: 2, weekdays: [], monthDay: 0 } },
  { key: "weekly", label: "每周", rule: { unit: "week", interval: 1, weekdays: [], monthDay: 0 } },
  { key: "weekdays", label: "工作日", rule: { unit: "week", interval: 1, weekdays: [1, 2, 3, 4, 5], monthDay: 0 } },
  { key: "biweekly", label: "每两周", rule: { unit: "week", interval: 2, weekdays: [], monthDay: 0 } },
  { key: "monthly", label: "每月", rule: { unit: "month", interval: 1, weekdays: [], monthDay: 0 } },
];

export function unitLabel(unit: RecurrenceUnit): string {
  return RECURRENCE_UNIT_LABEL[unit];
}
