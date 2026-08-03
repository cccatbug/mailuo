export type AbortAssistantTurn = () => void | Promise<void>;

interface ActiveAssistantTurn {
  requestId: string;
  abort: AbortAssistantTurn;
  abortPromise: Promise<void> | null;
}

/** Request-scoped owner for the one resident assistant turn. */
export class AssistantTurnRuntime {
  private active: ActiveAssistantTurn | null = null;

  begin(requestId: string, abort: AbortAssistantTurn): () => void {
    const turn: ActiveAssistantTurn = { requestId, abort, abortPromise: null };
    this.active = turn;
    return () => {
      if (this.active === turn) this.active = null;
    };
  }

  async abort(requestId: string): Promise<boolean> {
    const turn = this.active;
    if (!turn || turn.requestId !== requestId) return false;
    turn.abortPromise ??= Promise.resolve().then(() => turn.abort());
    await turn.abortPromise;
    return true;
  }

  async abortActive(): Promise<boolean> {
    return this.active ? this.abort(this.active.requestId) : false;
  }
}

export const ASSISTANT_TURN_RUNTIME = new AssistantTurnRuntime();
