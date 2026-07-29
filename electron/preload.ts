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
import type {
  AssetLibrarySnapshot,
  AssetRecord,
  AssetTagMode,
  AssetTagRecord,
} from "../src/shared/assets";
import type {
  BrowserAgentMode,
  BrowserApprovalRequest,
  BrowserApprovalResponse,
  BrowserTabCommand,
  BrowserTabInfo,
  BrowserTabRegistration,
  BrowserTabUpdate,
} from "../src/shared/browser";

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
  getBrowserSession: () =>
    ipcRenderer.invoke("browser:session:snapshot"),
  flushBrowserSession: (): Promise<void> =>
    ipcRenderer.invoke("browser:session:flush"),
  openBrowserStorage: (): Promise<string> =>
    ipcRenderer.invoke("browser:session:open-storage"),
  importBrowserCookies: () =>
    ipcRenderer.invoke("browser:cookies:import"),
  onBrowserDownload: (
    handler: (event: { state: string; filename: string; path: string }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { state: string; filename: string; path: string }
    ) => handler(payload);
    ipcRenderer.on("browser:download", listener);
    return () => ipcRenderer.removeListener("browser:download", listener);
  },
  openBrowserDownload: (filePath: string): Promise<string> =>
    ipcRenderer.invoke("browser:download:open", filePath),
  onBrowserOpenTab: (handler: (url: string) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, url: string) => handler(url);
    ipcRenderer.on("browser:open-tab", listener);
    return () => ipcRenderer.removeListener("browser:open-tab", listener);
  },
  clearBrowserData: (scope: "cookies" | "all" = "all"): Promise<void> =>
    ipcRenderer.invoke("browser:clear-data", scope),
  listBrowserTabs: (): Promise<BrowserTabInfo[]> =>
    ipcRenderer.invoke("browser:tabs:list"),
  registerBrowserTab: (
    registration: BrowserTabRegistration
  ): Promise<BrowserTabInfo> =>
    ipcRenderer.invoke("browser:tabs:register", registration),
  updateBrowserTab: (
    tabId: string,
    update: BrowserTabUpdate
  ): Promise<BrowserTabInfo | null> =>
    ipcRenderer.invoke("browser:tabs:update", tabId, update),
  unregisterBrowserTab: (
    tabId: string,
    webContentsId?: number
  ): Promise<void> =>
    ipcRenderer.invoke("browser:tabs:unregister", tabId, webContentsId),
  commandBrowserTab: (
    action: "open" | "focus" | "close",
    tabId?: string,
    url?: string
  ): Promise<{ tabId?: string }> =>
    ipcRenderer.invoke("browser:tabs:command", { action, tabId, url }),
  setBrowserAgentMode: (mode: BrowserAgentMode): Promise<void> =>
    ipcRenderer.invoke("browser:agent-mode", mode),
  onBrowserTabsChanged: (
    handler: (tabs: BrowserTabInfo[]) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      tabs: BrowserTabInfo[]
    ) => handler(tabs);
    ipcRenderer.on("browser:tabs-changed", listener);
    return () => ipcRenderer.removeListener("browser:tabs-changed", listener);
  },
  onBrowserTabCommand: (
    handler: (command: BrowserTabCommand) => Promise<{ tabId?: string }> | { tabId?: string }
  ): (() => void) => {
    const listener = async (
      _event: Electron.IpcRendererEvent,
      command: BrowserTabCommand
    ) => {
      try {
        const result = await handler(command);
        ipcRenderer.send("browser:tab-command-result", {
          requestId: command.requestId,
          ok: true,
          ...result,
        });
      } catch (error) {
        ipcRenderer.send("browser:tab-command-result", {
          requestId: command.requestId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    };
    ipcRenderer.on("browser:tab-command", listener);
    return () => ipcRenderer.removeListener("browser:tab-command", listener);
  },
  onBrowserApprovalRequest: (
    handler: (request: BrowserApprovalRequest) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      request: BrowserApprovalRequest
    ) => handler(request);
    ipcRenderer.on("browser:approval-request", listener);
    return () =>
      ipcRenderer.removeListener("browser:approval-request", listener);
  },
  respondBrowserApproval: (response: BrowserApprovalResponse): void =>
    ipcRenderer.send("browser:approval-response", response),
  listAssetFolders: (projectId: string): Promise<string[]> =>
    ipcRenderer.invoke("assets:folders", projectId),
  createAssetFolder: (projectId: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("assets:create-folder", projectId, relativePath),
  moveAsset: (projectId: string, assetId: string, folder: string): Promise<AssetRecord> =>
    ipcRenderer.invoke("assets:move", projectId, assetId, folder),
  listAssetLibrary: (projectId: string): Promise<AssetLibrarySnapshot> =>
    ipcRenderer.invoke("assets:library", projectId),
  createAssetFile: (projectId: string, folder: string, name: string, content = ""): Promise<AssetRecord> =>
    ipcRenderer.invoke("assets:create-file", projectId, folder, name, content),
  renameAssetFolder: (projectId: string, relativePath: string, name: string): Promise<void> =>
    ipcRenderer.invoke("assets:rename-folder", projectId, relativePath, name),
  moveAssetFolder: (projectId: string, relativePath: string, destination: string): Promise<void> =>
    ipcRenderer.invoke("assets:move-folder", projectId, relativePath, destination),
  duplicateAsset: (projectId: string, assetId: string): Promise<void> =>
    ipcRenderer.invoke("assets:duplicate", projectId, assetId),
  copyAsset: (projectId: string, assetId: string, destination: string): Promise<void> =>
    ipcRenderer.invoke("assets:copy", projectId, assetId, destination),
  duplicateAssetFolder: (projectId: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("assets:duplicate-folder", projectId, relativePath),
  trashAssetFolder: (projectId: string, relativePath: string): Promise<void> =>
    ipcRenderer.invoke("assets:trash-folder", projectId, relativePath),
  permanentlyDeleteAsset: (projectId: string, assetId: string): Promise<void> =>
    ipcRenderer.invoke("assets:delete-permanently", projectId, assetId),
  createAssetTag: (projectId: string, name: string, color: string): Promise<AssetTagRecord> =>
    ipcRenderer.invoke("assets:tag-create", projectId, name, color),
  updateAssetTag: (
    projectId: string,
    tagId: string,
    patch: { name?: string; color?: string }
  ): Promise<AssetTagRecord> =>
    ipcRenderer.invoke("assets:tag-update", projectId, tagId, patch),
  deleteAssetTag: (projectId: string, tagId: string): Promise<void> =>
    ipcRenderer.invoke("assets:tag-delete", projectId, tagId),
  assignAssetTags: (
    projectId: string,
    assetIds: string[],
    tagNames: string[],
    mode: AssetTagMode
  ): Promise<void> =>
    ipcRenderer.invoke("assets:tags-assign", projectId, assetIds, tagNames, mode),

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
