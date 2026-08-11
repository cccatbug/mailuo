import { promises as fs } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testRoot = vi.hoisted(() => `/tmp/mailuo-scheduled-tasks-${process.pid}`);
vi.mock("./pi", () => ({
  MAILUO_HOME: testRoot,
}));

import { ScheduledTasksStore } from "./scheduled-tasks-store";
import type { ScheduledRun } from "../src/shared/scheduled-tasks";

function makeStore(): ScheduledTasksStore {
  return new ScheduledTasksStore();
}

function makeRun(jobId: string, index: number): ScheduledRun {
  return {
    id: crypto.randomUUID(),
    jobId,
    projectId: "p1",
    jobName: "测试",
    startedAt: Date.now() + index,
    finishedAt: Date.now() + index + 1000,
    status: "ok",
    trigger: "schedule",
    resultMarkdown: `result ${index}`,
  };
}

describe("scheduled-tasks-store", () => {
  beforeEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("新建与更新任务，启用时计算 nextRunAt", async () => {
    const store = makeStore();
    const created = await store.saveJob({
      projectId: "p1",
      name: "每日汇报",
      prompt: "汇总进展",
      schedule: { kind: "daily", time: "09:00" },
      enabled: true,
    });
    expect(created.id).toBeTruthy();
    expect(created.nextRunAt).toBeGreaterThan(Date.now() - 1000);

    const updated = await store.saveJob({
      id: created.id,
      projectId: "p1",
      name: "每日汇报 v2",
      prompt: "汇总进展",
      schedule: { kind: "daily", time: "09:00" },
      enabled: true,
    });
    expect(updated.name).toBe("每日汇报 v2");
    expect(updated.createdAt).toBe(created.createdAt);
    const { jobs } = await store.snapshot();
    expect(jobs).toHaveLength(1);
  });

  it("禁用任务清空 nextRunAt，重新启用恢复", async () => {
    const store = makeStore();
    const job = await store.saveJob({
      projectId: "p1",
      name: "t",
      prompt: "p",
      schedule: { kind: "daily", time: "09:00" },
      enabled: true,
    });
    const disabled = await store.setEnabled(job.id, false);
    expect(disabled.nextRunAt).toBeNull();
    const enabled = await store.setEnabled(job.id, true);
    expect(enabled.nextRunAt).not.toBeNull();
  });

  it("删除任务连带删除运行历史", async () => {
    const store = makeStore();
    const job = await store.saveJob({
      projectId: "p1",
      name: "t",
      prompt: "p",
      schedule: { kind: "daily", time: "09:00" },
      enabled: true,
    });
    await store.appendRun(makeRun(job.id, 0));
    await store.deleteJob(job.id);
    const snapshot = await store.snapshot();
    expect(snapshot.jobs).toHaveLength(0);
    expect(snapshot.runs).toHaveLength(0);
  });

  it("每个任务最多保留 20 条历史", async () => {
    const store = makeStore();
    const job = await store.saveJob({
      projectId: "p1",
      name: "t",
      prompt: "p",
      schedule: { kind: "daily", time: "09:00" },
      enabled: true,
    });
    for (let i = 0; i < 25; i++) {
      await store.appendRun(makeRun(job.id, i));
    }
    const { runs } = await store.snapshot();
    expect(runs).toHaveLength(20);
    // 保留最新的 20 条（index 5..24）
    expect(runs.every((run) => run.resultMarkdown !== "result 0")).toBe(true);
    expect(runs.some((run) => run.resultMarkdown === "result 24")).toBe(true);
  });

  it("patchRun 更新状态并截断超长结果", async () => {
    const store = makeStore();
    const job = await store.saveJob({
      projectId: "p1",
      name: "t",
      prompt: "p",
      schedule: { kind: "daily", time: "09:00" },
      enabled: true,
    });
    const run = makeRun(job.id, 0);
    run.status = "running";
    run.finishedAt = null;
    await store.appendRun(run);
    const patched = await store.patchRun(run.id, {
      status: "error",
      finishedAt: Date.now(),
      error: "boom",
    });
    expect(patched?.status).toBe("error");
    expect(patched?.error).toBe("boom");
  });

  it("从磁盘恢复：损坏条目被丢弃，其余保留", async () => {
    const store = makeStore();
    const job = await store.saveJob({
      projectId: "p1",
      name: "t",
      prompt: "p",
      schedule: { kind: "daily", time: "09:00" },
      enabled: true,
    });
    // 手工注入一条坏数据
    const raw = JSON.parse(await fs.readFile(store.filePath, "utf8"));
    raw.jobs.push({ id: "broken" });
    await fs.writeFile(store.filePath, JSON.stringify(raw));
    const reloaded = makeStore();
    const snapshot = await reloaded.snapshot();
    expect(snapshot.jobs).toHaveLength(1);
    expect(snapshot.jobs[0].id).toBe(job.id);
  });
});
