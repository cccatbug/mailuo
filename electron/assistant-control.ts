import { Type } from "typebox";
import {
  defineTool,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type {
  AssistantApprovalResponse,
  AssistantEventPayload,
  AssistantPermissionMode,
  AssistantTodoItem,
} from "../src/shared/assistant";

type EventSink = (event: AssistantEventPayload) => void;

interface PendingApproval {
  resolve: (allowed: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
}

const MUTATING_TOOLS = new Set(["bash", "edit", "write"]);

const TOOL_LABELS: Record<string, string> = {
  bash: "运行命令",
  edit: "编辑文件",
  write: "写入文件",
};

function summarizeTool(toolName: string, input: Record<string, unknown>): string {
  const candidate =
    toolName === "bash"
      ? input.command
      : input.path ?? input.file_path ?? input.filePath;
  if (typeof candidate === "string" && candidate.trim()) {
    const normalized = candidate.replace(/\s+/g, " ").trim();
    return normalized.length > 180 ? `${normalized.slice(0, 180)}…` : normalized;
  }
  const fallback = JSON.stringify(input);
  return fallback.length > 180 ? `${fallback.slice(0, 180)}…` : fallback;
}

export class AssistantControl {
  private mode: AssistantPermissionMode = "confirm-sensitive";
  private sink: EventSink | null = null;
  private readonly approvals = new Map<string, PendingApproval>();

  setPermissionMode(mode: AssistantPermissionMode): void {
    this.mode = mode;
    if (mode !== "yolo") return;
    for (const pending of this.approvals.values()) {
      clearTimeout(pending.timer);
      pending.resolve(true);
    }
    this.approvals.clear();
  }

  beginTurn(sink: EventSink): void {
    this.sink = sink;
  }

  endTurn(sink: EventSink): void {
    if (this.sink === sink) this.sink = null;
  }

  settleApproval(response: AssistantApprovalResponse): void {
    const pending = this.approvals.get(response.id);
    if (!pending) return;
    this.approvals.delete(response.id);
    clearTimeout(pending.timer);
    pending.resolve(response.allowed);
  }

  cancelPending(): void {
    for (const pending of this.approvals.values()) {
      clearTimeout(pending.timer);
      pending.resolve(false);
    }
    this.approvals.clear();
  }

  publishTodos(todos: AssistantTodoItem[]): void {
    this.sink?.({ type: "todos", todos });
  }

  async approveTool(
    toolName: string,
    input: Record<string, unknown>
  ): Promise<boolean> {
    if (!MUTATING_TOOLS.has(toolName) || this.mode === "yolo") return true;
    if (!this.sink) return false;

    const id = crypto.randomUUID();
    const allowed = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.approvals.delete(id);
        resolve(false);
      }, 5 * 60_000);
      this.approvals.set(id, { resolve, timer });
    });
    this.sink({
      type: "approval",
      request: {
        id,
        toolName,
        label: TOOL_LABELS[toolName] ?? toolName,
        summary: summarizeTool(toolName, input),
        reason: this.mode === "read-only" ? "read-only" : "mutation",
      },
    });
    return allowed;
  }
}

export const ASSISTANT_CONTROL = new AssistantControl();

export const assistantPermissionExtension: InlineExtension = {
  name: "mailuo-permissions",
  hidden: true,
  factory(pi) {
    pi.on("tool_call", async (event) => {
      // 浏览器工具已有更细粒度的页面敏感操作审批，Todo 只更新本地 UI。
      if (event.toolName.startsWith("browser_") || event.toolName === "todo_write") {
        return undefined;
      }
      const allowed = await ASSISTANT_CONTROL.approveTool(
        event.toolName,
        event.input as Record<string, unknown>
      );
      return allowed
        ? undefined
        : { block: true, reason: "用户拒绝了小枢执行该操作" };
    });
  },
};

const todoStatus = Type.Union([
  Type.Literal("pending"),
  Type.Literal("in_progress"),
  Type.Literal("completed"),
]);

export function createTodoTool(
  control: AssistantControl = ASSISTANT_CONTROL
): ToolDefinition {
  return defineTool({
    name: "todo_write",
    label: "更新执行计划",
    description:
      "创建或更新当前请求的执行 Todo。仅在任务包含多个可验证步骤时使用；简单请求不要创建 Todo。每次传入完整列表，并随进展及时更新状态。",
    promptSnippet: "按需创建并实时更新当前请求的 Todo 执行计划。",
    promptGuidelines: [
      "复杂、多步骤任务开始时可用 todo_write 建立 2-8 个具体步骤；简单任务直接执行。",
      "任一时刻最多一个 in_progress；完成步骤后立即更新，不要把 Todo 当作最终回复。",
    ],
    executionMode: "sequential",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          id: Type.String({ description: "稳定、简短的步骤 id" }),
          text: Type.String({ description: "具体、可验证的步骤" }),
          status: todoStatus,
        }),
        { maxItems: 12 }
      ),
    }),
    async execute(_toolCallId, params) {
      const seen = new Set<string>();
      const todos: AssistantTodoItem[] = [];
      for (const input of params.todos) {
        const todo: AssistantTodoItem = {
          id: input.id.trim().slice(0, 48),
          text: input.text.trim().slice(0, 240),
          status: input.status,
        };
        if (!todo.id || !todo.text || seen.has(todo.id)) continue;
        seen.add(todo.id);
        todos.push(todo);
      }
      if (todos.filter((todo) => todo.status === "in_progress").length > 1) {
        return {
          content: [
            { type: "text" as const, text: "Todo 更新失败：同时只能有一个进行中步骤。" },
          ],
          details: undefined,
        };
      }
      control.publishTodos(todos);
      const completed = todos.filter((todo) => todo.status === "completed").length;
      return {
        content: [
          {
            type: "text" as const,
            text: `执行计划已更新：${completed}/${todos.length} 已完成。`,
          },
        ],
        details: undefined,
      };
    },
  });
}
