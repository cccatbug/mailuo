import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import {
  normalizeTaskTracking,
  reconcileTrackedTaskStatuses,
  taskTrackingSnapshot,
  updateTaskTracking,
} from "./task-tracking";

function task(patch: Partial<Task> = {}): Task {
  return {
    id: "task",
    projectId: "project",
    title: "阅读",
    notes: "",
    status: "todo",
    priority: "normal",
    dueDate: null,
    tags: [],
    deps: [],
    createdAt: 1,
    completedAt: null,
    tracking: { type: "standard" },
    ...patch,
  };
}

describe("task tracking", () => {
  it("normalizes legacy and malformed tracking data", () => {
    expect(normalizeTaskTracking(undefined)).toEqual({ type: "standard" });
    expect(
      normalizeTaskTracking({
        type: "progress",
        current: 3,
        target: 2.5,
        unit: " 页 ",
      })
    ).toEqual({ type: "progress", current: 2.5, target: 2.5, unit: "页" });
  });

  it("derives progress completion and reopens when progress decreases", () => {
    const progress = updateTaskTracking(task(), {
      type: "set-type",
      taskType: "progress",
    });
    const done = updateTaskTracking(progress, {
      type: "set-progress",
      current: 100,
    });
    expect(done.status).toBe("done");
    expect(taskTrackingSnapshot(done).summary).toBe("100/100 %");

    const reopened = updateTaskTracking(done, {
      type: "set-progress",
      current: 40,
    });
    expect(reopened.status).toBe("doing");
    expect(reopened.completedAt).toBeNull();
  });

  it("allows one check-in per cadence period and calculates streaks", () => {
    const today = new Date(2026, 7, 5, 12);
    const habit = task({
      tracking: {
        type: "checkin",
        cadence: "daily",
        target: 30,
        records: ["2026-08-03", "2026-08-04"],
      },
    });
    const checked = updateTaskTracking(habit, { type: "toggle-checkin" }, today);
    expect(taskTrackingSnapshot(checked, today)).toMatchObject({
      current: 3,
      streak: 3,
      checkedInCurrentPeriod: true,
    });

    const undone = updateTaskTracking(checked, { type: "toggle-checkin" }, today);
    expect(taskTrackingSnapshot(undone, today)).toMatchObject({
      current: 2,
      streak: 2,
      checkedInCurrentPeriod: false,
    });

    const monthly = task({
      tracking: {
        type: "checkin",
        cadence: "monthly",
        target: 12,
        records: ["2026-07"],
      },
    });
    const checkedMonth = updateTaskTracking(
      monthly,
      { type: "toggle-checkin" },
      today
    );
    expect(taskTrackingSnapshot(checkedMonth, today)).toMatchObject({
      current: 2,
      streak: 2,
      currentPeriodLabel: "本月",
    });
  });

  it("completes reached tracked tasks after dependencies settle", () => {
    const dependency = task({ id: "dependency", status: "todo" });
    const progress = task({
      id: "progress",
      deps: [dependency.id],
      status: "done",
      tracking: { type: "progress", current: 10, target: 10, unit: "页" },
    });
    const initiallyBlocked = reconcileTrackedTaskStatuses([dependency, progress]);
    expect(initiallyBlocked[1].status).toBe("doing");

    const settled = reconcileTrackedTaskStatuses([
      { ...dependency, status: "done", completedAt: 2 },
      initiallyBlocked[1],
    ]);
    expect(settled[1].status).toBe("done");

    const missingDependency = reconcileTrackedTaskStatuses([
      { ...progress, deps: ["removed-task"] },
    ]);
    expect(missingDependency[0].status).toBe("done");
  });
});
