import type {
  AssistantAttachmentPayload,
  AssistantEventPayload,
} from "@/shared/assistant";
import type {
  AiConfigSnapshot,
  AiConfigV1,
  AiCredentialDraft,
  AiModelRef,
  AiProviderConfig,
  AiRequestContext,
  AuthStatus,
  DiscoveredModel,
  EnabledModelSummary,
  RouteResolutionStatus,
} from "@/shared/ai-config";
import type { OneShotUseCase } from "@/shared/ai-prompts";

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
  listModels: () => Promise<EnabledModelSummary[]>;
  runAgent: (
    useCase: OneShotUseCase,
    prompt: string,
    context?: AiRequestContext
  ) => Promise<string>;
  assistantSend: (
    requestId: string,
    message: string,
    projectId: string,
    attachments: AssistantAttachmentPayload[],
    context?: AiRequestContext,
    modelOverride?: AiModelRef | null
  ) => Promise<void>;
  getAiConfig: () => Promise<AiConfigSnapshot>;
  reloadAiConfig: () => Promise<AiConfigSnapshot>;
  saveAiConfig: (
    config: AiConfigV1,
    etag: string | null
  ) => Promise<AiConfigSnapshot>;
  saveAiProvider: (
    config: AiConfigV1,
    etag: string | null,
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ) => Promise<AiConfigSnapshot>;
  saveAiCredential: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ) => Promise<AuthStatus>;
  deleteAiCredential: (providerId: string) => Promise<void>;
  testAiProvider: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ) => Promise<{ ok: true; message: string }>;
  discoverAiModels: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ) => Promise<DiscoveredModel[]>;
  setAiModelEnabled: (
    ref: AiModelRef,
    enabled: boolean,
    etag: string | null
  ) => Promise<AiConfigSnapshot>;
  getAiRouteStatuses: () => Promise<RouteResolutionStatus[]>;
  openAiConfigDir: () => Promise<string>;
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
