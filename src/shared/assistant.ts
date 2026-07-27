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

export type AssistantEventPayload =
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "attachments"; attachments: AssistantAttachmentMeta[] }
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
