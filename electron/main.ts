import { app, BrowserWindow, ipcMain, shell } from "electron";
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
    },
  });

  win.once("ready-to-show", () => win?.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
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
      draft: AiCredentialDraft
    ) => {
      const { provider, credential } = await resolveProviderDraft(
        providerInput,
        draft
      );
      return testProviderConnection(provider, credential);
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
  ipcMain.handle("assistant:reset", () => assistantReset());

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
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  void app.whenReady().then(async () => {
    registerIpc();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    assistantReset();
    if (!isMac) app.quit();
  });

  app.on("before-quit", () => {
    assistantReset();
  });
}
