import { contextBridge, ipcRenderer } from "electron";
import type {
  AssistantAttachmentPayload,
  AssistantEventPayload,
} from "../src/shared/assistant";

const api = {
  platform: process.platform as NodeJS.Platform,

  loadState: (): Promise<string | null> => ipcRenderer.invoke("state:load"),
  saveState: (data: string): Promise<void> =>
    ipcRenderer.invoke("state:save", data),
  getDataDir: (): Promise<string> => ipcRenderer.invoke("state:dir"),
  openDataDir: (): Promise<string> => ipcRenderer.invoke("state:open-dir"),

  listModels: (): Promise<
    { provider: string; id: string; name: string; reasoning: boolean }[]
  > => ipcRenderer.invoke("agent:models"),

  runAgent: (
    config: unknown,
    system: string | null,
    prompt: string
  ): Promise<string> => ipcRenderer.invoke("agent:run", config, system, prompt),

  assistantSend: (
    requestId: string,
    config: unknown,
    system: string,
    message: string,
    projectId: string,
    attachments: AssistantAttachmentPayload[]
  ): Promise<void> =>
    ipcRenderer.invoke(
      "assistant:send",
      requestId,
      config,
      system,
      message,
      projectId,
      attachments
    ),

  listSkills: (): Promise<
    { name: string; description: string; content: string }[]
  > => ipcRenderer.invoke("agent:skills"),
  readFile: (p: string): Promise<string> =>
    ipcRenderer.invoke("mailuo:read-file", p),
  readImageDataUrl: (p: string, mimeType: string): Promise<string> =>
    ipcRenderer.invoke("mailuo:read-image-data-url", p, mimeType),
  writeFile: (p: string, content: string): Promise<void> =>
    ipcRenderer.invoke("mailuo:write-file", p, content),
  memoryPath: (): Promise<string> => ipcRenderer.invoke("mailuo:memory-path"),
  memoryAppend: (note: string): Promise<void> =>
    ipcRenderer.invoke("mailuo:memory-append", note),
  workspaceDir: (projectId: string): Promise<string> =>
    ipcRenderer.invoke("mailuo:workspace-dir", projectId),

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
