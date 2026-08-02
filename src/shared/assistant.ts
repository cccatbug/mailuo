export type AssistantAttachmentKind = "image" | "text" | "file";

/** Renderer → main：附件以 base64 穿过 IPC，主进程负责校验、落盘和注入上下文。 */
export interface AssistantAttachmentPayload {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AssistantAttachmentKind;
  data: string;
}

/** 聊天记录只保留轻量元数据和落盘路径，避免把大体积 base64 写进 localStorage。 */
export interface AssistantAttachmentMeta
  extends Omit<AssistantAttachmentPayload, "data"> {
  /** 主进程校验并写入 ~/.mailuo 后返回的绝对路径。 */
  path?: string;
}

export interface AssistantContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

/** 小枢的全局执行权限；同时作用于文件、命令与内置浏览器。 */
export type AssistantPermissionMode =
  | "confirm-sensitive"
  | "read-only"
  | "yolo";

export interface AssistantApprovalRequest {
  id: string;
  toolName: string;
  label: string;
  summary: string;
  reason: "mutation" | "read-only";
}

export interface AssistantApprovalResponse {
  id: string;
  allowed: boolean;
}

export type AssistantTodoStatus = "pending" | "in_progress" | "completed";

/** Agent 的会话执行计划，不会混入用户的项目任务。 */
export interface AssistantTodoItem {
  id: string;
  text: string;
  status: AssistantTodoStatus;
}

export type AssistantEventPayload =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "attachments"; attachments: AssistantAttachmentMeta[] }
  | { type: "approval"; request: AssistantApprovalRequest }
  | { type: "todos"; todos: AssistantTodoItem[] }
  | {
      type: "tool_start";
      id: string;
      name: string;
      args: string;
      file?: string;
    }
  | {
      type: "tool_end";
      id: string;
      name: string;
      ok: boolean;
      output: string;
    }
  | { type: "context"; usage: AssistantContextUsage }
  | { type: "done" }
  | { type: "error"; message: string };
