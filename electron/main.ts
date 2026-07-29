import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from "electron";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AI_CONFIG,
  AI_RUNTIME,
  appendMemory,
  assistantReset,
  assistantSend,
  listModels,
  listSkills,
  memoryPath,
  readMailuoFile,
  readMailuoImageDataUrl,
  readMailuoDataUrl,
  resolveMailuoPath,
  runOneShot,
  workspaceDir,
  writeMailuoFile,
} from "./pi";
import type { AssistantAttachmentPayload } from "../src/shared/assistant";
import {
  aiProviderConfigSchema,
  aiCredentialDraftSchema,
  aiModelRefSchema,
  aiRequestContextSchema,
  aiUseCaseSchema,
  type AiConfigV1,
  type AiCredentialDraft,
  type AiModelRef,
  type AiRequestContext,
} from "../src/shared/ai-config";
import {
  cacheDiscoveredModels,
  discoverModels,
  testProviderConnection,
} from "./model-discovery";
import type { OneShotUseCase } from "../src/shared/ai-prompts";
import {
  emptyAssetTrash,
  importAssets,
  listProjectAssets,
  resolveAsset,
  restoreAsset,
  trashAsset,
  updateAsset,
  createProjectFolder,
  createProjectFile,
  createAssetTag,
  updateAssetTag,
  deleteAssetTag,
  assignAssetTags,
  copyAsset,
  duplicateAsset,
  duplicateProjectFolder,
  listAssetLibrary,
  listProjectFolders,
  moveAsset,
  moveProjectFolder,
  permanentlyDeleteAsset,
  renameProjectFolder,
  trashProjectFolder,
} from "./asset-store";
import {
  BROWSER_PARTITION,
  BROWSER_SESSION,
  isExternalBrowserProtocol,
} from "./browser-session";
import { BROWSER_RUNTIME } from "./browser-runtime";
import type {
  BrowserAgentMode,
  BrowserApprovalResponse,
  BrowserTabCommandResult,
  BrowserTabRegistration,
  BrowserTabUpdate,
} from "../src/shared/browser";

const isMac = process.platform === "darwin";

/* ---------- 数据持久化（原子写入 + 旧 Tauri 数据迁移） ---------- */

const dataFile = () => path.join(app.getPath("userData"), "mailuo.json");

/** 老版本（Tauri 壳）的数据位置 */
function tauriDataFile(): string {
  return path.join(
    os.homedir(),
    "Library/Application Support/com.mushr.mailuo/mailuo.json"
  );
}

async function loadState(): Promise<string | null> {
  try {
    return await fs.readFile(dataFile(), "utf8");
  } catch {
    // 首次运行：尝试迁移 Tauri 时代的数据
    try {
      const legacy = await fs.readFile(tauriDataFile(), "utf8");
      await saveState(legacy);
      return legacy;
    } catch {
      return null;
    }
  }
}

async function saveState(data: string): Promise<void> {
  JSON.parse(data); // 防御：坏 JSON 不落盘
  const file = dataFile();
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, data, "utf8");
  await fs.rename(tmp, file);
}

/* ---------- 窗口 ---------- */

let win: BrowserWindow | null = null;

function createWindow() {
  win = new BrowserWindow({
    title: "脉络 · Màiluò",
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: "#f3efe4",
    ...(isMac
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 13 },
        }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.mjs"),
      sandbox: false,
      webviewTag: true,
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    const src = typeof params.src === "string" ? params.src : "";
    if (
      !src ||
      isExternalBrowserProtocol(src) ||
      webPreferences.partition !== BROWSER_PARTITION
    ) {
      event.preventDefault();
      return;
    }
    delete webPreferences.preload;
    delete (webPreferences as Record<string, unknown>).preloadURL;
    webPreferences.partition = BROWSER_PARTITION;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    webPreferences.allowRunningInsecureContent = false;
  });
  win.webContents.on("did-attach-webview", (_event, contents) => {
    BROWSER_SESSION.configureContents(contents);
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

/* ---------- IPC ---------- */

async function resolveProviderDraft(
  providerInput: unknown,
  draft: AiCredentialDraft
) {
  const provider = aiProviderConfigSchema.parse(providerInput);
  const credentialDraft = aiCredentialDraftSchema.parse(draft ?? {});
  const credential = await AI_CONFIG.resolveCredential(
    provider,
    credentialDraft
  );
  return { provider, credential };
}

function registerIpc() {
  ipcMain.handle("state:load", () => loadState());
  ipcMain.handle("state:save", (_e, data: string) => saveState(data));
  ipcMain.handle("state:dir", () => app.getPath("userData"));
  ipcMain.handle("state:open-dir", () => shell.openPath(app.getPath("userData")));
  ipcMain.handle("shell:open-external", (_e, url: string) => {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("只允许打开 HTTP(S) 链接");
    }
    return shell.openExternal(parsed.toString());
  });
  ipcMain.handle("shell:open-path", (_e, p: string) =>
    shell.openPath(resolveMailuoPath(p))
  );
  ipcMain.handle("assets:list", (_e, projectId: string) =>
    listProjectAssets(projectId)
  );
  ipcMain.handle("assets:resolve", async (_e, projectId: string, assetId: string) => {
    const { asset, absolutePath } = await resolveAsset(projectId, assetId);
    return { asset, absolutePath };
  });
  ipcMain.handle(
    "assets:update",
    (_e, projectId: string, assetId: string, patch: { name?: string; tags?: string[]; favorite?: boolean }) =>
      updateAsset(projectId, assetId, patch)
  );
  ipcMain.handle("assets:trash", (_e, projectId: string, assetId: string) =>
    trashAsset(projectId, assetId)
  );
  ipcMain.handle("assets:restore", (_e, projectId: string, assetId: string) =>
    restoreAsset(projectId, assetId)
  );
  ipcMain.handle("assets:empty-trash", (_e, projectId: string) =>
    emptyAssetTrash(projectId)
  );
  ipcMain.handle("assets:import", async (_e, projectId: string) => {
    const result = await dialog.showOpenDialog({
      properties: ["openFile", "multiSelections"],
      title: "导入项目资产",
    });
    if (!result.canceled) await importAssets(projectId, result.filePaths);
    return listProjectAssets(projectId);
  });
  ipcMain.handle("assets:reveal", async (_e, projectId: string, assetId: string) => {
    const { absolutePath } = await resolveAsset(projectId, assetId);
    shell.showItemInFolder(absolutePath);
  });
  ipcMain.handle("assets:folders", (_e, projectId: string) =>
    listProjectFolders(projectId)
  );
  ipcMain.handle("assets:create-folder", (_e, projectId: string, relativePath: string) =>
    createProjectFolder(projectId, relativePath)
  );
  ipcMain.handle("assets:move", (_e, projectId: string, assetId: string, folder: string) =>
    moveAsset(projectId, assetId, folder)
  );
  ipcMain.handle("assets:library", (_e, projectId: string) =>
    listAssetLibrary(projectId)
  );
  ipcMain.handle(
    "assets:create-file",
    (_e, projectId: string, folder: string, name: string, content?: string) =>
      createProjectFile(projectId, folder, name, content)
  );
  ipcMain.handle(
    "assets:rename-folder",
    (_e, projectId: string, relativePath: string, name: string) =>
      renameProjectFolder(projectId, relativePath, name)
  );
  ipcMain.handle(
    "assets:move-folder",
    (_e, projectId: string, relativePath: string, destination: string) =>
      moveProjectFolder(projectId, relativePath, destination)
  );
  ipcMain.handle("assets:duplicate", (_e, projectId: string, assetId: string) =>
    duplicateAsset(projectId, assetId)
  );
  ipcMain.handle(
    "assets:copy",
    (_e, projectId: string, assetId: string, destination: string) =>
      copyAsset(projectId, assetId, destination)
  );
  ipcMain.handle(
    "assets:duplicate-folder",
    (_e, projectId: string, relativePath: string) =>
      duplicateProjectFolder(projectId, relativePath)
  );
  ipcMain.handle(
    "assets:trash-folder",
    (_e, projectId: string, relativePath: string) =>
      trashProjectFolder(projectId, relativePath)
  );
  ipcMain.handle(
    "assets:delete-permanently",
    (_e, projectId: string, assetId: string) =>
      permanentlyDeleteAsset(projectId, assetId)
  );
  ipcMain.handle(
    "assets:tag-create",
    (_e, projectId: string, name: string, color: string) =>
      createAssetTag(projectId, name, color)
  );
  ipcMain.handle(
    "assets:tag-update",
    (_e, projectId: string, tagId: string, patch: { name?: string; color?: string }) =>
      updateAssetTag(projectId, tagId, patch)
  );
  ipcMain.handle("assets:tag-delete", (_e, projectId: string, tagId: string) =>
    deleteAssetTag(projectId, tagId)
  );
  ipcMain.handle(
    "assets:tags-assign",
    (
      _e,
      projectId: string,
      assetIds: string[],
      tagNames: string[],
      mode: "add" | "remove" | "set"
    ) => assignAssetTags(projectId, assetIds, tagNames, mode)
  );
  ipcMain.handle("browser:session:snapshot", () => BROWSER_SESSION.snapshot());
  ipcMain.handle("browser:session:flush", () => BROWSER_SESSION.flush());
  ipcMain.handle("browser:session:open-storage", () =>
    shell.openPath(BROWSER_SESSION.storageDirectory)
  );
  ipcMain.handle("browser:cookies:import", async () => {
    const result = await dialog.showOpenDialog({
      title: "导入浏览器 Cookie",
      filters: [{ name: "Cookie JSON", extensions: ["json"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const raw = JSON.parse(await fs.readFile(result.filePaths[0], "utf8"));
    return BROWSER_SESSION.importCookies(raw);
  });
  ipcMain.handle("browser:download:open", (_event, filePath: string) => {
    const downloads = path.resolve(app.getPath("downloads"));
    const candidate = path.resolve(filePath);
    if (candidate !== downloads && !candidate.startsWith(`${downloads}${path.sep}`)) {
      throw new Error("只能打开下载目录内的文件");
    }
    return shell.openPath(candidate);
  });
  ipcMain.handle(
    "browser:clear-data",
    (_event, scope: "cookies" | "all" = "all") => BROWSER_SESSION.clear(scope)
  );
  ipcMain.handle("browser:tabs:list", () =>
    BROWSER_RUNTIME.control.listTabs()
  );
  ipcMain.handle(
    "browser:tabs:register",
    (_event, registration: BrowserTabRegistration) =>
      BROWSER_RUNTIME.registerTab(registration)
  );
  ipcMain.handle(
    "browser:tabs:update",
    (_event, tabId: string, update: BrowserTabUpdate) =>
      BROWSER_RUNTIME.updateTab(tabId, update)
  );
  ipcMain.handle(
    "browser:tabs:unregister",
    (_event, tabId: string, webContentsId?: number) =>
      BROWSER_RUNTIME.unregisterTab(tabId, webContentsId)
  );
  ipcMain.handle(
    "browser:tabs:command",
    (
      _event,
      command: {
        action: "open" | "focus" | "close";
        tabId?: string;
        url?: string;
      }
    ) => BROWSER_RUNTIME.commandTab(command)
  );
  ipcMain.on(
    "browser:tab-command-result",
    (_event, result: BrowserTabCommandResult) =>
      BROWSER_RUNTIME.settleTabCommand(result)
  );
  ipcMain.on(
    "browser:approval-response",
    (_event, response: BrowserApprovalResponse) =>
      BROWSER_RUNTIME.settleApproval(response)
  );
  ipcMain.handle(
    "browser:agent-mode",
    (_event, mode: BrowserAgentMode) => {
      if (
        !["confirm-sensitive", "always-allow", "read-only"].includes(mode)
      ) {
        throw new Error("无效的浏览器 Agent 模式");
      }
      BROWSER_RUNTIME.setApprovalMode(mode);
    }
  );

  ipcMain.handle("agent:models", () => listModels());
  ipcMain.handle("agent:skills", () => listSkills());
  ipcMain.handle("ai:config:get", () => AI_RUNTIME.snapshot());
  ipcMain.handle("ai:config:reload", async () => {
    const snapshot = await AI_RUNTIME.reload();
    assistantReset();
    return snapshot;
  });
  ipcMain.handle(
    "ai:config:save",
    async (_e, config: AiConfigV1, etag: string | null) => {
      const snapshot = await AI_RUNTIME.saveConfig(config, etag);
      assistantReset();
      return snapshot;
    }
  );
  ipcMain.handle(
    "mailuo:read-data-url",
    (_e, p: string, mimeType: string) => readMailuoDataUrl(p, mimeType)
  );
  ipcMain.handle(
    "ai:provider:save",
    async (
      _e,
      configInput: AiConfigV1,
      etag: string | null,
      providerInput: unknown,
      draft: AiCredentialDraft
    ) => {
      const snapshot = await AI_RUNTIME.saveProviderConfig(
        configInput,
        etag,
        aiProviderConfigSchema.parse(providerInput),
        aiCredentialDraftSchema.parse(draft ?? {})
      );
      assistantReset();
      return snapshot;
    }
  );
  ipcMain.handle(
    "ai:auth:save",
    async (
      _e,
      providerInput: unknown,
      draft: AiCredentialDraft
    ) => {
      const provider = aiProviderConfigSchema.parse(providerInput);
      const credentialDraft = aiCredentialDraftSchema.parse(draft ?? {});
      const status = await AI_CONFIG.saveCredential(provider, credentialDraft);
      assistantReset();
      return status;
    }
  );
  ipcMain.handle("ai:auth:delete", async (_e, providerId: string) => {
    await AI_CONFIG.deleteCredential(providerId);
    assistantReset();
  });
  ipcMain.handle(
    "ai:provider:test",
    async (
      _e,
      providerInput: unknown,
      draft: AiCredentialDraft,
      modelId: string | undefined
    ) => {
      const { provider, credential } = await resolveProviderDraft(
        providerInput,
        draft
      );
      return testProviderConnection(provider, credential, {
        modelId: modelId?.trim() || undefined,
      });
    }
  );
  ipcMain.handle(
    "ai:models:discover",
    async (
      _e,
      providerInput: unknown,
      draft: AiCredentialDraft
    ) => {
      const { provider, credential } = await resolveProviderDraft(
        providerInput,
        draft
      );
      const models = await discoverModels(provider, credential);
      await cacheDiscoveredModels(
        AI_CONFIG.catalogCacheDir,
        provider.id,
        models
      );
      return models;
    }
  );
  ipcMain.handle(
    "ai:model:set-enabled",
    async (_e, ref: AiModelRef, enabled: boolean, etag: string | null) => {
      const modelRef = aiModelRefSchema.parse(ref);
      const snapshot = await AI_RUNTIME.snapshot();
      if (snapshot.etag !== etag) {
        throw new Error("AI 配置已变化，请重新加载后再操作");
      }
      const config = structuredClone(snapshot.config);
      const model = config.models.find(
        (entry) =>
          entry.providerId === modelRef.providerId &&
          entry.modelId === modelRef.modelId
      );
      if (!model) throw new Error("模型不存在");
      model.enabled = enabled;
      const saved = await AI_RUNTIME.saveConfig(config, etag);
      assistantReset();
      return saved;
    }
  );
  ipcMain.handle("ai:routes:status", () => AI_RUNTIME.routeStatuses());
  ipcMain.handle("ai:config:open-dir", async () => {
    await AI_CONFIG.ensureDirectories();
    return shell.openPath(AI_CONFIG.root);
  });
  ipcMain.handle("mailuo:read-file", (_e, p: string) => readMailuoFile(p));
  ipcMain.handle(
    "mailuo:read-image-data-url",
    (_e, p: string, mimeType: string) => readMailuoImageDataUrl(p, mimeType)
  );
  ipcMain.handle("mailuo:write-file", (_e, p: string, content: string) =>
    writeMailuoFile(p, content)
  );
  ipcMain.handle("mailuo:memory-path", () => memoryPath());
  ipcMain.handle("mailuo:memory-append", (_e, note: string) => appendMemory(note));
  ipcMain.handle("mailuo:workspace-dir", (_e, projectId: string) =>
    workspaceDir(projectId)
  );
  ipcMain.handle(
    "agent:run",
    (
      _e,
      useCase: OneShotUseCase,
      prompt: string,
      context: AiRequestContext | undefined
    ) => {
      const parsedUseCase = aiUseCaseSchema.parse(useCase);
      if (parsedUseCase === "assistant") {
        throw new Error("assistant 只能通过专用会话接口调用");
      }
      return runOneShot(
        parsedUseCase,
        prompt,
        context ? aiRequestContextSchema.parse(context) : undefined
      );
    }
  );

  ipcMain.handle(
    "assistant:send",
    (
      e,
      requestId: string,
      message: string,
      projectId: string,
      attachments: AssistantAttachmentPayload[],
      context: AiRequestContext | undefined,
      modelOverride: AiModelRef | null | undefined
    ) =>
      assistantSend(
        message,
        projectId ?? "default",
        attachments ?? [],
        context ? aiRequestContextSchema.parse(context) : undefined,
        modelOverride ? aiModelRefSchema.parse(modelOverride) : undefined,
        (event) => {
          if (!e.sender.isDestroyed()) {
            e.sender.send("assistant:event", requestId, event);
          }
        }
      )
  );
  ipcMain.handle("assistant:reset", () => {
    BROWSER_RUNTIME.cancelPending();
    assistantReset();
  });

  ipcMain.on("window:control", (e, action: string) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (action === "minimize") w.minimize();
    else if (action === "maximize") (w.isMaximized() ? w.unmaximize() : w.maximize());
    else if (action === "close") w.close();
  });
}

/* ---------- 生命周期 ---------- */

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("web-contents-created", (_event, contents) => {
    if (contents.getType() === "webview") BROWSER_SESSION.configureContents(contents);
  });
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    registerIpc();
    BROWSER_SESSION.setAgentDownloadApproval((webContentsId, filename, url) =>
      BROWSER_RUNTIME.approveDownload(webContentsId, filename, url)
    );
    BROWSER_SESSION.initialize(() => win);
    BROWSER_RUNTIME.initialize(() => win);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    BROWSER_RUNTIME.cancelPending();
    assistantReset();
    if (!isMac) app.quit();
  });

  let browserDataFlushed = false;
  app.on("before-quit", (event) => {
    BROWSER_RUNTIME.cancelPending();
    assistantReset();
    if (browserDataFlushed) return;
    event.preventDefault();
    browserDataFlushed = true;
    void BROWSER_SESSION.flush()
      .catch(() => undefined)
      .finally(() => app.quit());
  });
}
