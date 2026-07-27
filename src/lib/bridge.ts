import type {
  AssistantAttachmentPayload,
  AssistantEventPayload,
} from "@/shared/assistant";

export type {
  AssistantAttachmentMeta,
  AssistantAttachmentPayload,
  AssistantContextUsage,
  AssistantEventPayload,
} from "@/shared/assistant";

/** Electron preload 暴露的原生桥接口（浏览器环境为 undefined） */

export interface MailuoApi {
  platform: string;
  loadState: () => Promise<string | null>;
  saveState: (data: string) => Promise<void>;
  getDataDir: () => Promise<string>;
  openDataDir: () => Promise<string>;
  listModels: () => Promise<
    { provider: string; id: string; name: string; reasoning: boolean }[]
  >;
  runAgent: (
    config: unknown,
    system: string | null,
    prompt: string
  ) => Promise<string>;
  assistantSend: (
    requestId: string,
    config: unknown,
    system: string,
    message: string,
    projectId: string,
    attachments: AssistantAttachmentPayload[]
  ) => Promise<void>;
  listSkills: () => Promise<
    { name: string; description: string; content: string }[]
  >;
  readFile: (p: string) => Promise<string>;
  readImageDataUrl: (p: string, mimeType: string) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<void>;
  memoryPath: () => Promise<string>;
  memoryAppend: (note: string) => Promise<void>;
  workspaceDir: (projectId: string) => Promise<string>;
  onAssistantEvent: (
    handler: (requestId: string, event: AssistantEventPayload) => void
  ) => () => void;
  assistantReset: () => Promise<void>;
  windowControl: (action: "minimize" | "maximize" | "close") => void;
}

declare global {
  interface Window {
    mailuo?: MailuoApi;
  }
}

export const bridge: MailuoApi | null =
  typeof window !== "undefined" ? (window.mailuo ?? null) : null;
