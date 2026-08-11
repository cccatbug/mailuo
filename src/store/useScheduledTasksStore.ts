import { create } from "zustand";
import { bridge } from "@/lib/bridge";
import {
  upsertScheduledRun,
  type SaveScheduledJobInput,
  type ScheduledEventPayload,
  type ScheduledJob,
  type ScheduledRun,
} from "@/shared/scheduled-tasks";

interface ScheduledTasksState {
  loaded: boolean;
  loading: boolean;
  error: string | null;
  jobs: ScheduledJob[];
  runs: ScheduledRun[];
  /** 面板按项目过滤（从项目右键进入时设置） */
  filterProjectId: string | null;
  load: () => Promise<void>;
  setFilterProject: (projectId: string | null) => void;
  save: (input: SaveScheduledJobInput) => Promise<ScheduledJob>;
  remove: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  runNow: (id: string) => Promise<ScheduledRun>;
  cancelRun: (runId: string) => Promise<void>;
  applyEvent: (event: ScheduledEventPayload) => void;
}

export const useScheduledTasksStore = create<ScheduledTasksState>((set, get) => ({
  loaded: false,
  loading: false,
  error: null,
  jobs: [],
  runs: [],
  filterProjectId: null,

  load: async () => {
    if (!bridge) {
      set({ loaded: true, error: "定时任务需要桌面环境" });
      return;
    }
    if (get().loading) return;
    set({ loading: true });
    try {
      const snapshot = await bridge.scheduledList();
      set({
        loaded: true,
        loading: false,
        error: null,
        jobs: snapshot.jobs,
        runs: snapshot.runs,
      });
    } catch (error) {
      set({
        loaded: true,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  setFilterProject: (projectId) => set({ filterProjectId: projectId }),

  save: async (input) => {
    if (!bridge) throw new Error("定时任务需要桌面环境");
    const job = await bridge.scheduledSave(input);
    set((state) => ({
      jobs: state.jobs.some((item) => item.id === job.id)
        ? state.jobs.map((item) => (item.id === job.id ? job : item))
        : [...state.jobs, job],
    }));
    return job;
  },

  remove: async (id) => {
    if (!bridge) throw new Error("定时任务需要桌面环境");
    await bridge.scheduledDelete(id);
    set((state) => ({
      jobs: state.jobs.filter((item) => item.id !== id),
      runs: state.runs.filter((run) => run.jobId !== id),
    }));
  },

  setEnabled: async (id, enabled) => {
    if (!bridge) throw new Error("定时任务需要桌面环境");
    const job = await bridge.scheduledToggle(id, enabled);
    set((state) => ({
      jobs: state.jobs.map((item) => (item.id === id ? job : item)),
    }));
  },

  runNow: async (id) => {
    if (!bridge) throw new Error("定时任务需要桌面环境");
    const run = await bridge.scheduledRunNow(id);
    // 主进程会同时通过 scheduled:event 推送同一条 run，用 upsert 避免重复行
    set((state) => ({ runs: upsertScheduledRun(state.runs, run) }));
    return run;
  },

  cancelRun: async (runId) => {
    if (!bridge) throw new Error("定时任务需要桌面环境");
    await bridge.scheduledCancel(runId);
  },

  applyEvent: (event) => {
    if (event.type === "jobs-changed") {
      void get().load();
      return;
    }
    set((state) => ({ runs: upsertScheduledRun(state.runs, event.run) }));
  },
}));
