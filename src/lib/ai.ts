import type {
  AiModelRef,
  AiRequestContext,
} from "@/shared/ai-config";
import type { OneShotUseCase } from "@/shared/ai-prompts";
import {
  bridge,
  type AssistantAttachmentPayload,
  type AssistantEventPayload,
} from "./bridge";

/** 一次性 agent 调用（pi SDK，主进程内），返回纯文本回复 */
export async function runAgent(opts: {
  useCase: OneShotUseCase;
  prompt: string;
  context?: AiRequestContext;
}): Promise<string> {
  if (!bridge) throw new Error("AI 能力仅在桌面应用中可用");
  return bridge.runAgent(
    opts.useCase,
    opts.prompt,
    opts.context
  );
}

export interface AssistantTurnHandle {
  requestId: string;
  completion: Promise<void>;
  abort: () => Promise<boolean>;
}

/** 启动常驻小枢回合，并返回可精确中断该 request 的句柄。 */
export function startAssistantTurn(
  message: string,
  projectId: string,
  conversationId: string,
  attachments: AssistantAttachmentPayload[],
  context: AiRequestContext,
  modelOverride: AiModelRef | null | undefined,
  onEvent: (event: AssistantEventPayload) => void
): AssistantTurnHandle {
  const b = bridge;
  if (!b) throw new Error("AI 能力仅在桌面应用中可用");
  const requestId = crypto.randomUUID();
  const completion = new Promise<void>((resolve, reject) => {
    const unsubscribe = b.onAssistantEvent(
      (id: string, event: AssistantEventPayload) => {
        if (id !== requestId) return;
        if (event.type === "done" || event.type === "aborted") {
          unsubscribe();
          onEvent(event);
          resolve();
        } else if (event.type === "error") {
          unsubscribe();
          reject(new Error(event.message ?? "助手出错"));
        } else {
          onEvent(event);
        }
      }
    );
    b.assistantSend(
      requestId,
      message,
      projectId,
      conversationId,
      attachments,
      context,
      modelOverride
    ).catch((e) => {
      unsubscribe();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
  return {
    requestId,
    completion,
    abort: () => b.assistantAbort(requestId),
  };
}

export async function assistantReset(): Promise<void> {
  await bridge?.assistantReset();
}

/** 从模型回复中提取第一个 JSON 对象（容忍代码围栏与前后闲话） */
export function extractJson<T>(text: string): T {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const source = fence ? fence[1] : text;
  const start = source.indexOf("{");
  if (start === -1) throw new Error("回复中没有找到 JSON");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === "\\") {
      esc = true;
      continue;
    }
    if (ch === '"') inStr = !inStr;
    if (inStr) continue;
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) {
        return JSON.parse(source.slice(start, i + 1)) as T;
      }
    }
  }
  throw new Error("JSON 不完整");
}

export async function runAgentJson<T>(opts: {
  useCase: OneShotUseCase;
  prompt: string;
  context?: AiRequestContext;
}): Promise<T> {
  const text = await runAgent(opts);
  return extractJson<T>(text);
}
