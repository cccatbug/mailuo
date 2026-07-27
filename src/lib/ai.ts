import { useAppStore } from "@/store/useAppStore";
import {
  bridge,
  type AssistantAttachmentPayload,
  type AssistantEventPayload,
} from "./bridge";

function agentConfig() {
  const { settings } = useAppStore.getState();
  return {
    provider: settings.provider || null,
    model: settings.model || null,
    thinking: settings.thinking || null,
    proxy: settings.proxy || null,
  };
}

/** 一次性 agent 调用（pi SDK，主进程内），返回纯文本回复 */
export async function runAgent(opts: {
  system?: string;
  prompt: string;
}): Promise<string> {
  if (!bridge) throw new Error("AI 能力仅在桌面应用中可用");
  return bridge.runAgent(agentConfig(), opts.system ?? null, opts.prompt);
}

/** 通过常驻 pi SDK 会话发送消息，全事件流式回调（文本/思考/工具），回合结束 resolve。 */
export async function assistantSend(
  system: string,
  message: string,
  projectId: string,
  attachments: AssistantAttachmentPayload[],
  onEvent: (event: AssistantEventPayload) => void
): Promise<void> {
  const b = bridge;
  if (!b) throw new Error("AI 能力仅在桌面应用中可用");
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const unsubscribe = b.onAssistantEvent(
      (id: string, event: AssistantEventPayload) => {
        if (id !== requestId) return;
        if (event.type === "done") {
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
      agentConfig(),
      system,
      message,
      projectId,
      attachments
    ).catch((e) => {
      unsubscribe();
      reject(e instanceof Error ? e : new Error(String(e)));
    });
  });
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
  system?: string;
  prompt: string;
}): Promise<T> {
  const text = await runAgent(opts);
  return extractJson<T>(text);
}
