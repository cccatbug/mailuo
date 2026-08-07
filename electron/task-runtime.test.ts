import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { TASK_RUNTIME } from "./task-runtime";
import { createTaskTools } from "./task-tools";

describe("TaskRuntime", () => {
  afterEach(() => TASK_RUNTIME.cancelPending());

  it("round-trips a renderer command result to the calling task tool", async () => {
    const send = vi.fn();
    const window = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as BrowserWindow;
    TASK_RUNTIME.initialize(() => window);

    const pending = TASK_RUNTIME.request("list_tasks", { status: "today" });
    expect(send).toHaveBeenCalledWith(
      "tasks:command",
      expect.objectContaining({
        action: "list_tasks",
        payload: { status: "today" },
      })
    );
    const command = send.mock.calls[0][1] as { requestId: string };
    TASK_RUNTIME.settle({
      requestId: command.requestId,
      ok: true,
      data: { total: 2 },
    });

    await expect(pending).resolves.toEqual({ total: 2 });
  });

  it("surfaces renderer failures instead of claiming the mutation succeeded", async () => {
    const send = vi.fn();
    const window = {
      isDestroyed: () => false,
      webContents: { send },
    } as unknown as BrowserWindow;
    TASK_RUNTIME.initialize(() => window);

    const pending = TASK_RUNTIME.request("delete_tasks", { tasks: ["t1"] });
    const command = send.mock.calls[0][1] as { requestId: string };
    TASK_RUNTIME.settle({
      requestId: command.requestId,
      ok: false,
      error: "任务不存在",
    });

    await expect(pending).rejects.toThrow("任务不存在");
  });
});

describe("createTaskTools", () => {
  it("registers the complete native task tool surface", () => {
    expect(createTaskTools().map((tool) => tool.name)).toEqual([
      "task_list",
      "task_detail",
      "task_create",
      "task_update",
      "task_delete",
      "task_link",
      "project_list",
    ]);
  });
});
