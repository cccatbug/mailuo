import { Notification, type BrowserWindow } from "electron";
import { randomUUID } from "node:crypto";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { runScheduledJob } from "./pi";
import { SCHEDULED_TASKS_STORE } from "./scheduled-tasks-store";
import { safeSendToWindow } from "./window-lifecycle";
import type {
  ScheduledEventPayload,
  ScheduledJob,
  ScheduledRun,
} from "../src/shared/scheduled-tasks";

const TICK_MS = 30_000;
/** 超过触发时刻这么久仍未执行，视为错过（应用当时没在运行） */
const MISSED_GRACE_MS = 5 * 60_000;
/** 单轮执行超时 */
const RUN_TIMEOUT_MS = 10 * 60_000;

/**
 * 定时任务调度器（主进程单例）。
 * - 30s tick 扫描到期任务；多个到期任务串行执行，避免抢占模型并发。
 * - 触发时刻已过但超过宽限：记 missed，不补跑（Codex 同语义）。
 * - 窗口存在时推送事件；无论窗口是否在场都尝试系统通知。
 */
class ScheduledTaskScheduler {
  private getWindow: (() => BrowserWindow | null) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private ticking = false;
  private queued = new Set<string>();
  private processing: Promise<void> = Promise.resolve();
  private active: {
    runId: string;
    session: AgentSession | null;
    abortReason: "user" | "timeout" | null;
  } | null = null;

  initialize(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow;
  }

  start(): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.active?.session?.abort().catch(() => undefined);
  }

  /** 手动触发一轮执行（停用状态的任务也可手动跑） */
  async runNow(jobId: string): Promise<ScheduledRun> {
    const { jobs } = await SCHEDULED_TASKS_STORE.snapshot();
    const job = jobs.find((item) => item.id === jobId);
    if (!job) throw new Error("定时任务不存在或已被删除");
    if (this.queued.has(jobId)) throw new Error("该任务已在执行队列中，请稍候");
    const run = this.createRun(job, "manual");
    await SCHEDULED_TASKS_STORE.appendRun(run);
    this.emit({ type: "run", run });
    this.enqueue(job.id, () => this.execute(job, run));
    return run;
  }

  /** 取消正在执行的运行 */
  async cancel(runId: string): Promise<boolean> {
    const active = this.active;
    if (active?.runId !== runId || !active.session) return false;
    active.abortReason ??= "user";
    await active.session.abort().catch(() => undefined);
    return true;
  }

  private emit(event: ScheduledEventPayload): void {
    const win = this.getWindow?.();
    if (win) safeSendToWindow(win, "scheduled:event", event);
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const { jobs } = await SCHEDULED_TASKS_STORE.snapshot();
      const now = Date.now();
      for (const job of jobs) {
        if (!job.enabled || job.nextRunAt == null || now < job.nextRunAt) continue;
        if (this.queued.has(job.id)) continue;
        if (now - job.nextRunAt > MISSED_GRACE_MS) {
          await this.recordMissed(job);
        } else {
          const run = this.createRun(job, "schedule");
          await SCHEDULED_TASKS_STORE.appendRun(run);
          this.emit({ type: "run", run });
          this.enqueue(job.id, () => this.execute(job, run));
        }
      }
    } catch {
      /* tick 失败静默，下一轮重试 */
    } finally {
      this.ticking = false;
    }
  }

  private async recordMissed(job: ScheduledJob): Promise<void> {
    const run = this.createRun(job, "schedule");
    run.status = "missed";
    run.startedAt = job.nextRunAt ?? run.startedAt;
    run.finishedAt = run.startedAt;
    await SCHEDULED_TASKS_STORE.appendRun(run);
    await SCHEDULED_TASKS_STORE.touchAfterRun(job.id, "missed", Date.now());
    this.emit({ type: "run", run });
    this.emit({ type: "jobs-changed" });
  }

  private createRun(job: ScheduledJob, trigger: ScheduledRun["trigger"]): ScheduledRun {
    return {
      id: randomUUID(),
      jobId: job.id,
      projectId: job.projectId,
      jobName: job.name,
      startedAt: Date.now(),
      finishedAt: null,
      status: "running",
      trigger,
    };
  }

  private enqueue(jobId: string, task: () => Promise<void>): void {
    this.queued.add(jobId);
    this.processing = this.processing.then(task, task).then(
      () => undefined,
      () => undefined
    );
  }

  private async execute(job: ScheduledJob, run: ScheduledRun): Promise<void> {
    this.active = { runId: run.id, session: null, abortReason: null };
    let finalStatus: ScheduledRun["status"] = "error";
    const timeout = setTimeout(() => {
      const active = this.active;
      if (active?.runId === run.id && active.session) {
        active.abortReason ??= "timeout";
        void active.session.abort().catch(() => undefined);
      }
    }, RUN_TIMEOUT_MS);
    try {
      const result = await runScheduledJob(
        {
          projectId: job.projectId,
          prompt: job.prompt,
          modelOverride: job.modelOverride,
        },
        (session) => {
          if (this.active?.runId === run.id) this.active.session = session;
        }
      );
      finalStatus = "ok";
      const finished = await SCHEDULED_TASKS_STORE.patchRun(run.id, {
        status: "ok",
        finishedAt: Date.now(),
        resultMarkdown: result,
      });
      if (finished) this.emit({ type: "run", run: finished });
      this.notifyFinished(job, "ok", result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const abortReason =
        this.active?.runId === run.id ? this.active.abortReason : null;
      finalStatus = abortReason === "user" ? "cancelled" : "error";
      const errorMessage =
        abortReason === "user"
          ? "运行已取消"
          : abortReason === "timeout"
            ? `执行超时（超过 ${Math.round(RUN_TIMEOUT_MS / 60_000)} 分钟）`
            : message;
      const finished = await SCHEDULED_TASKS_STORE.patchRun(run.id, {
        status: finalStatus,
        finishedAt: Date.now(),
        error: errorMessage,
      });
      if (finished) this.emit({ type: "run", run: finished });
      this.notifyFinished(
        job,
        finalStatus === "cancelled" ? "cancelled" : "error",
        errorMessage
      );
    } finally {
      clearTimeout(timeout);
      this.queued.delete(job.id);
      if (this.active?.runId === run.id) this.active = null;
      await SCHEDULED_TASKS_STORE.touchAfterRun(job.id, finalStatus, Date.now()).catch(
        () => undefined
      );
      this.emit({ type: "jobs-changed" });
    }
  }

  private notifyFinished(
    job: ScheduledJob,
    status: "ok" | "error" | "cancelled",
    detail: string
  ): void {
    if (!Notification.isSupported()) return;
    const title =
      status === "ok"
        ? `定时任务完成 · ${job.name}`
        : status === "cancelled"
          ? `定时任务已取消 · ${job.name}`
          : `定时任务失败 · ${job.name}`;
    const body = detail.trim().replace(/\s+/g, " ").slice(0, 200) || "无更多信息";
    try {
      new Notification({ title, body, silent: status !== "error" }).show();
    } catch {
      /* 通知失败不影响主流程 */
    }
  }
}

export const SCHEDULED_TASKS_SCHEDULER = new ScheduledTaskScheduler();
