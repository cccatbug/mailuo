import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/types";

/** 只有 localStorage 是 store 模块加载时就要用到的。 */
function stubStorage() {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
}

function task(id: string, deps: string[] = []): Task {
  return {
    id,
    projectId: "p1",
    title: id,
    notes: "",
    status: "todo",
    priority: "normal",
    dueDate: null,
    tags: [],
    deps,
    createdAt: 1,
    completedAt: null,
    tracking: { type: "standard" },
  };
}

async function freshStore() {
  vi.resetModules();
  stubStorage();
  const { useAppStore } = await import("./useAppStore");
  return useAppStore;
}

describe("deleteTasks / restoreTasks", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("restores dependency edges between tasks deleted in the same batch", async () => {
    const useAppStore = await freshStore();
    // c → b → a（b 依赖 a，c 依赖 b）
    useAppStore.setState({
      tasks: [task("a"), task("b", ["a"]), task("c", ["b"])],
    });

    const removed = useAppStore.getState().deleteTasks(["a", "b"]);
    expect(useAppStore.getState().tasks.map((t) => t.id)).toEqual(["c"]);
    expect(useAppStore.getState().tasks[0].deps).toEqual([]);

    useAppStore.getState().restoreTasks(removed);
    const byId = new Map(useAppStore.getState().tasks.map((t) => [t.id, t]));
    expect([...byId.keys()].sort()).toEqual(["a", "b", "c"]);
    // 这条是逐个 deleteTask 会漏掉的：b 对 a 的依赖
    expect(byId.get("b")!.deps).toEqual(["a"]);
    expect(byId.get("c")!.deps).toEqual(["b"]);
  });

  it("restores edges from survivors that pointed at the deleted tasks", async () => {
    const useAppStore = await freshStore();
    useAppStore.setState({ tasks: [task("a"), task("b", ["a"])] });

    const removed = useAppStore.getState().deleteTasks(["a"]);
    expect(useAppStore.getState().tasks[0].deps).toEqual([]);

    useAppStore.getState().restoreTasks(removed);
    const byId = new Map(useAppStore.getState().tasks.map((t) => [t.id, t]));
    expect(byId.get("b")!.deps).toEqual(["a"]);
  });

  it("ignores unknown ids and is a no-op when nothing matches", async () => {
    const useAppStore = await freshStore();
    useAppStore.setState({ tasks: [task("a")] });
    expect(useAppStore.getState().deleteTasks(["nope"])).toEqual([]);
    expect(useAppStore.getState().tasks).toHaveLength(1);
  });

  it("does not duplicate tasks when undo runs twice", async () => {
    const useAppStore = await freshStore();
    useAppStore.setState({ tasks: [task("a"), task("b", ["a"])] });
    const removed = useAppStore.getState().deleteTasks(["a"]);
    useAppStore.getState().restoreTasks(removed);
    useAppStore.getState().restoreTasks(removed);
    const tasks = useAppStore.getState().tasks;
    expect(tasks.filter((t) => t.id === "a")).toHaveLength(1);
    // 依赖边也只应该接回一条，不能因为撤销两次就变成 ["a", "a"]
    expect(tasks.find((t) => t.id === "b")!.deps).toEqual(["a"]);
  });
});
