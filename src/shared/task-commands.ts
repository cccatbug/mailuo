/**
 * 小枢操作任务的通道。
 *
 * 任务数据活在渲染进程的 store 里，工具却跑在主进程，所以走和浏览器标签页命令
 * 同一套「主进程发请求、渲染进程执行并回执」的模式。工具层不理解任务结构，
 * 只负责把 payload 原样送过去、把结果原样带回来。
 */
export type TaskCommandAction =
  | "list_tasks"
  | "task_detail"
  | "create_tasks"
  | "update_tasks"
  | "delete_tasks"
  | "link_tasks"
  | "list_projects"
  | "switch_project";

export interface TaskCommand {
  requestId: string;
  action: TaskCommandAction;
  payload: Record<string, unknown>;
}

export interface TaskCommandResult {
  requestId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** 工具返回给模型的任务视图；字段名对模型友好，不是内部结构 */
export interface TaskView {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  blocked: boolean;
  priority: "high" | "normal" | "low";
  project: string;
  projectId: string;
  tags: string[];
  /** 一句话描述日期安排，例如「隔天 · 下次 08/09」 */
  schedule: string;
  due: string | null;
  /** 逾期天数；未逾期为 0 */
  overdueDays: number;
  type: "standard" | "progress" | "checkin";
  /** 进度 / 打卡摘要 */
  progress: string;
  dependsOn: string[];
  requiredBy: string[];
  notes?: string;
  createdAt: string;
  completedAt: string | null;
}
