import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

export interface AgentTurnCallbacks {
  onTextDelta?: (delta: string) => void;
  onThinkingDelta?: (delta: string) => void;
}

function assistantText(
  message: Extract<
    AgentSessionEvent,
    { type: "message_end" }
  >["message"]
): string {
  if (message.role !== "assistant") return "";
  return message.content
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("");
}

/**
 * Converts pi's session event stream into an application turn.
 *
 * pi reports provider failures as a terminal assistant message rather than
 * rejecting `session.prompt()`. Keeping that state here prevents callers from
 * mistaking a failed request for an empty successful response.
 */
export class AgentTurnAccumulator {
  private text = "";
  private currentMessageStreamedText = false;
  private terminalError: string | null = null;

  constructor(private readonly callbacks: AgentTurnCallbacks = {}) {}

  handle(event: AgentSessionEvent): void {
    if (event.type === "message_start" && event.message.role === "assistant") {
      this.currentMessageStreamedText = false;
      return;
    }

    if (event.type === "message_update") {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta" && update.delta) {
        this.currentMessageStreamedText = true;
        this.text += update.delta;
        this.callbacks.onTextDelta?.(update.delta);
      } else if (update.type === "thinking_delta" && update.delta) {
        this.callbacks.onThinkingDelta?.(update.delta);
      }
      return;
    }

    if (event.type !== "message_end" || event.message.role !== "assistant") {
      return;
    }

    const message = event.message;
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      this.terminalError =
        message.errorMessage?.trim() ||
        (message.stopReason === "aborted"
          ? "模型请求已取消"
          : "模型请求失败");
      return;
    }

    // A few compatible gateways buffer the entire response. Preserve the
    // stream-facing contract by forwarding their final text exactly once.
    this.terminalError = null;
    if (!this.currentMessageStreamedText) {
      const finalText = assistantText(message);
      if (finalText) {
        this.text += finalText;
        this.callbacks.onTextDelta?.(finalText);
      }
    }
  }

  finish(): string {
    if (this.terminalError) throw new Error(this.terminalError);
    return this.text.trim();
  }
}
