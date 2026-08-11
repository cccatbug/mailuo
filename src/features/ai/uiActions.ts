/**
 * 小枢卡片（json-render）可触发的动作 handlers。
 *
 * 与 mailuo-actions 操作块（applyAssistantOps）同一套 store 能力，
 * 但以「卡片按钮」形式由用户点击触发；写操作统一走审批（confirm-sensitive 弹窗 / yolo 直通）。
 */
import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import { applyAssistantOps, type AssistantOp } from "./actions";
import type { Priority, Status } from "@/types";

/** 渲染层暴露的审批门（由 AssistantPanel 注入，避免 uiCatalog 直接 import electron 桥） */
let permissionGate:
  | ((toolLabel: string, summary: string) => Promise<boolean>)
  | null = null;

export function setUiActionPermissionGate(
  gate: ((toolLabel: string, summary: string) => Promise<boolean>) | null
): void {
  permissionGate = gate;
}

async function requirePermission(
  action: string,
  label: string,
  summary: string
): Promise<boolean> {
  const mode = useAppStore.getState().settings.assistantPermissionMode;
  if (mode === "yolo") return true;
  if (mode === "read-only") return false;
  if (!MUTATING_ACTIONS.has(action)) return true;
  if (!permissionGate) return window.confirm(`${label}：${summary}`);
  return permissionGate(label, summary);
}

function notify(message: string, isError = false) {
  if (isError) toast.error(message);
  else toast(message);
}

function resolveTask(taskIdOrTitle: string | undefined) {
  if (!taskIdOrTitle) return null;
  const { tasks, selectedProjectId } = useAppStore.getState();
  const projectTasks =
    tasks.filter((t) => t.projectId === selectedProjectId).length > 0
      ? tasks.filter((t) => t.projectId === selectedProjectId)
      : tasks;
  return (
    projectTasks.find((t) => t.id === taskIdOrTitle) ??
    projectTasks.find((t) => t.title === taskIdOrTitle) ??
    projectTasks.find((t) => t.title.includes(taskIdOrTitle)) ??
    null
  );
}

export interface UiActionResult {
  message: string;
  /** 返回给卡片的 state（可被 onSuccess 使用） */
  state?: Record<string, unknown>;
}

/**
 * 卡片动作实现。每个写操作先过权限审批，再操作 store。
 * 权限语义与主进程小枢会话一致：
 * - read-only：写操作拒绝
 * - confirm-sensitive：弹窗确认
 * - yolo：直通
 */
const MUTATING_ACTIONS = new Set([
  "create_task",
  "update_task",
  "delete_task",
  "set_task_status",
  "apply_ops",
]);

export const uiActions: Record<string, (params: Record<string, unknown>) => Promise<UiActionResult>> = {
  /** 创建任务 */
  create_task: async (params) => {
    const title = String(params.title ?? "").trim();
    if (!title) throw new Error("任务标题不能为空");
    const allowed = await requirePermission(
      "create_task",
      "创建任务",
      title
    );
    if (!allowed) throw new Error("已取消");
    const priority = ["high", "normal", "low"].includes(String(params.priority))
      ? (params.priority as Priority)
      : undefined;
    const projectId =
      typeof params.projectId === "string" && params.projectId
        ? params.projectId
        : undefined;
    const store = useAppStore.getState();
    if (projectId) store.selectProject(projectId);
    const task = store.addTask(title, {
      ...(priority ? { priority } : {}),
      ...(typeof params.notes === "string" ? { notes: params.notes } : {}),
      ...(Array.isArray(params.tags) ? { tags: params.tags.map(String) } : {}),
    });
    if (!task) throw new Error("创建失败：当前没有选中项目");
    return { message: `已创建任务「${task.title}」`, state: { taskId: task.id } };
  },

  /** 修改任务（patch 语义，只写传进来的字段） */
  update_task: async (params) => {
    const task = resolveTask(String(params.task ?? ""));
    if (!task) throw new Error("找不到要修改的任务");
    const patch = (params.patch ?? {}) as Record<string, unknown>;
    const summaryBits: string[] = [];
    if (typeof patch.status === "string") summaryBits.push(`状态→${patch.status}`);
    if (typeof patch.priority === "string") summaryBits.push(`优先级→${patch.priority}`);
    if (typeof patch.notes === "string") summaryBits.push("备注已更新");
    if (typeof patch.title === "string") summaryBits.push(`标题→${patch.title}`);
    const allowed = await requirePermission(
      "update_task",
      "修改任务",
      `${task.title}（${summaryBits.join("、") || "更新字段"}）`
    );
    if (!allowed) throw new Error("已取消");
    const store = useAppStore.getState();
    const applied: Partial<{ [K in keyof typeof patch]: unknown }> = {};
    if (typeof patch.status === "string" && ["todo", "doing", "done"].includes(patch.status)) {
      store.setStatus(task.id, patch.status as Status);
    }
    if (typeof patch.priority === "string" && ["high", "normal", "low"].includes(patch.priority)) {
      store.setPriority(task.id, patch.priority as Priority);
    }
    if (typeof patch.title === "string" && patch.title.trim()) {
      store.updateTask(task.id, { title: patch.title.trim() });
    }
    if (typeof patch.notes === "string") {
      store.updateTask(task.id, { notes: patch.notes });
    }
    if (Array.isArray(patch.addTags)) {
      for (const tag of patch.addTags.map(String)) store.addTag(task.id, tag);
    }
    if (Array.isArray(patch.removeTags)) {
      for (const tag of patch.removeTags.map(String)) store.removeTag(task.id, tag);
    }
    void applied;
    return { message: `已更新「${task.title}」`, state: { taskId: task.id } };
  },

  /** 删除任务 */
  delete_task: async (params) => {
    const task = resolveTask(String(params.task ?? ""));
    if (!task) throw new Error("找不到要删除的任务");
    const allowed = await requirePermission("delete_task", "删除任务", task.title);
    if (!allowed) throw new Error("已取消");
    const removed = useAppStore.getState().deleteTask(task.id);
    if (!removed) throw new Error("删除失败");
    return { message: `已删除「${task.title}」` };
  },

  /** 勾选任务状态（列表卡片常用） */
  set_task_status: async (params) => {
    const task = resolveTask(String(params.task ?? ""));
    if (!task) throw new Error("找不到任务");
    const status = String(params.status ?? "");
    if (!["todo", "doing", "done"].includes(status)) throw new Error("无效状态");
    const allowed = await requirePermission(
      "set_task_status",
      "修改任务状态",
      `${task.title} → ${status}`
    );
    if (!allowed) throw new Error("已取消");
    const ok = useAppStore.getState().setStatus(task.id, status as Status);
    if (!ok) throw new Error("该任务类型不支持直接改状态");
    return { message: `「${task.title}」已置为${status === "done" ? "完成" : status === "doing" ? "进行中" : "待办"}` };
  },

  /** 一次性应用一组操作（复用 mailuo-actions 管道） */
  apply_ops: async (params) => {
    const ops = Array.isArray(params.ops)
      ? (params.ops as AssistantOp[]).slice(0, 50)
      : [];
    if (ops.length === 0) throw new Error("没有可应用的操作");
    const { selectedProjectId } = useAppStore.getState();
    const allowed = await requirePermission(
      "apply_ops",
      "应用操作",
      `${ops.length} 项操作（${ops.map((op) => op.op).join("、")}）`
    );
    if (!allowed) throw new Error("已取消");
    if (!selectedProjectId) throw new Error("当前没有选中项目");
    const summary = applyAssistantOps(selectedProjectId, ops);
    return { message: summary || `已应用 ${ops.length} 项操作` };
  },

  /** 选中任务（打开详情） */
  select_task: async (params) => {
    const task = resolveTask(String(params.task ?? ""));
    if (!task) throw new Error("找不到任务");
    useAppStore.getState().selectTask(task.id);
    return { message: "" };
  },

  /** 切换项目 */
  select_project: async (params) => {
    const id = String(params.projectId ?? "");
    const { projects } = useAppStore.getState();
    const project = projects.find((p) => p.id === id || p.name === id);
    if (!project) throw new Error("找不到项目");
    useAppStore.getState().selectProject(project.id);
    return { message: "" };
  },
};

/** 导出给 ActionProvider 的 handlers 工厂（类型与 json-render 兼容） */
export function createUiActionHandlers(): Record<string, (params: Record<string, unknown>) => Promise<unknown>> {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  for (const [name, handler] of Object.entries(uiActions)) {
    handlers[name] = async (params) => {
      const result = await handler(params ?? {});
      if (result?.message) notify(result.message);
      return result;
    };
  }
  return handlers;
}
