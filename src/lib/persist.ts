import type { PersistedData, Task } from "@/types";
import { bridge } from "./bridge";
import { normalizeTaskTracking } from "./task-tracking";

const LS_KEY = "mailuo-data";

/** 旧版本数据结构补齐（v2 → v3 增加任务追踪类型） */
function migrate(raw: unknown): PersistedData | null {
  if (raw === null || typeof raw !== "object") return null;
  const data = raw as { projects?: unknown; tasks?: unknown };
  if (!Array.isArray(data.projects) || !Array.isArray(data.tasks)) return null;
  const lib = (raw as { tagLibrary?: unknown }).tagLibrary;
  return {
    version: 3,
    projects: data.projects,
    tasks: (data.tasks as Task[]).map((t) => ({
      ...t,
      tags: t.tags ?? [],
      tracking: normalizeTaskTracking(t.tracking),
    })),
    tagLibrary: Array.isArray(lib) ? (lib as string[]) : undefined,
  };
}

export async function loadPersisted(): Promise<PersistedData | null> {
  try {
    const raw = bridge ? await bridge.loadState() : localStorage.getItem(LS_KEY);
    return raw ? migrate(JSON.parse(raw)) : null;
  } catch (e) {
    console.error("加载数据失败", e);
    return null;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

export function schedulePersist(
  data: Omit<PersistedData, "version">
) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const json = JSON.stringify({ version: 3, ...data } satisfies PersistedData);
    try {
      if (bridge) {
        await bridge.saveState(json);
      } else {
        localStorage.setItem(LS_KEY, json);
      }
    } catch (e) {
      console.error("保存数据失败", e);
    }
  }, 350);
}
