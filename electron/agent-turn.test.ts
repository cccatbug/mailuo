import { describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import { AgentTurnAccumulator } from "./agent-turn";

function event(value: unknown): AgentSessionEvent {
  return value as AgentSessionEvent;
}

describe("AgentTurnAccumulator", () => {
  it("forwards streaming text deltas and returns the complete text", () => {
    const onTextDelta = vi.fn();
    const turn = new AgentTurnAccumulator({ onTextDelta });

    turn.handle(
      event({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "一二" },
      })
    );
    turn.handle(
      event({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "三" },
      })
    );

    expect(turn.finish()).toBe("一二三");
    expect(onTextDelta.mock.calls.flat()).toEqual(["一二", "三"]);
  });

  it("surfaces a provider terminal error instead of reporting an empty success", () => {
    const turn = new AgentTurnAccumulator();
    turn.handle(
      event({
        type: "message_end",
        message: {
          role: "assistant",
          content: [],
          stopReason: "error",
          errorMessage: "404 status code (no body)",
        },
      })
    );

    expect(() => turn.finish()).toThrow("404 status code");
  });

  it("forwards final assistant text once when a compatible provider does not emit deltas", () => {
    const onTextDelta = vi.fn();
    const turn = new AgentTurnAccumulator({ onTextDelta });
    turn.handle(
      event({
        type: "message_start",
        message: { role: "assistant", content: [] },
      })
    );
    turn.handle(
      event({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "完整回复" }],
          stopReason: "stop",
        },
      })
    );

    expect(turn.finish()).toBe("完整回复");
    expect(onTextDelta).toHaveBeenCalledOnce();
    expect(onTextDelta).toHaveBeenCalledWith("完整回复");
  });
});
