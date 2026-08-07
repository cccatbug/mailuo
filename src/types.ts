export type Status = "todo" | "doing" | "done";
export type Priority = "high" | "normal" | "low";
export type TaskType = "standard" | "progress" | "checkin";
export type CheckInCadence = "daily" | "monthly";

export type TaskTracking =
  | { type: "standard" }
  | { type: "progress"; current: number; target: number; unit: string }
  | {
      type: "checkin";
      cadence: CheckInCadence;
      target: number;
      records: string[];
    };

/* ---------- 日期安排 ---------- */

export type ScheduleType = "none" | "once" | "recurring";
export type RecurrenceUnit = "day" | "week" | "month";

/** 重复规则：unit=day + interval=2 即「隔天处理」 */
export interface RecurrenceRule {
  unit: RecurrenceUnit;
  /** 每 interval 个 unit 一次（1-365） */
  interval: number;
  /** unit=week 时限定星期（1=周一 … 7=周日）；空数组表示沿用起始日的星期 */
  weekdays: number[];
  /** unit=month 时限定每月第几天（1-31）；0 表示沿用起始日 */
  monthDay: number;
}

export type TaskSchedule =
  /** 不设日期 */
  | { type: "none" }
  /** 一次性：可选起始日 + 截止日 */
  | { type: "once"; start: string | null; due: string }
  /** 周期性：due 是本轮的处理日，完成一轮后自动滚到下一轮 */
  | {
      type: "recurring";
      start: string;
      due: string;
      rule: RecurrenceRule;
      /** 已完成的轮次 */
      doneCount: number;
      /** 上一轮完成日期 */
      lastDone: string | null;
      /** 结束日期；null 表示无限重复 */
      until: string | null;
    };

export interface Task {
  id: string;
  projectId: string;
  title: string;
  notes: string;
  status: Status;
  priority: Priority;
  /** 生效截止日 YYYY-MM-DD；由 schedule 派生，读取方不必理解 schedule 结构 */
  dueDate: string | null;
  /** 日期安排（截止 / 定期 / 隔天…）；缺省时由 dueDate 迁移得到 */
  schedule?: TaskSchedule;
  tags: string[];
  /** 四象限：重要 / 紧急（旧版布尔，保留做迁移） */
  important?: boolean;
  urgent?: boolean;
  /** 重要程度 0-1（棋盘 y 轴，1=最重要） */
  importance?: number;
  /** 紧急程度 0-1（棋盘 x 轴，1=最紧急） */
  urgency?: number;
  deps: string[]; // 前置任务 id 列表（本任务依赖它们）
  createdAt: number;
  completedAt: number | null;
  tracking: TaskTracking;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  /** Lucide 项目图标键，未设置时用名称首字 */
  icon?: string;
  /** 项目标签（用于侧栏过滤） */
  tags?: string[];
  /** 置顶（列表排序优先） */
  pinned?: boolean;
  /** 归档（收进底部折叠组，不参与日常切换） */
  archived?: boolean;
}

export interface PersistedData {
  version: 4;
  projects: Project[];
  tasks: Task[];
  /** 全局标签库 */
  tagLibrary?: string[];
}

export const STATUS_LABEL: Record<Status, string> = {
  todo: "待办",
  doing: "进行中",
  done: "已完成",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  high: "急",
  normal: "常",
  low: "缓",
};

export const TASK_TYPE_LABEL: Record<TaskType, string> = {
  standard: "普通",
  progress: "进度",
  checkin: "打卡",
};

export const SCHEDULE_TYPE_LABEL: Record<ScheduleType, string> = {
  none: "不限期",
  once: "截止日期",
  recurring: "定期处理",
};

export const RECURRENCE_UNIT_LABEL: Record<RecurrenceUnit, string> = {
  day: "天",
  week: "周",
  month: "月",
};

export const WEEKDAY_LABEL = ["一", "二", "三", "四", "五", "六", "日"] as const;

export const PROJECT_COLORS = [
  "#3E6B58", // 松绿
  "#3D5A80", // 黛蓝
  "#B5483A", // 朱砂
  "#A8842C", // 藤黄
  "#6D5B95", // 青莲
  "#4E7A8A", // 黛青
];
