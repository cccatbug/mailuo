import { z } from "zod";
import { aiModelRefSchema } from "./ai-config";

/* ---------- 定时任务（项目维度，仿 Codex Scheduled Tasks） ---------- */

export const SCHEDULED_RUN_STATUSES = [
  "running",
  "ok",
  "error",
  "missed",
  "cancelled",
] as const;
export type ScheduledRunStatus = (typeof SCHEDULED_RUN_STATUSES)[number];

export const SCHEDULED_RUN_TRIGGER = ["schedule", "manual"] as const;
export type ScheduledRunTrigger = (typeof SCHEDULED_RUN_TRIGGER)[number];

const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "时间格式应为 HH:mm");

export const scheduledTaskScheduleSchema = z.union([
  z.object({
    kind: z.literal("daily"),
    /** HH:mm（24 小时制，本地时区） */
    time: timeSchema,
  }),
  z.object({
    kind: z.literal("weekly"),
    time: timeSchema,
    /** 1=周一 … 7=周日 */
    weekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1, "至少选择一个星期")
      .max(7),
  }),
]);
export type ScheduledTaskSchedule = z.infer<typeof scheduledTaskScheduleSchema>;

export const scheduledJobSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().min(1),
    name: z.string().trim().min(1, "请填写名称").max(80, "名称过长"),
    prompt: z.string().trim().min(1, "提示词不能为空").max(8000, "提示词过长"),
    schedule: scheduledTaskScheduleSchema,
    enabled: z.boolean(),
    /** 覆盖「定时任务」用途路由的模型；null 表示跟随路由配置 */
    modelOverride: aiModelRefSchema.nullable().optional(),
    createdAt: z.number(),
    updatedAt: z.number(),
    lastRunAt: z.number().nullable(),
    lastStatus: z.enum(SCHEDULED_RUN_STATUSES).nullable(),
    /** 下次触发时间（epoch ms）；禁用时为 null */
    nextRunAt: z.number().nullable(),
  })
  .strict();
export type ScheduledJob = z.infer<typeof scheduledJobSchema>;

export const scheduledRunSchema = z
  .object({
    id: z.string().uuid(),
    jobId: z.string().uuid(),
    projectId: z.string(),
    /** job 删除后历史仍可读 */
    jobName: z.string(),
    startedAt: z.number(),
    finishedAt: z.number().nullable(),
    status: z.enum(SCHEDULED_RUN_STATUSES),
    trigger: z.enum(SCHEDULED_RUN_TRIGGER),
    resultMarkdown: z.string().optional(),
    error: z.string().optional(),
  })
  .strict();
export type ScheduledRun = z.infer<typeof scheduledRunSchema>;

export const saveScheduledJobInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    projectId: z.string().min(1),
    name: z.string().trim().min(1, "请填写名称").max(80, "名称过长"),
    prompt: z.string().trim().min(1, "提示词不能为空").max(8000, "提示词过长"),
    schedule: scheduledTaskScheduleSchema,
    enabled: z.boolean(),
    modelOverride: aiModelRefSchema.nullable().optional(),
  })
  .strict();
export type SaveScheduledJobInput = z.infer<typeof saveScheduledJobInputSchema>;

export interface ScheduledTasksSnapshot {
  jobs: ScheduledJob[];
  runs: ScheduledRun[];
}

/**
 * 按 run.id 合并一条运行记录（已存在则替换，不存在则追加）。
 * 主进程既会通过 scheduled:event 推送运行记录，也会在 runNow 的 IPC 返回值里带回同一条，
 * 两路可能先后到达——必须统一用 upsert 合并，否则面板会出现重复行。
 */
export function upsertScheduledRun(
  runs: ScheduledRun[],
  run: ScheduledRun
): ScheduledRun[] {
  return runs.some((item) => item.id === run.id)
    ? runs.map((item) => (item.id === run.id ? run : item))
    : [...runs, run];
}

export type ScheduledEventPayload =
  | { type: "jobs-changed" }
  | { type: "run"; run: ScheduledRun };

/* ---------- 纯函数：描述与下次运行时间 ---------- */

const WEEKDAY_CHARS = "一二三四五六日";

export function isoWeekdayOf(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1;
}

export function parseHHmm(time: string): { hour: number; minute: number } | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * 计算下一次触发时间（本地时区）。
 * daily：下一个 HH:mm；weekly：未来 8 天内首个命中星期且晚于 from 的时刻。
 */
export function computeNextRunAt(
  schedule: ScheduledTaskSchedule,
  from: Date = new Date()
): number {
  const time = parseHHmm(schedule.time);
  if (!time) throw new Error(`无效的时间：${schedule.time}`);
  const weekdays =
    schedule.kind === "weekly" ? new Set(schedule.weekdays) : null;
  const base = new Date(from);
  base.setHours(time.hour, time.minute, 0, 0);
  for (let i = 0; i < 8; i++) {
    const candidate = new Date(base);
    candidate.setDate(base.getDate() + i);
    if (weekdays && !weekdays.has(isoWeekdayOf(candidate))) continue;
    if (candidate.getTime() > from.getTime()) return candidate.getTime();
  }
  throw new Error("无法计算下一次运行时间");
}

export function describeScheduledTaskSchedule(
  schedule: ScheduledTaskSchedule
): string {
  if (schedule.kind === "daily") return `每天 ${schedule.time}`;
  const days = [...schedule.weekdays]
    .sort((a, b) => a - b)
    .map((d) => `周${WEEKDAY_CHARS[d - 1]}`)
    .join("、");
  return `每${days} ${schedule.time}`;
}

/** 距下次运行的友好文案；null 表示未启用 */
export function formatNextRunCountdown(nextRunAt: number | null, now = Date.now()): string {
  if (nextRunAt == null) return "已停用";
  const diff = nextRunAt - now;
  if (diff <= 0) return "即将运行";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "即将运行";
  if (minutes < 60) return `${minutes} 分钟后`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rest = minutes % 60;
    return rest ? `${hours} 小时 ${rest} 分后` : `${hours} 小时后`;
  }
  const days = Math.floor(hours / 24);
  return `${days} 天后`;
}
