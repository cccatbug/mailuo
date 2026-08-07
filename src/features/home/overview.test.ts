import { afterEach, describe, expect, it, vi } from "vitest";
import type { Task } from "@/types";
import { buildOverview } from "./overview";

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    projectId: "p1",
    title: id,
    notes: "",
    status: "todo",
    priority: "normal",
    dueDate: null,
    schedule: { type: "none" },
    tags: [],
    deps: [],
    createdAt: new Date(2026, 7, 1, 12).getTime(),
    completedAt: null,
    tracking: { type: "standard" },
    ...patch,
  };
}

describe("buildOverview", () => {
  afterEach(() => vi.useRealTimers());

  it("builds today buckets and focus order without surfacing blocked work", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 7, 12));
    const tasks = [
      task("overdue", {
        priority: "high",
        dueDate: "2026-08-01",
        schedule: { type: "once", start: null, due: "2026-08-01" },
      }),
      task("today", {
        dueDate: "2026-08-07",
        schedule: { type: "once", start: null, due: "2026-08-07" },
      }),
      task("checkin", {
        status: "doing",
        tracking: { type: "checkin", cadence: "daily", target: 30, records: [] },
      }),
      task("prerequisite"),
      task("blocked", { priority: "high", deps: ["prerequisite"] }),
      task("ready", { priority: "high" }),
      task("done", {
        status: "done",
        completedAt: new Date(2026, 7, 6, 12).getTime(),
      }),
    ];
    const overview = buildOverview(
      tasks,
      new Map(tasks.map((entry) => [entry.id, entry])),
      "2026-08-07"
    );

    expect(overview.buckets.overdue.map((entry) => entry.id)).toEqual(["overdue"]);
    expect(overview.buckets.today.map((entry) => entry.id)).toEqual(["today"]);
    expect(overview.buckets.checkinPending.map((entry) => entry.id)).toEqual([
      "checkin",
    ]);
    expect(overview.buckets.blocked.map((entry) => entry.id)).toEqual(["blocked"]);
    expect(overview.focus.map((entry) => entry.id)).toEqual([
      "overdue",
      "today",
      "checkin",
      "ready",
    ]);
    expect(overview.completedThisWeek).toBe(1);
  });

  it("keeps tasks before their start date out of today's focus", () => {
    const future = task("future", {
      priority: "high",
      dueDate: "2026-08-20",
      schedule: {
        type: "once",
        start: "2026-08-10",
        due: "2026-08-20",
      },
    });
    const overview = buildOverview(
      [future],
      new Map([[future.id, future]]),
      "2026-08-07"
    );
    expect(overview.focus).toEqual([]);
  });
});
