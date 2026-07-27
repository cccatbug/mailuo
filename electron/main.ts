import { app, BrowserWindow, ipcMain, shell } from "electron";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
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
  type AgentConfig,
} from "./pi";
import type { AssistantAttachmentPayload } from "../src/shared/assistant";

const isMac = process.platform === "darwin";

/* ---------- 登录 shell 环境（API 密钥、代理常在 .zshrc 里，GUI 进程拿不到） ---------- */

async function importLoginShellEnv(): Promise<void> {
  if (process.platform === "win32") return;
  const shellBin = process.env.SHELL || "/bin/zsh";
  try {
    const out = await new Promise<string>((resolve, reject) => {
      execFile(
        shellBin,
        ["-lic", "env -0"],
        { timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
        (err, stdout) => (err ? reject(err) : resolve(stdout))
      );
    });
    for (const kv of out.split("\0")) {
      const idx = kv.indexOf("=");
      if (idx <= 0) continue;
      const key = kv.slice(0, idx);
      // 只补缺，不覆盖已有值
      if (!(key in process.env)) process.env[key] = kv.slice(idx + 1);
    }
  } catch (e) {
    console.warn("导入登录 shell 环境失败：", e);
  }
}

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

function registerIpc() {
  ipcMain.handle("state:load", () => loadState());
  ipcMain.handle("state:save", (_e, data: string) => saveState(data));
  ipcMain.handle("state:dir", () => app.getPath("userData"));
  ipcMain.handle("state:open-dir", () => shell.openPath(app.getPath("userData")));

  ipcMain.handle("agent:models", () => listModels());
  ipcMain.handle("agent:skills", () => listSkills());
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
    (_e, config: AgentConfig, system: string | null, prompt: string) =>
      runOneShot(config, system, prompt)
  );

  ipcMain.handle(
    "assistant:send",
    (
      e,
      requestId: string,
      config: AgentConfig,
      system: string,
      message: string,
      projectId: string,
      attachments: AssistantAttachmentPayload[]
    ) =>
      assistantSend(
        config,
        system,
        message,
        projectId ?? "default",
        attachments ?? [],
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
    await importLoginShellEnv();
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
