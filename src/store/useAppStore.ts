import { create } from "zustand";
import type { Priority, Project, Status, Task } from "@/types";
import { PROJECT_COLORS } from "@/types";
import { isBlocked, wouldCreateCycle } from "@/lib/deps";
import {
  priorityFromPosition,
  priorityFromQuadrant,
  type Quadrant,
} from "@/lib/quadrant";
import { loadPersisted, schedulePersist } from "@/lib/persist";
import { seedData } from "./seed";

export type ViewMode = "list" | "graph" | "stats" | "matrix";
export type Theme = "light" | "dark";
export type GraphDirection = "LR" | "TB";
export type StatusFilter = "all" | "todo" | "doing" | "done" | "blocked";

export interface AppSettings {
  /** 界面缩放（1 = 100%） */
  uiScale: number;
  /** 正文字体 */
  fontBody: "sans" | "serif";
  /** 标题字体 */
  fontHeading: "serif" | "sans";
}

const FONT_STACKS = {
  sans: `'Geist Variable', -apple-system, "PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", "Noto Sans SC", sans-serif`,
  serif: `"Songti SC", "STSong", "SimSun", "Noto Serif SC", "Source Han Serif SC", serif`,
} as const;

/** 把外观设置落到 DOM（缩放与字体族） */
function applyAppearance(s: AppSettings) {
  const root = document.documentElement;
  // zoom 在 WKWebView 与 WebView2 中均可用，等比缩放整个界面
  (document.body.style as CSSStyleDeclaration & { zoom?: string }).zoom =
    s.uiScale === 1 ? "" : String(s.uiScale);
  root.style.setProperty("--font-sans", FONT_STACKS[s.fontBody]);
  root.style.setProperty("--font-heading", FONT_STACKS[s.fontHeading]);
}

export type AiDialog =
  | { type: "plan"; projectId: string }
  | { type: "breakdown"; taskId: string }
  | { type: "suggestDeps"; projectId: string }
  | { type: "polish"; taskId: string };

/** 删除任务后的快照，用于「撤销」 */
export interface RemovedTask {
  task: Task;
  /** 删除时引用了它的下游任务 id */
  referencedBy: string[];
}

interface AppStore {
  loaded: boolean;
  projects: Project[];
  tasks: Task[];
  tagLibrary: string[];

  selectedProjectId: string | null;
  selectedTaskId: string | null;
  view: ViewMode;
  theme: Theme;
  graphDirection: GraphDirection;
  search: string;
  statusFilter: StatusFilter;
  commandOpen: boolean;
  settingsOpen: boolean;
  assistantOpen: boolean;
  /** 小枢呈现方式：右侧停靠面板 / 自由悬浮窗 */
  assistantMode: "dock" | "float";
  aiDialog: AiDialog | null;
  settings: AppSettings;
  panelLeft: boolean;
  panelRight: boolean;

  init: () => Promise<void>;
  setView: (v: ViewMode) => void;
  setTheme: (t: Theme) => void;
  setGraphDirection: (d: GraphDirection) => void;
  setSearch: (q: string) => void;
  setStatusFilter: (f: StatusFilter) => void;
  setCommandOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
  setAssistantOpen: (open: boolean) => void;
  setAssistantMode: (mode: "dock" | "float") => void;
  setAiDialog: (d: AiDialog | null) => void;
  setSettings: (patch: Partial<AppSettings>) => void;
  togglePanel: (side: "left" | "right") => void;
  /** 面板因拖拽折叠/展开时的状态回写（不触发命令式折叠） */
  setPanelOpen: (side: "left" | "right", open: boolean) => void;
  replaceData: (projects: Project[], tasks: Task[]) => void;
  selectProject: (id: string) => void;
  selectTask: (id: string | null) => void;

  addProject: (name: string, color?: string) => Project | null;
  renameProject: (id: string, name: string) => void;
  setProjectColor: (id: string, color: string) => void;
  setProjectIcon: (id: string, icon: string) => void;
  setProjectTags: (id: string, tags: string[]) => void;
  togglePinProject: (id: string) => void;
  toggleArchiveProject: (id: string) => void;
  duplicateProject: (id: string) => void;
  deleteProject: (id: string) => void;

  addTask: (title: string, patch?: Partial<Task>) => Task | null;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => RemovedTask | null;
  restoreTask: (removed: RemovedTask) => void;
  duplicateTask: (id: string) => Task | null;
  setStatus: (id: string, status: Status) => boolean;
  setPriority: (id: string, priority: Priority) => void;
  setQuadrant: (id: string, q: Quadrant) => void;
  /** 棋盘连续坐标（0..1），同步优先级 */
  setImportance: (id: string, importance: number, urgency: number) => void;
  addTagsToLibrary: (tags: string[]) => void;
  removeTagFromLibrary: (tag: string) => void;
  addTag: (id: string, tag: string) => void;
  removeTag: (id: string, tag: string) => void;
  addDep: (taskId: string, depId: string) => "ok" | "cycle" | "dup" | "invalid";
  removeDep: (taskId: string, depId: string) => void;
}

const uid = () => crypto.randomUUID();
const THEME_KEY = "mailuo-theme";
const SETTINGS_KEY = "mailuo-settings";
const PANELS_KEY = "mailuo-panels";

function loadPanels(): { left: boolean; right: boolean } {
  try {
    const raw = localStorage.getItem(PANELS_KEY);
    return raw ? { left: true, right: true, ...JSON.parse(raw) } : { left: true, right: true };
  } catch {
    return { left: true, right: true };
  }
}

const DEFAULT_SETTINGS: AppSettings = {
  uiScale: 1,
  fontBody: "sans",
  fontHeading: "serif",
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const stored = JSON.parse(raw) as Partial<AppSettings>;
    return {
      uiScale:
        typeof stored.uiScale === "number" ? stored.uiScale : DEFAULT_SETTINGS.uiScale,
      fontBody: stored.fontBody === "serif" ? "serif" : "sans",
      fontHeading: stored.fontHeading === "sans" ? "sans" : "serif",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(THEME_KEY, theme);
}

export const useAppStore = create<AppStore>((set, get) => {
  const commit = (patch: Partial<AppStore>) => {
    set(patch);
    const { projects, tasks, tagLibrary } = get();
    schedulePersist({ projects, tasks, tagLibrary });
  };

  return {
    loaded: false,
    projects: [],
    tasks: [],
    tagLibrary: [],
    selectedProjectId: null,
    selectedTaskId: null,
    view: "list",
    theme: "light",
    graphDirection: "LR",
    search: "",
    statusFilter: "all",
    commandOpen: false,
    settingsOpen: false,
    assistantOpen: false,
    assistantMode:
      (localStorage.getItem("mailuo-assistant-mode") as "dock" | "float") ??
      "dock",
    aiDialog: null,
    settings: DEFAULT_SETTINGS,
    panelLeft: localStorage.getItem("mailuo-panel-left") !== "false",
    panelRight: loadPanels().right,

    init: async () => {
      const theme =
        (localStorage.getItem(THEME_KEY) as Theme | null) ??
        (window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light");
      applyTheme(theme);
      applyAppearance(loadSettings());

      let data = await loadPersisted();
      const fresh = data === null;
      if (data === null) data = seedData();
      const tagLibrary =
        data.tagLibrary ??
        [
          ...new Set([
            ...data.tasks.flatMap((t) => t.tags ?? []),
            ...data.projects.flatMap((p) => p.tags ?? []),
          ]),
        ];
      set({
        loaded: true,
        theme,
        settings: loadSettings(),
        projects: data.projects,
        tasks: data.tasks,
        tagLibrary,
        selectedProjectId: data.projects[0]?.id ?? null,
      });
      if (fresh)
        schedulePersist({ projects: data.projects, tasks: data.tasks, tagLibrary });
    },

    setView: (view) => set({ view }),
    setTheme: (theme) => {
      applyTheme(theme);
      set({ theme });
    },
    setGraphDirection: (graphDirection) => set({ graphDirection }),
    setSearch: (search) => set({ search }),
    setStatusFilter: (statusFilter) => set({ statusFilter }),
    setCommandOpen: (commandOpen) => set({ commandOpen }),
    setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
    setAssistantOpen: (assistantOpen) => set({ assistantOpen }),
    setAssistantMode: (assistantMode) => {
      localStorage.setItem("mailuo-assistant-mode", assistantMode);
      set({ assistantMode });
    },
    setAiDialog: (aiDialog) => set({ aiDialog }),
    setSettings: (patch) => {
      const settings = { ...get().settings, ...patch };
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
      applyAppearance(settings);
      set({ settings });
    },
    replaceData: (projects, tasks) => {
      commit({
        projects,
        tasks,
        selectedProjectId: projects[0]?.id ?? null,
        selectedTaskId: null,
      });
    },
    togglePanel: (side) => {
      if (side === "left") {
        const next = !get().panelLeft;
        localStorage.setItem("mailuo-panel-left", String(next));
        set({ panelLeft: next });
      } else {
        set({ panelRight: !get().panelRight });
      }
    },
    setPanelOpen: (side, open) => {
      if (side === "left") set({ panelLeft: open });
      else set({ panelRight: open });
    },
    selectProject: (id) =>
      set({ selectedProjectId: id, selectedTaskId: null, search: "" }),
    // 选中任务时自动展开右栏（Obsidian 式：面板按需出现）
    selectTask: (id) =>
      set((s) => ({
        selectedTaskId: id,
        panelRight: id !== null ? true : s.panelRight,
      })),

    addProject: (name, color) => {
      const trimmed = name.trim();
      if (!trimmed) return null;
      const { projects } = get();
      const project: Project = {
        id: uid(),
        name: trimmed,
        color: color ?? PROJECT_COLORS[projects.length % PROJECT_COLORS.length],
        createdAt: Date.now(),
      };
      commit({
        projects: [...projects, project],
        selectedProjectId: project.id,
        selectedTaskId: null,
      });
      return project;
    },

    renameProject: (id, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      commit({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, name: trimmed } : p
        ),
      });
    },

    setProjectColor: (id, color) => {
      commit({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, color } : p
        ),
      });
    },

    setProjectIcon: (id, icon) => {
      commit({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, icon: icon || undefined } : p
        ),
      });
    },

    setProjectTags: (id, tags) => {
      get().addTagsToLibrary(tags);
      commit({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, tags: tags.length ? tags : undefined } : p
        ),
      });
    },

    togglePinProject: (id) => {
      commit({
        projects: get().projects.map((p) =>
          p.id === id ? { ...p, pinned: !p.pinned } : p
        ),
      });
    },

    toggleArchiveProject: (id) => {
      const { projects, selectedProjectId } = get();
      const target = projects.find((p) => p.id === id);
      if (!target) return;
      const next = projects.map((p) =>
        p.id === id ? { ...p, archived: !p.archived, pinned: false } : p
      );
      // 归档当前选中项目时，跳到第一个未归档项目
      const patch: Partial<AppStore> = { projects: next };
      if (!target.archived && selectedProjectId === id) {
        patch.selectedProjectId =
          next.find((p) => !p.archived)?.id ?? null;
        patch.selectedTaskId = null;
      }
      commit(patch);
    },

    duplicateProject: (id) => {
      const { projects, tasks } = get();
      const src = projects.find((p) => p.id === id);
      if (!src) return;
      const copy: Project = {
        ...src,
        id: uid(),
        name: `${src.name}（副本）`,
        pinned: false,
        archived: false,
        createdAt: Date.now(),
      };
      const idMap = new Map<string, string>();
      const srcTasks = tasks.filter((t) => t.projectId === id);
      srcTasks.forEach((t) => idMap.set(t.id, uid()));
      const copiedTasks: Task[] = srcTasks.map((t) => ({
        ...t,
        id: idMap.get(t.id)!,
        projectId: copy.id,
        deps: t.deps
          .map((d) => idMap.get(d))
          .filter((d): d is string => d !== undefined),
      }));
      commit({
        projects: [...projects, copy],
        tasks: [...tasks, ...copiedTasks],
        selectedProjectId: copy.id,
        selectedTaskId: null,
      });
    },

    deleteProject: (id) => {
      const { projects, tasks, selectedProjectId } = get();
      const rest = projects.filter((p) => p.id !== id);
      commit({
        projects: rest,
        tasks: tasks.filter((t) => t.projectId !== id),
        selectedProjectId:
          selectedProjectId === id ? (rest[0]?.id ?? null) : selectedProjectId,
        selectedTaskId: null,
      });
    },

    addTask: (title, patch) => {
      const trimmed = title.trim();
      const { selectedProjectId, tasks } = get();
      if (!trimmed || !selectedProjectId) return null;
      const task: Task = {
        id: uid(),
        projectId: selectedProjectId,
        title: trimmed,
        notes: "",
        status: "todo",
        priority: "normal",
        dueDate: null,
        tags: [],
        deps: [],
        createdAt: Date.now(),
        completedAt: null,
        ...patch,
      };
      commit({ tasks: [...tasks, task], selectedTaskId: task.id });
      return task;
    },

    updateTask: (id, patch) => {
      commit({
        tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      });
    },

    deleteTask: (id) => {
      const { tasks, selectedTaskId } = get();
      const task = tasks.find((t) => t.id === id);
      if (!task) return null;
      const referencedBy = tasks
        .filter((t) => t.deps.includes(id))
        .map((t) => t.id);
      commit({
        tasks: tasks
          .filter((t) => t.id !== id)
          .map((t) =>
            t.deps.includes(id)
              ? { ...t, deps: t.deps.filter((d) => d !== id) }
              : t
          ),
        selectedTaskId: selectedTaskId === id ? null : selectedTaskId,
      });
      return { task, referencedBy };
    },

    restoreTask: (removed) => {
      const { tasks } = get();
      const refs = new Set(removed.referencedBy);
      commit({
        tasks: [
          ...tasks.map((t) =>
            refs.has(t.id) ? { ...t, deps: [...t.deps, removed.task.id] } : t
          ),
          removed.task,
        ],
        selectedTaskId: removed.task.id,
      });
    },

    duplicateTask: (id) => {
      const { tasks } = get();
      const src = tasks.find((t) => t.id === id);
      if (!src) return null;
      const copy: Task = {
        ...src,
        id: uid(),
        title: `${src.title}（副本）`,
        status: "todo",
        createdAt: Date.now(),
        completedAt: null,
      };
      commit({ tasks: [...tasks, copy], selectedTaskId: copy.id });
      return copy;
    },

    setStatus: (id, status) => {
      const { tasks } = get();
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const task = byId.get(id);
      if (!task) return false;
      // 受阻任务不可直接完成
      if (status === "done" && isBlocked(task, byId)) return false;
      commit({
        tasks: tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                status,
                completedAt: status === "done" ? Date.now() : null,
              }
            : t
        ),
      });
      return true;
    },

    setPriority: (id, priority) => {
      commit({
        tasks: get().tasks.map((t) => (t.id === id ? { ...t, priority } : t)),
      });
    },

    setQuadrant: (id, q) => {
      const importance = q.important ? 0.75 : 0.25;
      const urgency = q.urgent ? 0.75 : 0.25;
      commit({
        tasks: get().tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                important: q.important,
                urgent: q.urgent,
                importance,
                urgency,
                priority: priorityFromQuadrant(q),
              }
            : t
        ),
      });
    },

    setImportance: (id, importance, urgency) => {
      const clamp = (n: number) => Math.min(1, Math.max(0, n));
      const imp = clamp(importance);
      const urg = clamp(urgency);
      commit({
        tasks: get().tasks.map((t) =>
          t.id === id
            ? {
                ...t,
                importance: imp,
                urgency: urg,
                important: imp >= 0.5,
                urgent: urg >= 0.5,
                priority: priorityFromPosition(imp, urg),
              }
            : t
        ),
      });
    },

    addTagsToLibrary: (tags) => {
      const clean = tags.map((t) => t.trim()).filter(Boolean);
      const next = [...new Set([...get().tagLibrary, ...clean])];
      if (next.length !== get().tagLibrary.length) commit({ tagLibrary: next });
    },

    removeTagFromLibrary: (tag) => {
      commit({ tagLibrary: get().tagLibrary.filter((t) => t !== tag) });
    },

    addTag: (id, tag) => {
      const trimmed = tag.trim();
      if (!trimmed) return;
      get().addTagsToLibrary([trimmed]);
      commit({
        tasks: get().tasks.map((t) =>
          t.id === id && !t.tags.includes(trimmed)
            ? { ...t, tags: [...t.tags, trimmed] }
            : t
        ),
      });
    },

    removeTag: (id, tag) => {
      commit({
        tasks: get().tasks.map((t) =>
          t.id === id ? { ...t, tags: t.tags.filter((x) => x !== tag) } : t
        ),
      });
    },

    addDep: (taskId, depId) => {
      const { tasks } = get();
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const task = byId.get(taskId);
      const dep = byId.get(depId);
      if (!task || !dep || task.projectId !== dep.projectId) return "invalid";
      if (task.deps.includes(depId)) return "dup";
      if (wouldCreateCycle(taskId, depId, byId)) return "cycle";
      commit({
        tasks: tasks.map((t) =>
          t.id === taskId ? { ...t, deps: [...t.deps, depId] } : t
        ),
      });
      return "ok";
    },

    removeDep: (taskId, depId) => {
      commit({
        tasks: get().tasks.map((t) =>
          t.id === taskId
            ? { ...t, deps: t.deps.filter((d) => d !== depId) }
            : t
        ),
      });
    },
  };
});
