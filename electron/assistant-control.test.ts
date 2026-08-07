import { describe, expect, it } from "vitest";
import type { AssistantEventPayload } from "../src/shared/assistant";
import {
  AssistantControl,
  createTodoTool,
} from "./assistant-control";

describe("AssistantControl", () => {
  it("runs mutating tools without approval in YOLO mode", async () => {
    const control = new AssistantControl();
    const events: AssistantEventPayload[] = [];
    control.beginTurn((event) => events.push(event));
    control.setPermissionMode("yolo");

    await expect(
      control.approveTool("write", { path: "report.md" })
    ).resolves.toBe(true);
    expect(events).toEqual([]);
  });

  it("requests approval for file writes in standard mode", async () => {
    const control = new AssistantControl();
    const events: AssistantEventPayload[] = [];
    control.beginTurn((event) => events.push(event));

    const result = control.approveTool("write", { path: "report.md" });
    const event = events[0];
    expect(event?.type).toBe("approval");
    if (event?.type !== "approval") throw new Error("missing approval event");
    expect(event.request).toMatchObject({
      toolName: "write",
      summary: "report.md",
      reason: "mutation",
    });

    control.settleApproval({ id: event.request.id, allowed: true });
    await expect(result).resolves.toBe(true);
  });

  it("requests approval for task mutations but not task reads", async () => {
    const control = new AssistantControl();
    const events: AssistantEventPayload[] = [];
    control.beginTurn((event) => events.push(event));

    await expect(control.approveTool("task_list", {})).resolves.toBe(true);
    expect(events).toEqual([]);

    const result = control.approveTool("task_update", {
      updates: [{ task: "t1", status: "done" }],
    });
    const event = events[0];
    expect(event?.type).toBe("approval");
    if (event?.type !== "approval") throw new Error("missing approval event");
    expect(event.request).toMatchObject({
      toolName: "task_update",
      label: "修改任务",
      reason: "mutation",
    });

    control.settleApproval({ id: event.request.id, allowed: true });
    await expect(result).resolves.toBe(true);
  });

  it("only treats project_list as a mutation when it switches project", async () => {
    const control = new AssistantControl();
    const events: AssistantEventPayload[] = [];
    control.beginTurn((event) => events.push(event));

    await expect(control.approveTool("project_list", {})).resolves.toBe(true);
    expect(events).toEqual([]);

    const result = control.approveTool("project_list", { switchTo: "工作" });
    const event = events[0];
    if (event?.type !== "approval") throw new Error("missing approval event");
    control.settleApproval({ id: event.request.id, allowed: false });
    await expect(result).resolves.toBe(false);
  });

  it("publishes a normalized Todo plan", async () => {
    const control = new AssistantControl();
    const events: AssistantEventPayload[] = [];
    control.beginTurn((event) => events.push(event));
    const tool = createTodoTool(control);

    await tool.execute(
      "todo-1",
      {
        todos: [
          { id: " inspect ", text: " 检查现状 ", status: "completed" },
          { id: "inspect", text: "重复项", status: "pending" },
          { id: "build", text: "实现功能", status: "in_progress" },
        ],
      },
      undefined,
      undefined,
      {} as never
    );

    expect(events).toEqual([
      {
        type: "todos",
        todos: [
          { id: "inspect", text: "检查现状", status: "completed" },
          { id: "build", text: "实现功能", status: "in_progress" },
        ],
      },
    ]);
  });
});
