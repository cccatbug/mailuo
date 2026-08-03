import { describe, expect, it, vi } from "vitest";
import { AssistantTurnRuntime } from "./assistant-turn-runtime";

describe("AssistantTurnRuntime", () => {
  it("aborts only the active matching assistant request", async () => {
    const abort = vi.fn(async () => undefined);
    const runtime = new AssistantTurnRuntime();

    const finish = runtime.begin("turn-1", abort);

    await expect(runtime.abort("stale-turn")).resolves.toBe(false);
    expect(abort).not.toHaveBeenCalled();

    await expect(runtime.abort("turn-1")).resolves.toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);

    await expect(runtime.abort("turn-1")).resolves.toBe(true);
    expect(abort).toHaveBeenCalledTimes(1);

    finish();
    await expect(runtime.abort("turn-1")).resolves.toBe(false);
  });

  it("does not let an old turn clear a newer active turn", async () => {
    const firstAbort = vi.fn(async () => undefined);
    const secondAbort = vi.fn(async () => undefined);
    const runtime = new AssistantTurnRuntime();

    const finishFirst = runtime.begin("turn-1", firstAbort);
    runtime.begin("turn-2", secondAbort);
    finishFirst();

    await expect(runtime.abort("turn-2")).resolves.toBe(true);
    expect(firstAbort).not.toHaveBeenCalled();
    expect(secondAbort).toHaveBeenCalledTimes(1);
  });
});
