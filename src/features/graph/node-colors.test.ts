import { describe, expect, it } from "vitest";
import type { Task } from "@/types";
import { assignTaskColorSlots } from "./node-colors";

function task(id: string, createdAt: number, deps: string[] = []): Task {
  return {
    id,
    projectId: "project",
    title: id,
    notes: "",
    status: "todo",
    priority: "normal",
    dueDate: null,
    tags: [],
    deps,
    createdAt,
    completedAt: null,
  };
}

describe("assignTaskColorSlots", () => {
  it("is deterministic regardless of input order", () => {
    const tasks = [task("beta", 2, ["alpha"]), task("alpha", 1)];

    expect(assignTaskColorSlots(tasks)).toEqual(
      assignTaskColorSlots([...tasks].reverse())
    );
  });

  it("keeps directly connected tasks on different color slots", () => {
    const tasks = [
      task("one", 1),
      task("two", 2, ["one"]),
      task("three", 3, ["two"]),
    ];
    const colors = assignTaskColorSlots(tasks);

    expect(colors.get("one")).not.toBe(colors.get("two"));
    expect(colors.get("two")).not.toBe(colors.get("three"));
    expect([...colors.values()].every((slot) => slot >= 0 && slot < 24)).toBe(
      true
    );
  });

  it("uses a distinct slot for every task until the 24-slot palette is full", () => {
    const colors = assignTaskColorSlots(
      Array.from({ length: 20 }, (_, index) =>
        task(`task-${index}`, index)
      )
    );

    expect(new Set(colors.values())).toHaveLength(20);
  });
});
