import type { PersistedData, Task } from "@/types";
import { bridge } from "./bridge";
import { normalizeTaskTracking } from "./task-tracking";
import { effectiveDue, normalizeTaskSchedule } from "./task-schedule";

const LS_KEY = "mailuo-data";

/**
 * 旧版本数据结构补齐。
 * v2 → v3 增加任务追踪类型；v3 → v4 增加日期安排（由 dueDate 迁移）。
 */
function migrate(raw: unknown): PersistedData | null {
  if (raw === null || typeof raw !== "object") return null;
  const data = raw as { projects?: unknown; tasks?: unknown };
  if (!Array.isArray(data.projects) || !Array.isArray(data.tasks)) return null;
  const lib = (raw as { tagLibrary?: unknown }).tagLibrary;
  return {
    version: 4,
    projects: data.projects,
    tasks: (data.tasks as Task[]).map((t) => {
      const schedule = normalizeTaskSchedule(t.schedule, t.dueDate);
      return {
        ...t,
        tags: t.tags ?? [],
        tracking: normalizeTaskTracking(t.tracking),
        schedule,
        dueDate: effectiveDue(schedule),
      };
    }),
    tagLibrary: Array.isArray(lib) ? (lib as string[]) : undefined,
  };
}

/**
 * 读取结果必须区分「还没有数据」和「读不出来」。
 *
 * 两者都当成 null 会让 store 以为是首次启动 → 落 seed 示例数据 → 350ms 后原子
 * 覆盖用户真实存档，且不可恢复。
 */
export type LoadResult =
  | { kind: "ok"; data: PersistedData }
  | { kind: "missing" }
  | { kind: "error"; message: string; raw?: string };

export async function loadPersisted(): Promise<LoadResult> {
  let raw: string | null;
  try {
    raw = bridge ? await bridge.loadState() : localStorage.getItem(LS_KEY);
  } catch (e) {
    return {
      kind: "error",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  if (raw === null) return { kind: "missing" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return {
      kind: "error",
      message: `存档不是合法的 JSON：${e instanceof Error ? e.message : String(e)}`,
      raw,
    };
  }

  const data = migrate(parsed);
  if (data === null) {
    return { kind: "error", message: "存档结构无法识别，可能已损坏", raw };
  }
  return { kind: "ok", data };
}

/* ---------- 保存：防抖 + 可 flush + 失败可见 ---------- */

let saveTimer: ReturnType<typeof setTimeout> | undefined;
/** 已排队但尚未落盘的快照；退出前用它做最后一次 flush。 */
let pending: PersistedData | null = null;
let onSaveError: ((message: string) => void) | undefined;

/** 让 UI 订阅保存失败，避免只写进 console 而用户以为已保存。 */
export function setPersistErrorHandler(handler: (message: string) => void) {
  onSaveError = handler;
}

/* ---------- 保存状态广播（状态栏订阅） ---------- */

export type PersistState = "idle" | "dirty" | "saving" | "error";

let persistState: PersistState = "idle";
let savedAt: number | null = null;
const stateListeners = new Set<() => void>();

function setPersistState(next: PersistState) {
  if (persistState === next) return;
  persistState = next;
  for (const listener of stateListeners) listener();
}

/** useSyncExternalStore 用：订阅保存状态变化 */
export function subscribePersistState(listener: () => void): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function getPersistState(): PersistState {
  return persistState;
}

export function getLastSavedAt(): number | null {
  return savedAt;
}

async function writeNow(data: PersistedData): Promise<void> {
  const json = JSON.stringify(data);
  if (bridge) await bridge.saveState(json);
  else localStorage.setItem(LS_KEY, json);
}

export function schedulePersist(data: Omit<PersistedData, "version">) {
  pending = { version: 4, ...data } satisfies PersistedData;
  setPersistState("dirty");
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushPersist();
  }, 350);
}

/** 立即写盘。退出、隐藏窗口、或需要确保落盘时调用。 */
export async function flushPersist(): Promise<void> {
  const snapshot = pending;
  if (!snapshot) return;
  clearTimeout(saveTimer);
  setPersistState("saving");
  try {
    await writeNow(snapshot);
    // 期间又有新改动的话，保留它等下一轮；否则清空 dirty 标记
    if (pending === snapshot) {
      pending = null;
      savedAt = Date.now();
      setPersistState("idle");
    } else {
      setPersistState("dirty");
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("保存数据失败", e);
    setPersistState("error");
    onSaveError?.(message);
  }
}

/** 是否还有未落盘的改动。 */
export function hasPendingWrites(): boolean {
  return pending !== null;
}
