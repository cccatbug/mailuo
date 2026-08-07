import type { BrowserWindow } from "electron";
import type {
  TaskCommand,
  TaskCommandAction,
  TaskCommandResult,
} from "../src/shared/task-commands";

interface PendingCommand {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/** 任务命令超时；store 操作是同步的，10 秒还没回来就是窗口出了问题 */
const COMMAND_TIMEOUT_MS = 10_000;

class TaskRuntime {
  private getWindow: () => BrowserWindow | null = () => null;
  private readonly commands = new Map<string, PendingCommand>();

  initialize(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow;
  }

  request<T = unknown>(
    action: TaskCommandAction,
    payload: Record<string, unknown> = {}
  ): Promise<T> {
    const window = this.getWindow();
    if (!window || window.isDestroyed()) {
      return Promise.reject(new Error("工作区窗口不可用，无法操作任务"));
    }
    const requestId = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.commands.delete(requestId);
        reject(new Error("任务操作超时"));
      }, COMMAND_TIMEOUT_MS);
      this.commands.set(requestId, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      window.webContents.send("tasks:command", {
        requestId,
        action,
        payload,
      } satisfies TaskCommand);
    });
  }

  settle(result: TaskCommandResult): void {
    const pending = this.commands.get(result.requestId);
    if (!pending) return;
    this.commands.delete(result.requestId);
    clearTimeout(pending.timer);
    if (result.ok) pending.resolve(result.data);
    else pending.reject(new Error(result.error || "任务操作失败"));
  }

  cancelPending(): void {
    for (const pending of this.commands.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("工作区窗口已关闭"));
    }
    this.commands.clear();
  }
}

export const TASK_RUNTIME = new TaskRuntime();
