import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { MAILUO_HOME } from "./pi";
import {
  computeNextRunAt,
  saveScheduledJobInputSchema,
  scheduledJobSchema,
  scheduledRunSchema,
  type SaveScheduledJobInput,
  type ScheduledJob,
  type ScheduledRun,
  type ScheduledRunStatus,
  type ScheduledTasksSnapshot,
} from "../src/shared/scheduled-tasks";

/** 每个任务保留的运行历史条数 */
const RUNS_PER_JOB = 20;
/** 结果 Markdown 上限，避免大输出撑爆持久化文件 */
const RESULT_MARKDOWN_LIMIT = 120_000;

interface ScheduledTasksDocument {
  version: 1;
  jobs: ScheduledJob[];
  runs: ScheduledRun[];
}

function validDocument(value: unknown): value is ScheduledTasksDocument {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ScheduledTasksDocument>;
  return (
    candidate.version === 1 &&
    Array.isArray(candidate.jobs) &&
    Array.isArray(candidate.runs)
  );
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`
  );
  try {
    await fs.writeFile(temp, content, { encoding: "utf8", mode: 0o600 });
    await fs.rename(temp, file);
  } catch (error) {
    await fs.unlink(temp).catch(() => undefined);
    throw error;
  }
}

export class ScheduledTasksStore {
  private document: ScheduledTasksDocument | null = null;
  private operation = Promise.resolve<unknown>(undefined);

  readonly filePath = path.join(MAILUO_HOME, "scheduled-tasks-v1.json");

  snapshot(): Promise<ScheduledTasksSnapshot> {
    return this.run(async () => {
      const document = await this.load();
      return structuredClone({ jobs: document.jobs, runs: document.runs });
    });
  }

  saveJob(input: SaveScheduledJobInput): Promise<ScheduledJob> {
    return this.run(async () => {
      const parsed = saveScheduledJobInputSchema.parse(input);
      const document = await this.load();
      const now = Date.now();
      const base = parsed.id
        ? document.jobs.find((job) => job.id === parsed.id)
        : undefined;
      if (parsed.id && !base) throw new Error("定时任务不存在或已被删除");
      const job: ScheduledJob = {
        id: base?.id ?? randomUUID(),
        projectId: parsed.projectId,
        name: parsed.name.trim(),
        prompt: parsed.prompt.trim(),
        schedule: parsed.schedule,
        enabled: parsed.enabled,
        modelOverride: parsed.modelOverride ?? null,
        createdAt: base?.createdAt ?? now,
        updatedAt: now,
        lastRunAt: base?.lastRunAt ?? null,
        lastStatus: base?.lastStatus ?? null,
        nextRunAt: parsed.enabled
          ? computeNextRunAt(parsed.schedule, new Date(now))
          : null,
      };
      scheduledJobSchema.parse(job);
      document.jobs = base
        ? document.jobs.map((existing) => (existing.id === job.id ? job : existing))
        : [...document.jobs, job];
      await this.persist(document);
      return structuredClone(job);
    });
  }

  deleteJob(id: string): Promise<void> {
    return this.run(async () => {
      const document = await this.load();
      document.jobs = document.jobs.filter((job) => job.id !== id);
      document.runs = document.runs.filter((run) => run.jobId !== id);
      await this.persist(document);
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<ScheduledJob> {
    return this.run(async () => {
      const document = await this.load();
      const job = document.jobs.find((item) => item.id === id);
      if (!job) throw new Error("定时任务不存在或已被删除");
      job.enabled = enabled;
      job.updatedAt = Date.now();
      job.nextRunAt = enabled ? computeNextRunAt(job.schedule) : null;
      await this.persist(document);
      return structuredClone(job);
    });
  }

  /** 一轮运行结束后刷新 job 的状态与下次触发时间 */
  touchAfterRun(id: string, status: ScheduledRunStatus, at: number): Promise<void> {
    return this.run(async () => {
      const document = await this.load();
      const job = document.jobs.find((item) => item.id === id);
      if (!job) return;
      job.lastRunAt = at;
      job.lastStatus = status;
      job.nextRunAt = job.enabled ? computeNextRunAt(job.schedule, new Date(at)) : null;
      await this.persist(document);
    });
  }

  appendRun(run: ScheduledRun): Promise<void> {
    return this.run(async () => {
      const document = await this.load();
      scheduledRunSchema.parse(run);
      document.runs = [...document.runs, structuredClone(run)];
      this.trimRuns(document);
      await this.persist(document);
    });
  }

  patchRun(
    runId: string,
    patch: {
      status: ScheduledRun["status"];
      finishedAt: number | null;
      resultMarkdown?: string;
      error?: string;
    }
  ): Promise<ScheduledRun | null> {
    return this.run(async () => {
      const document = await this.load();
      const run = document.runs.find((item) => item.id === runId);
      if (!run) return null;
      run.status = patch.status;
      run.finishedAt = patch.finishedAt;
      if (patch.resultMarkdown !== undefined) {
        run.resultMarkdown = patch.resultMarkdown.slice(0, RESULT_MARKDOWN_LIMIT);
      }
      if (patch.error !== undefined) run.error = patch.error.slice(0, 2000);
      await this.persist(document);
      return structuredClone(run);
    });
  }

  /** 按 job 维度裁剪历史，只保留最近 RUNS_PER_JOB 条 */
  private trimRuns(document: ScheduledTasksDocument): void {
    const counts = new Map<string, number>();
    const kept: ScheduledRun[] = [];
    for (let i = document.runs.length - 1; i >= 0; i--) {
      const run = document.runs[i];
      const count = counts.get(run.jobId) ?? 0;
      if (count < RUNS_PER_JOB) {
        counts.set(run.jobId, count + 1);
        kept.unshift(run);
      }
    }
    document.runs = kept;
  }

  private async load(): Promise<ScheduledTasksDocument> {
    if (this.document) return this.document;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as unknown;
      if (validDocument(parsed)) {
        // 逐条校验：损坏的条目只丢弃该条，不拖垮整体
        parsed.jobs = parsed.jobs.filter(
          (job) => scheduledJobSchema.safeParse(job).success
        );
        parsed.runs = parsed.runs.filter(
          (run) => scheduledRunSchema.safeParse(run).success
        );
        this.document = parsed;
      } else {
        this.document = { version: 1, jobs: [], runs: [] };
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      this.document = { version: 1, jobs: [], runs: [] };
    }
    return this.document;
  }

  private async persist(document: ScheduledTasksDocument): Promise<void> {
    this.document = document;
    await atomicWrite(this.filePath, JSON.stringify(document, null, 2));
  }

  private run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.operation.then(action, action);
    this.operation = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

export const SCHEDULED_TASKS_STORE = new ScheduledTasksStore();
