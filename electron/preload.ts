import { contextBridge, ipcRenderer } from "electron";
import type {
  AssistantAttachmentPayload,
  AssistantEventPayload,
} from "../src/shared/assistant";
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
} from "../src/shared/ai-config";
import type { OneShotUseCase } from "../src/shared/ai-prompts";
import type { AssetRecord } from "../src/shared/assets";

const api = {
  platform: process.platform as NodeJS.Platform,

  loadState: (): Promise<string | null> => ipcRenderer.invoke("state:load"),
  saveState: (data: string): Promise<void> =>
    ipcRenderer.invoke("state:save", data),
  getDataDir: (): Promise<string> => ipcRenderer.invoke("state:dir"),
  openDataDir: (): Promise<string> => ipcRenderer.invoke("state:open-dir"),
  openExternal: (url: string): Promise<void> =>
    ipcRenderer.invoke("shell:open-external", url),
  openPath: (p: string): Promise<string> =>
    ipcRenderer.invoke("shell:open-path", p),

  listModels: (): Promise<EnabledModelSummary[]> =>
    ipcRenderer.invoke("agent:models"),

  runAgent: (
    useCase: OneShotUseCase,
    prompt: string,
    context?: AiRequestContext
  ): Promise<string> =>
    ipcRenderer.invoke("agent:run", useCase, prompt, context),

  assistantSend: (
    requestId: string,
    message: string,
    projectId: string,
    attachments: AssistantAttachmentPayload[],
    context?: AiRequestContext,
    modelOverride?: AiModelRef | null
  ): Promise<void> =>
    ipcRenderer.invoke(
      "assistant:send",
      requestId,
      message,
      projectId,
      attachments,
      context,
      modelOverride
    ),

  getAiConfig: (): Promise<AiConfigSnapshot> =>
    ipcRenderer.invoke("ai:config:get"),
  reloadAiConfig: (): Promise<AiConfigSnapshot> =>
    ipcRenderer.invoke("ai:config:reload"),
  saveAiConfig: (
    config: AiConfigV1,
    etag: string | null
  ): Promise<AiConfigSnapshot> =>
    ipcRenderer.invoke("ai:config:save", config, etag),
  saveAiProvider: (
    config: AiConfigV1,
    etag: string | null,
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ): Promise<AiConfigSnapshot> =>
    ipcRenderer.invoke("ai:provider:save", config, etag, provider, draft),
  saveAiCredential: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ): Promise<AuthStatus> =>
    ipcRenderer.invoke("ai:auth:save", provider, draft),
  deleteAiCredential: (providerId: string): Promise<void> =>
    ipcRenderer.invoke("ai:auth:delete", providerId),
  testAiProvider: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft,
    modelId?: string
  ): Promise<{ ok: true; message: string }> =>
    ipcRenderer.invoke("ai:provider:test", provider, draft, modelId),
  discoverAiModels: (
    provider: AiProviderConfig,
    draft: AiCredentialDraft
  ): Promise<DiscoveredModel[]> =>
    ipcRenderer.invoke("ai:models:discover", provider, draft),
  setAiModelEnabled: (
    ref: AiModelRef,
    enabled: boolean,
    etag: string | null
  ): Promise<AiConfigSnapshot> =>
    ipcRenderer.invoke("ai:model:set-enabled", ref, enabled, etag),
  getAiRouteStatuses: (): Promise<RouteResolutionStatus[]> =>
    ipcRenderer.invoke("ai:routes:status"),
  openAiConfigDir: (): Promise<string> =>
    ipcRenderer.invoke("ai:config:open-dir"),

  listSkills: (): Promise<
    { name: string; description: string; content: string }[]
  > => ipcRenderer.invoke("agent:skills"),
  readFile: (p: string): Promise<string> =>
    ipcRenderer.invoke("mailuo:read-file", p),
  readImageDataUrl: (p: string, mimeType: string): Promise<string> =>
    ipcRenderer.invoke("mailuo:read-image-data-url", p, mimeType),
  readDataUrl: (p: string, mimeType: string): Promise<string> =>
    ipcRenderer.invoke("mailuo:read-data-url", p, mimeType),
  writeFile: (p: string, content: string): Promise<void> =>
    ipcRenderer.invoke("mailuo:write-file", p, content),
  memoryPath: (): Promise<string> => ipcRenderer.invoke("mailuo:memory-path"),
  memoryAppend: (note: string): Promise<void> =>
    ipcRenderer.invoke("mailuo:memory-append", note),
  workspaceDir: (projectId: string): Promise<string> =>
    ipcRenderer.invoke("mailuo:workspace-dir", projectId),
  listAssets: (projectId: string): Promise<AssetRecord[]> =>
    ipcRenderer.invoke("assets:list", projectId),
  resolveAsset: (projectId: string, assetId: string): Promise<{ asset: AssetRecord; absolutePath: string }> =>
    ipcRenderer.invoke("assets:resolve", projectId, assetId),
  updateAsset: (
    projectId: string,
    assetId: string,
    patch: { name?: string; tags?: string[]; favorite?: boolean }
  ): Promise<AssetRecord> => ipcRenderer.invoke("assets:update", projectId, assetId, patch),
  trashAsset: (projectId: string, assetId: string): Promise<void> =>
    ipcRenderer.invoke("assets:trash", projectId, assetId),
  restoreAsset: (projectId: string, assetId: string): Promise<void> =>
    ipcRenderer.invoke("assets:restore", projectId, assetId),
  emptyAssetTrash: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("assets:empty-trash", projectId),
  importAssets: (projectId: string): Promise<AssetRecord[]> =>
    ipcRenderer.invoke("assets:import", projectId),
  revealAsset: (projectId: string, assetId: string): Promise<void> =>
    ipcRenderer.invoke("assets:reveal", projectId, assetId),
  clearBrowserData: (): Promise<void> =>
    ipcRenderer.invoke("browser:clear-data"),
  listAssetFolders: (projectId: string): Promise<string[]> =>
    ipcRenderer.invoke("assets:folders", projectId),
  createAssetFolder: (projectId: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("assets:create-folder", projectId, relativePath),
  moveAsset: (projectId: string, assetId: string, folder: string): Promise<AssetRecord> =>
    ipcRenderer.invoke("assets:move", projectId, assetId, folder),

  onAssistantEvent: (
    handler: (requestId: string, event: AssistantEventPayload) => void
  ): (() => void) => {
    const listener = (
      _e: Electron.IpcRendererEvent,
      requestId: string,
      event: AssistantEventPayload
    ) => handler(requestId, event);
    ipcRenderer.on("assistant:event", listener);
    return () => ipcRenderer.removeListener("assistant:event", listener);
  },

  assistantReset: (): Promise<void> => ipcRenderer.invoke("assistant:reset"),

  windowControl: (action: "minimize" | "maximize" | "close"): void =>
    ipcRenderer.send("window:control", action),
};

export type MailuoApi = typeof api;

contextBridge.exposeInMainWorld("mailuo", api);
