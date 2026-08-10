import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
} from "electron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  AI_CONFIG,
  AI_RUNTIME,
  MEMORY_ENGINE,
  appendMemory,
  assistantAbort,
  assistantReset,
  assistantSend,
  listAssistantCapabilities,
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
import type {
  AssistantApprovalResponse,
  AssistantAttachmentPayload,
  AssistantPermissionMode,
} from "../src/shared/assistant";
import type { MemoryKind, UpdateMemoryInput } from "../src/shared/memory";
import { ASSISTANT_CONTROL } from "./assistant-control";
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
import { TASK_RUNTIME } from "./task-runtime";
import type {
  BrowserAgentMode,
  BrowserApprovalResponse,
  BrowserTabCommandResult,
  BrowserTabRegistration,
  BrowserTabUpdate,
} from "../src/shared/browser";
import type { TaskCommandResult } from "../src/shared/task-commands";
import { PI_RESOURCES } from "./pi-resources";
import {
  reportWindowLoadError,
  safeSendToContents,
  safeSendToWindow,
  sendPiResourceProgress,
  showWindowWhenReady,
} from "./window-lifecycle";
import { FILE_SERVER } from "./file-server";

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

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/**
 * Returns null only when there is genuinely no saved state yet.
 *
 * Any other failure (permissions, EBUSY, I/O) is rethrown: the renderer must be
 * able to tell "first run" from "could not read", because it seeds demo data on
 * the former and seeding over real data destroys it.
 */
async function loadState(): Promise<string | null> {
  try {
    return await fs.readFile(dataFile(), "utf8");
  } catch (error) {
    if (!isMissing(error)) throw error;
    // 首次运行：尝试迁移 Tauri 时代的数据
    try {
      const legacy = await fs.readFile(tauriDataFile(), "utf8");
      await saveState(legacy);
      return legacy;
    } catch (legacyError) {
      if (!isMissing(legacyError)) throw legacyError;
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

/** 关窗前请渲染进程 flush 一次；渲染进程没响应就最多等 1.5s，不能卡住退出。 */
function requestRendererFlush(target: BrowserWindow): Promise<void> {
  if (target.isDestroyed()) return Promise.resolve();
  const token = randomUUID();
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      ipcMain.removeListener("state:flush-done", onDone);
      resolve();
    };
    const onDone = (_event: Electron.IpcMainEvent, received: string) => {
      if (received === token) done();
    };
    const timer = setTimeout(done, 1500);
    ipcMain.on("state:flush-done", onDone);
    if (!safeSendToWindow(target, "state:flush-request", token)) done();
  });
}

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

  const appContents = win.webContents;
  const appSession = appContents.session;
  appSession.setPermissionCheckHandler((contents, permission) => {
    if ((permission as string) !== "local-fonts") return true;
    return contents?.id === appContents.id;
  });
  appSession.setPermissionRequestHandler((contents, permission, callback) => {
    if ((permission as string) !== "local-fonts") return callback(true);
    callback(contents.id === appContents.id);
  });

  const createdWindow = win;
  createdWindow.once("ready-to-show", () => showWindowWhenReady(createdWindow));
  createdWindow.on("closed", () => {
    if (win === createdWindow) win = null;
  });

  // 关窗前给渲染进程一次落盘机会，否则防抖窗口里的最后一次改动会丢
  let stateFlushed = false;
  createdWindow.on("close", (event) => {
    if (stateFlushed) return;
    event.preventDefault();
    stateFlushed = true;
    void requestRendererFlush(createdWindow).finally(() => {
      if (!createdWindow.isDestroyed()) createdWindow.close();
    });
  });
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
    void win.loadURL(process.env.ELECTRON_RENDERER_URL).catch(reportWindowLoadError);
  } else {
    void win.loadFile(path.join(__dirname, "../renderer/index.html")).catch(reportWindowLoadError);
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

async function savePiConfig(
  mutate: (config: AiConfigV1) => void
): Promise<{ snapshot: Awaited<ReturnType<typeof AI_RUNTIME.snapshot>>; resources: Awaited<ReturnType<typeof PI_RESOURCES.discover>> }> {
  const current = await AI_RUNTIME.snapshot();
  const next = structuredClone(current.config);
  mutate(next);
  const saved = await AI_RUNTIME.saveConfig(next, current.etag);
  assistantReset();
  return { snapshot: saved, resources: await PI_RESOURCES.discover(saved.config) };
}

async function currentPiResources() {
  const snapshot = await AI_RUNTIME.snapshot();
  return PI_RESOURCES.discover(snapshot.config);
}

function normalizedPiPath(value: string): string {
  const pathValue = value.trim();
  if (!pathValue || pathValue.includes("\u0000")) {
    throw new Error("资源路径无效");
  }
  return path.resolve(pathValue);
}

function assertPiResourceKind(value: unknown): "extension" | "skill" {
  if (value !== "extension" && value !== "skill") {
    throw new Error("资源类型无效");
  }
  return value;
}

function assertPiSourceKind(value: unknown): "local" | "terminal" | "skills-sh" {
  if (value !== "local" && value !== "terminal" && value !== "skills-sh") {
    throw new Error("资源来源类型无效");
  }
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const base = path.resolve(root);
  const value = path.resolve(candidate);
  return value === base || value.startsWith(`${base}${path.sep}`);
}

function skillWriteRoots(config: AiConfigV1): string[] {
  return [
    AI_CONFIG.skillsDir,
    AI_CONFIG.skillsShDir,
    ...config.pi.skillPaths.map((entry) => entry.path),
  ].map((entry) => path.resolve(AI_CONFIG.root, entry));
}

function assertSkillWritable(config: AiConfigV1, filePath: string): string {
  const candidate = path.resolve(filePath);
  if (!skillWriteRoots(config).some((root) => isWithin(root, candidate))) {
    throw new Error("只能编辑已登记或应用管理目录中的 Skill");
  }
  return candidate;
}

function registerIpc() {
  PI_RESOURCES.onProgress((event) => sendPiResourceProgress(win, event));
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
  ipcMain.handle("browser:custom-css:set", (_event, css: string) =>
    BROWSER_SESSION.setCustomCss(css)
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
  ipcMain.on("tasks:command-result", (_event, result: TaskCommandResult) =>
    TASK_RUNTIME.settle(result)
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
  ipcMain.handle(
    "assistant:permission-mode",
    (_event, mode: AssistantPermissionMode) => {
      if (![
        "confirm-sensitive",
        "read-only",
        "yolo",
      ].includes(mode)) {
        throw new Error("无效的小枢权限模式");
      }
      ASSISTANT_CONTROL.setPermissionMode(mode);
      BROWSER_RUNTIME.setApprovalMode(
        mode === "yolo" ? "always-allow" : mode
      );
    }
  );
  ipcMain.on(
    "assistant:approval-response",
    (_event, response: AssistantApprovalResponse) =>
      ASSISTANT_CONTROL.settleApproval(response)
  );

  ipcMain.handle("agent:models", () => listModels());
  ipcMain.handle("agent:skills", async () => {
    const config = await AI_RUNTIME.snapshot();
    return listSkills(config.config.routes.assistant.contextProfileId);
  });
  ipcMain.handle(
    "agent:capabilities",
    (_event, projectId: string, modelOverride?: AiModelRef | null) =>
      listAssistantCapabilities(
        projectId ?? "default",
        modelOverride ? aiModelRefSchema.parse(modelOverride) : undefined
      )
  );
  ipcMain.handle("pi:resources:list", () => currentPiResources());
  ipcMain.handle("pi:resources:refresh", () => currentPiResources());
  ipcMain.handle("pi:resources:cancel", () => PI_RESOURCES.cancel());
  ipcMain.handle("pi:extensions:search", (_event, query: string) =>
    PI_RESOURCES.searchPiExtensions(query)
  );
  ipcMain.handle("pi:package:preview", (_event, source: string) =>
    PI_RESOURCES.previewPackage(source)
  );
  ipcMain.handle("pi:package:install", async (_event, source: string) => {
    const current = await AI_RUNTIME.snapshot();
    const normalizedSource = source.trim();
    if (!normalizedSource) throw new Error("Package source 不能为空");
    const installedPath = await PI_RESOURCES.installPackage(
      current.config,
      normalizedSource
    );
    return savePiConfig((config) => {
      const existing = config.pi.packages.find(
        (entry) => entry.source === normalizedSource
      );
      if (existing) {
        existing.enabled = true;
        if (installedPath) existing.installedPath = installedPath;
      } else {
        config.pi.packages.push({
          source: normalizedSource,
          enabled: true,
          ...(installedPath ? { installedPath } : {}),
        });
      }
    });
  });
  ipcMain.handle("pi:package:remove", async (_event, source: string) => {
    const current = await AI_RUNTIME.snapshot();
    const normalizedSource = source.trim();
    await PI_RESOURCES.removePackage(current.config, normalizedSource);
    return savePiConfig((config) => {
      config.pi.packages = config.pi.packages.filter(
        (entry) => entry.source !== normalizedSource
      );
    });
  });
  ipcMain.handle("pi:package:set-enabled", (_event, source: string, enabled: boolean) =>
    savePiConfig((config) => {
      const entry = config.pi.packages.find((item) => item.source === source.trim());
      if (!entry) throw new Error("Package 不存在");
      entry.enabled = Boolean(enabled);
    })
  );
  ipcMain.handle("pi:package:update", async (_event, source?: string) => {
    const current = await AI_RUNTIME.snapshot();
    await PI_RESOURCES.updatePackage(current.config, source?.trim() || undefined);
    assistantReset();
    return {
      snapshot: current,
      resources: await PI_RESOURCES.discover(current.config),
    };
  });
  ipcMain.handle("pi:skills-sh:search", (_event, query: string) =>
    PI_RESOURCES.searchSkillsSh(query)
  );
  ipcMain.handle("pi:skills-sh:list", (_event, source: string) =>
    PI_RESOURCES.listSkillsSh(source)
  );
  ipcMain.handle(
    "pi:skills-sh:install",
    async (_event, source: string, skillNames: string[] = []) => {
      const result = await PI_RESOURCES.installSkillsSh(source, skillNames);
      const saved = await savePiConfig((config) => {
        const install = result.install;
        config.pi.skillsSh.installs = config.pi.skillsSh.installs.filter(
          (entry) => entry.id !== install.id
        );
        config.pi.skillsSh.installs.push(install);
        if (!config.pi.skillPaths.some((entry) => path.resolve(entry.path) === path.resolve(result.skillPath!))) {
          config.pi.skillPaths.push({
            path: result.skillPath!,
            enabled: true,
            sourceKind: "skills-sh",
            label: install.source,
          });
        }
      });
      return { ...saved, command: result };
    }
  );
  ipcMain.handle(
    "pi:skills-sh:update",
    async (_event, installId: string, skillNames: string[] = []) => {
      const current = await AI_RUNTIME.snapshot();
      const install = current.config.pi.skillsSh.installs.find((entry) => entry.id === installId);
      if (!install) throw new Error("skills.sh 安装记录不存在");
      await PI_RESOURCES.updateSkillsSh(install.root, skillNames);
      assistantReset();
      return { snapshot: current, resources: await PI_RESOURCES.discover(current.config) };
    }
  );
  ipcMain.handle(
    "pi:skills-sh:remove",
    async (_event, installId: string, skillNames: string[] = []) => {
      const current = await AI_RUNTIME.snapshot();
      const install = current.config.pi.skillsSh.installs.find((entry) => entry.id === installId);
      if (!install) throw new Error("skills.sh 安装记录不存在");
      const result = await PI_RESOURCES.removeSkillsSh(install.root, skillNames);
      const saved = await savePiConfig((config) => {
        config.pi.skillsSh.installs = config.pi.skillsSh.installs.filter((entry) => entry.id !== installId);
        config.pi.skillPaths = config.pi.skillPaths.filter(
          (entry) => !path.resolve(entry.path).startsWith(`${path.resolve(install.root)}${path.sep}`)
        );
      });
      return { ...saved, command: result };
    }
  );
  ipcMain.handle(
    "pi:path:add",
    (_event, kind: unknown, resourcePath: string, sourceKind: unknown, label?: string) =>
      savePiConfig((config) => {
        const resourceKind = assertPiResourceKind(kind);
        const pathKind = assertPiSourceKind(sourceKind);
        const normalizedPath = normalizedPiPath(resourcePath);
        const target = resourceKind === "extension" ? config.pi.extensionPaths : config.pi.skillPaths;
        if (!target.some((entry) => path.resolve(entry.path) === normalizedPath)) {
          target.push({
            path: normalizedPath,
            enabled: true,
            sourceKind: pathKind,
            ...(label?.trim() ? { label: label.trim() } : {}),
          });
        }
      })
  );
  ipcMain.handle(
    "pi:path:remove",
    (_event, kind: unknown, resourcePath: string) =>
      savePiConfig((config) => {
        const resourceKind = assertPiResourceKind(kind);
        const normalizedPath = normalizedPiPath(resourcePath);
        if (resourceKind === "extension") {
          config.pi.extensionPaths = config.pi.extensionPaths.filter(
            (entry) => path.resolve(entry.path) !== normalizedPath
          );
        } else {
          config.pi.skillPaths = config.pi.skillPaths.filter(
            (entry) => path.resolve(entry.path) !== normalizedPath
          );
        }
      })
  );
  ipcMain.handle(
    "pi:path:set-enabled",
    (_event, kind: unknown, resourcePath: string, enabled: boolean) =>
      savePiConfig((config) => {
        const resourceKind = assertPiResourceKind(kind);
        const normalizedPath = normalizedPiPath(resourcePath);
        const target = resourceKind === "extension" ? config.pi.extensionPaths : config.pi.skillPaths;
        const entry = target.find((item) => path.resolve(item.path) === normalizedPath);
        if (!entry) throw new Error("资源路径未登记");
        entry.enabled = Boolean(enabled);
      })
  );
  ipcMain.handle(
    "pi:extension:set-enabled",
    (_event, id: string, enabled: boolean) =>
      savePiConfig((config) => {
        const key = id.trim();
        if (!key) throw new Error("扩展 ID 无效");
        config.pi.extensionOverrides[key] = Boolean(enabled);
      })
  );
  ipcMain.handle(
    "pi:skill:set-profiles",
    (_event, id: string, profileIds: string[] | null) =>
      savePiConfig((config) => {
        const key = id.trim();
        if (!key) throw new Error("Skill ID 无效");
        if (profileIds === null) delete config.pi.skillProfileIds[key];
        else config.pi.skillProfileIds[key] = [...new Set(profileIds.map((value) => value.trim()).filter(Boolean))];
      })
  );
  ipcMain.handle("pi:path:pick", async (_event, kind: unknown) => {
    const resourceKind = assertPiResourceKind(kind);
    const result = await dialog.showOpenDialog({
      title: resourceKind === "extension" ? "选择 pi Extension" : "选择 Skills 目录或 SKILL.md",
      properties: ["openFile", "openDirectory"],
      ...(resourceKind === "extension"
        ? { filters: [{ name: "Extension", extensions: ["ts", "js", "mjs", "cjs"] }] }
        : { filters: [{ name: "Skill", extensions: ["md"] }] }),
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle("pi:resource:open", async (_event, resourcePath: string) => {
    const candidate = normalizedPiPath(resourcePath);
    const resources = await currentPiResources();
    const allowed = [...resources.extensions.map((item) => item.path), ...resources.skills.map((item) => item.filePath), ...resources.paths.map((item) => item.path)];
    if (!allowed.some((item) => path.resolve(item) === candidate || candidate.startsWith(`${path.resolve(item)}${path.sep}`))) {
      throw new Error("只能打开已登记的资源路径");
    }
    return shell.openPath(candidate);
  });
  ipcMain.handle("pi:skill:read", async (_event, id: string) => {
    const resources = await currentPiResources();
    const skill = resources.skills.find((entry) => entry.id === id);
    if (!skill) throw new Error("Skill 不存在或尚未刷新");
    return fs.readFile(skill.filePath, "utf8");
  });
  ipcMain.handle(
    "pi:skill:write",
    async (_event, id: string, content: string) => {
      if (typeof content !== "string" || content.length > 250_000) {
        throw new Error("SKILL.md 不能为空或超过 250 KB");
      }
      const current = await AI_RUNTIME.snapshot();
      const resources = await PI_RESOURCES.discover(current.config);
      const skill = resources.skills.find((entry) => entry.id === id);
      if (!skill) throw new Error("Skill 不存在或尚未刷新");
      const filePath = assertSkillWritable(current.config, skill.filePath);
      await fs.writeFile(filePath, content, "utf8");
      assistantReset();
      return { snapshot: current, resources: await PI_RESOURCES.discover(current.config) };
    }
  );
  ipcMain.handle(
    "pi:skill:create",
    async (
      _event,
      name: string,
      content?: string,
      rootInput?: string
    ) => {
      const current = await AI_RUNTIME.snapshot();
      const root = rootInput ? normalizedPiPath(rootInput) : path.resolve(AI_CONFIG.skillsDir);
      if (!skillWriteRoots(current.config).some((entry) => path.resolve(entry) === root)) {
        throw new Error("新建 Skill 只能写入已登记或应用管理的 Skill 根目录");
      }
      const slug = name.trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)) {
        throw new Error("Skill 名称只能使用小写字母、数字和连字符");
      }
      const filePath = path.join(root, slug, "SKILL.md");
      if (!isWithin(root, filePath)) throw new Error("Skill 路径越界");
      try {
        await fs.access(filePath);
        throw new Error("Skill 已存在");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const sourceEntry = current.config.pi.skillPaths.find(
        (entry) => path.resolve(entry.path) === root
      );
      const body = content?.trim() || `---\nname: ${slug}\ndescription: 请填写这个 Skill 的用途与使用时机。\n---\n\n# ${slug}\n\n请填写执行步骤。\n`;
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, `${body.endsWith("\n") ? body : `${body}\n`}`, "utf8");
      const saved = await savePiConfig((config) => {
        if (!config.pi.skillPaths.some((entry) => path.resolve(entry.path) === root)) {
          config.pi.skillPaths.push({
            path: root,
            enabled: true,
            sourceKind: sourceEntry?.sourceKind ?? "local",
            ...(sourceEntry?.label ? { label: sourceEntry.label } : {}),
          });
        }
      });
      return saved;
    }
  );
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
    "mailuo:file-url",
    (_e, p: string, mimeType: string) => FILE_SERVER.urlFor(p, mimeType)
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
  ipcMain.handle("memory:snapshot", () => MEMORY_ENGINE.snapshot());
  ipcMain.handle("memory:set-enabled", (_e, enabled: boolean) =>
    MEMORY_ENGINE.setEnabled(Boolean(enabled))
  );
  ipcMain.handle(
    "memory:remember",
    (_e, content: string, projectId?: string, kind?: MemoryKind) =>
      MEMORY_ENGINE.remember({
        content,
        ...(kind ? { kind } : {}),
        scope: projectId
          ? { type: "project", projectId }
          : { type: "global" },
        source: "explicit",
      })
  );
  ipcMain.handle(
    "memory:update",
    (_e, id: string, patch: UpdateMemoryInput) => MEMORY_ENGINE.update(id, patch)
  );
  ipcMain.handle("memory:delete", (_e, id: string) => MEMORY_ENGINE.delete(id));
  ipcMain.handle("memory:rebuild", () => MEMORY_ENGINE.rebuild());
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
      conversationId: string,
      attachments: AssistantAttachmentPayload[],
      context: AiRequestContext | undefined,
      modelOverride: AiModelRef | null | undefined
    ) =>
      assistantSend(
        requestId,
        message,
        projectId ?? "default",
        conversationId,
        attachments ?? [],
        context ? aiRequestContextSchema.parse(context) : undefined,
        modelOverride ? aiModelRefSchema.parse(modelOverride) : undefined,
        (event) => {
          safeSendToContents(e.sender, "assistant:event", requestId, event);
        }
      )
  );
  ipcMain.handle("assistant:abort", async (_e, requestId: string) => {
    BROWSER_RUNTIME.cancelPending();
    TASK_RUNTIME.cancelPending();
    ASSISTANT_CONTROL.cancelPending();
    return assistantAbort(requestId);
  });
  ipcMain.handle("assistant:reset", () => {
    BROWSER_RUNTIME.cancelPending();
    TASK_RUNTIME.cancelPending();
    ASSISTANT_CONTROL.cancelPending();
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
    if (!win || win.isDestroyed()) {
      win = null;
      createWindow();
      return;
    }
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  void app.whenReady().then(async () => {
    registerIpc();
    app.on("will-quit", () => FILE_SERVER.close());
    BROWSER_SESSION.setAgentDownloadApproval((webContentsId, filename, url) =>
      BROWSER_RUNTIME.approveDownload(webContentsId, filename, url)
    );
    BROWSER_SESSION.initialize(() => win);
    BROWSER_RUNTIME.initialize(() => win);
    TASK_RUNTIME.initialize(() => win);
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    BROWSER_RUNTIME.cancelPending();
    TASK_RUNTIME.cancelPending();
    assistantReset();
    // macOS 生产应用保留进程；开发时必须退出，否则下一次 pnpm dev 会被旧实例锁住，Vite 也会随之退出。
    if (!isMac || process.env.NODE_ENV_ELECTRON_VITE === "development") app.quit();
  });

  let browserDataFlushed = false;
  app.on("before-quit", (event) => {
    BROWSER_RUNTIME.cancelPending();
    TASK_RUNTIME.cancelPending();
    assistantReset();
    if (browserDataFlushed) return;
    event.preventDefault();
    browserDataFlushed = true;
    void BROWSER_SESSION.flush()
      .catch(() => undefined)
      .finally(() => app.quit());
  });
}
