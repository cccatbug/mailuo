import type {
  AssistantApprovalResponse,
  AssistantAttachmentPayload,
  AssistantEventPayload,
  AssistantPermissionMode,
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
import type { AssistantCapabilities } from "@/shared/pi-capabilities";
import type {
  AssetLibrarySnapshot,
  AssetRecord,
  AssetTagMode,
  AssetTagRecord,
} from "@/shared/assets";
import type {
  BrowserAgentMode,
  BrowserApprovalRequest,
  BrowserApprovalResponse,
  BrowserTabCommand,
  BrowserTabInfo,
  BrowserTabRegistration,
  BrowserTabUpdate,
} from "@/shared/browser";
import type {
  MemoryEntry,
  MemoryKind,
  MemorySnapshot,
  UpdateMemoryInput,
} from "@/shared/memory";
import type { TaskCommand } from "@/shared/task-commands";
import type {
  PiExtensionCatalogItem,
  PiPackagePreview,
  PiResourcesSnapshot,
  PiResourceProgressEvent,
  SkillsShCatalogItem,
  SkillsShCommandResult,
  SkillsShListResult,
} from "@/shared/pi-resources";

export interface BrowserSessionSnapshot {
  persistent: boolean;
  storagePath: string | null;
  cookieCount: number;
  cacheSize: number;
  userAgent: string;
}

export interface BrowserCookieImportResult {
  imported: number;
  skipped: number;
}

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
  onFlushStateRequest: (handler: () => Promise<void>) => () => void;
  getDataDir: () => Promise<string>;
  openDataDir: () => Promise<string>;
  openExternal: (url: string) => Promise<void>;
  openPath: (p: string) => Promise<string>;
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
    conversationId: string,
    attachments: AssistantAttachmentPayload[],
    context?: AiRequestContext,
    modelOverride?: AiModelRef | null
  ) => Promise<void>;
  assistantAbort: (requestId: string) => Promise<boolean>;
  setAssistantPermissionMode: (mode: AssistantPermissionMode) => Promise<void>;
  respondAssistantApproval: (response: AssistantApprovalResponse) => void;
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
    draft: AiCredentialDraft,
    modelId?: string
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
  listAssistantCapabilities: (
    projectId: string,
    modelOverride?: AiModelRef
  ) => Promise<AssistantCapabilities>;
  listPiResources: () => Promise<PiResourcesSnapshot>;
  refreshPiResources: () => Promise<PiResourcesSnapshot>;
  cancelPiResourceOperation: () => Promise<void>;
  searchPiExtensions: (query: string) => Promise<PiExtensionCatalogItem[]>;
  previewPiPackage: (source: string) => Promise<PiPackagePreview>;
  installPiPackage: (source: string) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  removePiPackage: (source: string) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  setPiPackageEnabled: (source: string, enabled: boolean) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  updatePiPackage: (source?: string) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  addPiPath: (
    kind: "extension" | "skill",
    resourcePath: string,
    sourceKind: "local" | "terminal" | "skills-sh",
    label?: string
  ) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  removePiPath: (kind: "extension" | "skill", resourcePath: string) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  setPiPathEnabled: (kind: "extension" | "skill", resourcePath: string, enabled: boolean) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  setPiExtensionEnabled: (id: string, enabled: boolean) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  setPiSkillProfiles: (id: string, profileIds: string[] | null) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  pickPiPath: (kind: "extension" | "skill") => Promise<string | null>;
  openPiResource: (resourcePath: string) => Promise<string>;
  readPiSkill: (id: string) => Promise<string>;
  writePiSkill: (id: string, content: string) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  createPiSkill: (name: string, content?: string, root?: string) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  searchSkillsSh: (query: string) => Promise<SkillsShCatalogItem[]>;
  listSkillsSh: (source: string) => Promise<SkillsShListResult>;
  installSkillsSh: (source: string, skillNames?: string[]) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot; command: SkillsShCommandResult }>;
  updateSkillsSh: (installId: string, skillNames?: string[]) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot }>;
  removeSkillsSh: (installId: string, skillNames?: string[]) => Promise<{ snapshot: AiConfigSnapshot; resources: PiResourcesSnapshot; command: SkillsShCommandResult }>;
  onPiResourceProgress: (handler: (event: PiResourceProgressEvent) => void) => () => void;
  readFile: (p: string) => Promise<string>;
  readImageDataUrl: (p: string, mimeType: string) => Promise<string>;
  readDataUrl: (p: string, mimeType: string) => Promise<string>;
  /** 返回 ~/.mailuo 内文件的受控本地 HTTP URL（流式 + Range，供 PDF 等大文件使用） */
  fileUrl: (p: string, mimeType: string) => Promise<string>;
  writeFile: (p: string, content: string) => Promise<void>;
  memoryPath: () => Promise<string>;
  memoryAppend: (note: string) => Promise<void>;
  getMemory: () => Promise<MemorySnapshot>;
  setMemoryEnabled: (enabled: boolean) => Promise<MemorySnapshot>;
  rememberMemory: (
    content: string,
    projectId?: string,
    kind?: MemoryKind
  ) => Promise<MemoryEntry>;
  updateMemory: (id: string, patch: UpdateMemoryInput) => Promise<MemoryEntry>;
  deleteMemory: (id: string) => Promise<boolean>;
  rebuildMemory: () => Promise<MemorySnapshot>;
  workspaceDir: (projectId: string) => Promise<string>;
  listAssets: (projectId: string) => Promise<AssetRecord[]>;
  resolveAsset: (projectId: string, assetId: string) => Promise<{ asset: AssetRecord; absolutePath: string }>;
  updateAsset: (
    projectId: string,
    assetId: string,
    patch: { name?: string; tags?: string[]; favorite?: boolean }
  ) => Promise<AssetRecord>;
  trashAsset: (projectId: string, assetId: string) => Promise<void>;
  restoreAsset: (projectId: string, assetId: string) => Promise<void>;
  emptyAssetTrash: (projectId: string) => Promise<void>;
  importAssets: (projectId: string) => Promise<AssetRecord[]>;
  revealAsset: (projectId: string, assetId: string) => Promise<void>;
  getBrowserSession: () => Promise<BrowserSessionSnapshot>;
  flushBrowserSession: () => Promise<void>;
  openBrowserStorage: () => Promise<string>;
  importBrowserCookies: () => Promise<BrowserCookieImportResult | null>;
  onBrowserDownload: (
    handler: (event: { state: string; filename: string; path: string }) => void
  ) => () => void;
  openBrowserDownload: (filePath: string) => Promise<string>;
  onBrowserOpenTab: (handler: (url: string) => void) => () => void;
  clearBrowserData: (scope?: "cookies" | "all") => Promise<void>;
  setBrowserCustomCss: (css: string) => Promise<void>;
  listBrowserTabs: () => Promise<BrowserTabInfo[]>;
  registerBrowserTab: (
    registration: BrowserTabRegistration
  ) => Promise<BrowserTabInfo>;
  updateBrowserTab: (
    tabId: string,
    update: BrowserTabUpdate
  ) => Promise<BrowserTabInfo | null>;
  unregisterBrowserTab: (
    tabId: string,
    webContentsId?: number
  ) => Promise<void>;
  commandBrowserTab: (
    action: "open" | "focus" | "close",
    tabId?: string,
    url?: string
  ) => Promise<{ tabId?: string }>;
  setBrowserAgentMode: (mode: BrowserAgentMode) => Promise<void>;
  onBrowserTabsChanged: (
    handler: (tabs: BrowserTabInfo[]) => void
  ) => () => void;
  onBrowserTabCommand: (
    handler: (
      command: BrowserTabCommand
    ) => Promise<{ tabId?: string }> | { tabId?: string }
  ) => () => void;
  onTaskCommand: (
    handler: (command: TaskCommand) => Promise<unknown> | unknown
  ) => () => void;
  onBrowserApprovalRequest: (
    handler: (request: BrowserApprovalRequest) => void
  ) => () => void;
  respondBrowserApproval: (response: BrowserApprovalResponse) => void;
  listAssetFolders: (projectId: string) => Promise<string[]>;
  createAssetFolder: (projectId: string, relativePath: string) => Promise<void>;
  moveAsset: (projectId: string, assetId: string, folder: string) => Promise<AssetRecord>;
  listAssetLibrary: (projectId: string) => Promise<AssetLibrarySnapshot>;
  createAssetFile: (projectId: string, folder: string, name: string, content?: string) => Promise<AssetRecord>;
  renameAssetFolder: (projectId: string, relativePath: string, name: string) => Promise<void>;
  moveAssetFolder: (projectId: string, relativePath: string, destination: string) => Promise<void>;
  duplicateAsset: (projectId: string, assetId: string) => Promise<void>;
  copyAsset: (projectId: string, assetId: string, destination: string) => Promise<void>;
  duplicateAssetFolder: (projectId: string, relativePath: string) => Promise<void>;
  trashAssetFolder: (projectId: string, relativePath: string) => Promise<void>;
  permanentlyDeleteAsset: (projectId: string, assetId: string) => Promise<void>;
  createAssetTag: (projectId: string, name: string, color: string) => Promise<AssetTagRecord>;
  updateAssetTag: (
    projectId: string,
    tagId: string,
    patch: { name?: string; color?: string }
  ) => Promise<AssetTagRecord>;
  deleteAssetTag: (projectId: string, tagId: string) => Promise<void>;
  assignAssetTags: (
    projectId: string,
    assetIds: string[],
    tagNames: string[],
    mode: AssetTagMode
  ) => Promise<void>;
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
