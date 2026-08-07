import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project, Task } from "@/types";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  }),
}));

function stubStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  });
}

function project(id: string, name: string): Project {
  return { id, name, color: "#123456", createdAt: 1 };
}

function task(
  id: string,
  title: string,
  projectId = "p1",
  patch: Partial<Task> = {}
): Task {
  return {
    id,
    projectId,
    title,
    notes: "",
    status: "todo",
    priority: "normal",
    dueDate: null,
    tags: [],
    deps: [],
    createdAt: new Date(2026, 7, 7, 1).getTime(),
    completedAt: null,
    tracking: { type: "standard" },
    schedule: { type: "none" },
    ...patch,
  };
}

async function setup(tasks: Task[] = []) {
  vi.resetModules();
  stubStorage();
  const [{ useAppStore }, { runTaskCommand }] = await Promise.all([
    import("@/store/useAppStore"),
    import("./taskCommands"),
  ]);
  useAppStore.setState({
    loaded: true,
    // 单测不需要真的落盘，避免防抖定时器越过用例边界。
    loadError: "test",
    projects: [project("p1", "当前"), project("p2", "另一个")],
    tasks,
    tagLibrary: [],
    selectedProjectId: "p1",
    selectedTaskId: tasks[0]?.id ?? null,
  });
  const run = (
    action: Parameters<typeof runTaskCommand>[0]["action"],
    payload: Record<string, unknown>
  ) => runTaskCommand({ requestId: "test", action, payload });
  return { useAppStore, run };
}

describe("runTaskCommand", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("creates a recurring task chain in another project without switching the workspace", async () => {
    const { useAppStore, run } = await setup([task("old", "原任务")]);
    const result = run("create_tasks", {
      projectId: "另一个",
      tasks: [
        {
          title: "整理资料",
          tags: ["整理", "资料"],
          schedule: {
            kind: "recurring",
            start: "2026-08-01",
            due: "2026-08-02",
            unit: "day",
            interval: 2,
          },
        },
        { title: "提交周报", dependsOn: ["整理资料"] },
      ],
    }) as { created: { id: string; title: string }[] };

    expect(result.created).toHaveLength(2);
    const state = useAppStore.getState();
    expect(state.selectedProjectId).toBe("p1");
    expect(state.selectedTaskId).toBe("old");
    const created = state.tasks.filter((entry) => entry.projectId === "p2");
    const source = created.find((entry) => entry.title === "整理资料")!;
    const target = created.find((entry) => entry.title === "提交周报")!;
    expect(source).toMatchObject({
      dueDate: "2026-08-03",
      schedule: { type: "recurring", due: "2026-08-03" },
      tags: ["整理", "资料"],
    });
    expect(target.deps).toEqual([source.id]);
  });

  it("completes one recurring round and advances to the next occurrence", async () => {
    const recurring = task("repeat", "隔天复盘", "p1", {
      dueDate: "2026-08-07",
      schedule: {
        type: "recurring",
        start: "2026-08-01",
        due: "2026-08-07",
        rule: { unit: "day", interval: 2, weekdays: [], monthDay: 0 },
        doneCount: 0,
        lastDone: null,
        until: null,
      },
    });
    const { useAppStore, run } = await setup([recurring]);

    run("update_tasks", { updates: [{ task: "repeat", status: "done" }] });

    expect(useAppStore.getState().tasks[0]).toMatchObject({
      status: "todo",
      dueDate: "2026-08-09",
      schedule: { type: "recurring", due: "2026-08-09", doneCount: 1 },
    });
  });

  it("refuses an ambiguous title instead of modifying the wrong project", async () => {
    const { useAppStore, run } = await setup([
      task("a", "同名任务", "p1"),
      task("b", "同名任务", "p2"),
    ]);

    const result = run("update_tasks", {
      updates: [{ task: "同名任务", priority: "high" }],
    }) as { applied: string[]; skipped: string[] };

    expect(result.applied).toEqual([]);
    expect(result.skipped[0]).toContain("找不到任务");
    expect(useAppStore.getState().tasks.every((entry) => entry.priority === "normal")).toBe(true);
  });

  it("keeps overdue tasks out of the one-week-ahead filter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 7, 12));
    const { run } = await setup([
      task("past", "已逾期", "p1", {
        dueDate: "2026-08-01",
        schedule: { type: "once", start: null, due: "2026-08-01" },
      }),
      task("future", "即将到期", "p1", {
        dueDate: "2026-08-10",
        schedule: { type: "once", start: null, due: "2026-08-10" },
      }),
    ]);

    const result = run("list_tasks", { status: "week" }) as {
      tasks: { id: string }[];
    };
    expect(result.tasks.map((entry) => entry.id)).toEqual(["future"]);
  });

  it("does not silently fall back to the current project for an unknown target", async () => {
    const { run } = await setup();
    expect(() =>
      run("create_tasks", {
        projectId: "不存在",
        tasks: [{ title: "不应创建" }],
      })
    ).toThrow("找不到项目");
  });

  it("refuses a recurring progress task instead of creating inconsistent state", async () => {
    const { useAppStore, run } = await setup();
    const result = run("create_tasks", {
      tasks: [
        {
          title: "每天读十页",
          tracking: { kind: "progress", target: 100, unit: "页" },
          schedule: {
            kind: "recurring",
            due: "2026-08-08",
            unit: "day",
            interval: 1,
          },
        },
      ],
    }) as { created: unknown[]; failed: string[] };

    expect(result.created).toEqual([]);
    expect(result.failed[0]).toContain("不能叠加定期轮次");
    expect(useAppStore.getState().tasks).toEqual([]);
  });

  it("keeps the current due date when a recurring task becomes a progress task", async () => {
    const recurring = task("repeat-progress", "阅读计划", "p1", {
      dueDate: "2026-08-09",
      schedule: {
        type: "recurring",
        start: "2026-08-01",
        due: "2026-08-09",
        rule: { unit: "day", interval: 2, weekdays: [], monthDay: 0 },
        doneCount: 0,
        lastDone: null,
        until: null,
      },
    });
    const { useAppStore, run } = await setup([recurring]);

    run("update_tasks", {
      updates: [
        {
          task: "repeat-progress",
          tracking: { kind: "progress", current: 10, target: 100, unit: "页" },
        },
      ],
    });

    expect(useAppStore.getState().tasks[0]).toMatchObject({
      dueDate: "2026-08-09",
      schedule: { type: "once", start: "2026-08-01", due: "2026-08-09" },
      tracking: { type: "progress", current: 10, target: 100, unit: "页" },
    });
  });
});
