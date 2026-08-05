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

export interface Task {
  id: string;
  projectId: string;
  title: string;
  notes: string;
  status: Status;
  priority: Priority;
  dueDate: string | null; // YYYY-MM-DD
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
  version: 3;
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

export const PROJECT_COLORS = [
  "#3E6B58", // 松绿
  "#3D5A80", // 黛蓝
  "#B5483A", // 朱砂
  "#A8842C", // 藤黄
  "#6D5B95", // 青莲
  "#4E7A8A", // 黛青
];
