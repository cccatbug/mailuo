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
import {
  migrateThemePreference,
  resolveThemeMode,
  type Theme,
  type ThemeMode,
  type ThemePalette,
} from "@/lib/theme";
import type { AssistantPermissionMode } from "@/shared/assistant";
import { quoteFontFamily } from "@/lib/system-fonts";
import {
  normalizeTaskTracking,
  reconcileTrackedTaskStatuses,
  updateTaskTracking,
  type TaskTrackingAction,
} from "@/lib/task-tracking";

export type ViewMode = "list" | "graph" | "stats" | "matrix";
export type { Theme, ThemeMode, ThemePalette } from "@/lib/theme";
export type Locale = "zh-CN" | "en";
export type GraphDirection = "LR" | "TB";
export type StatusFilter = "all" | "todo" | "doing" | "done" | "blocked";
export type NodePosition = { x: number; y: number };

export interface AppSettings {
  /** 界面缩放（1 = 100%） */
  uiScale: number;
  /** 正文字体 */
  fontBody: "sans" | "serif";
  /** 标题字体 */
  fontHeading: "serif" | "sans";
  /** 用户从操作系统字体中选择的全局应用字体；空字符串表示应用默认。 */
  appFontFamily: string;
  /** 注入内置浏览器所有页面的用户 CSS。 */
  browserCustomCss: string;
  locale: Locale;
  /** 小枢对文件、命令与浏览器操作的全局授权方式。 */
  assistantPermissionMode: AssistantPermissionMode;
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
  const selectedFont = s.appFontFamily.trim();
  root.style.setProperty(
    "--font-sans",
    selectedFont
      ? `${quoteFontFamily(selectedFont)}, ${FONT_STACKS[s.fontBody]}`
      : FONT_STACKS[s.fontBody]
  );
  root.style.setProperty(
    "--font-heading",
    selectedFont
      ? `${quoteFontFamily(selectedFont)}, ${FONT_STACKS[s.fontHeading]}`
      : FONT_STACKS[s.fontHeading]
  );
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

/** 删除项目后的快照，用于「撤销」；连同项目下的全部任务一起保存 */
export interface RemovedProject {
  project: Project;
  tasks: Task[];
  /** 原本在列表中的位置，撤销时插回原处而不是追加到末尾 */
  index: number;
}

interface AppStore {
  loaded: boolean;
  /** 存档读取失败的原因；非 null 时界面必须停在恢复页，不得写盘。 */
  loadError: string | null;
  projects: Project[];
  tasks: Task[];
  tagLibrary: string[];

  selectedProjectId: string | null;
  selectedTaskId: string | null;
  view: ViewMode;
  theme: Theme;
  themeMode: ThemeMode;
  themePalette: ThemePalette;
  graphDirection: GraphDirection;
  /** 脉络图中被用户手动拖拽过的节点位置（taskId -> 位置），未记录的任务用 dagre 布局 */
  graphNodePositions: Record<string, NodePosition>;
  /** 脉络图状态过滤 */
  graphFilter: StatusFilter;
  /** 脉络图聚焦的任务 id（只看其依赖链路） */
  graphFocusTaskId: string | null;
  search: string;
  statusFilter: StatusFilter;
  /** 被折叠的任务分组标题；放在 store 里才能跨视图切换保持 */
  collapsedGroups: string[];
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
  setThemeMode: (mode: ThemeMode) => void;
  setThemePalette: (palette: ThemePalette) => void;
  setGraphDirection: (d: GraphDirection) => void;
  setGraphNodePositions: (positions: Record<string, NodePosition>) => void;
  setGraphFilter: (f: StatusFilter) => void;
  setGraphFocus: (id: string | null) => void;
  setSearch: (q: string) => void;
  setStatusFilter: (f: StatusFilter) => void;
  toggleGroup: (title: string) => void;
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
  deleteProject: (id: string) => RemovedProject | null;
  restoreProject: (removed: RemovedProject) => void;

  addTask: (title: string, patch?: Partial<Task>) => Task | null;
  updateTask: (id: string, patch: Partial<Task>) => void;
  deleteTask: (id: string) => RemovedTask | null;
  restoreTask: (removed: RemovedTask) => void;
  /** 原子批量删除；返回的快照可整体还原，包括任务之间的依赖边 */
  deleteTasks: (ids: string[]) => RemovedTask[];
  restoreTasks: (removed: RemovedTask[]) => void;
  duplicateTask: (id: string) => Task | null;
  setStatus: (id: string, status: Status) => boolean;
  trackTask: (id: string, action: TaskTrackingAction) => boolean;
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
const THEME_MODE_KEY = "mailuo-theme-mode";
const THEME_PALETTE_KEY = "mailuo-theme-palette";
const SETTINGS_KEY = "mailuo-settings";
const PANELS_KEY = "mailuo-panels";
const GRAPH_POSITIONS_KEY = "mailuo-graph-positions";
const COLLAPSED_GROUPS_KEY = "mailuo-collapsed-groups";

function loadCollapsedGroups(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : ["已完成"];
  } catch {
    return ["已完成"];
  }
}

function loadGraphPositions(): Record<string, NodePosition> {
  try {
    const raw = localStorage.getItem(GRAPH_POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, NodePosition>) : {};
  } catch {
    return {};
  }
}

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
  appFontFamily: "",
  browserCustomCss: "",
  locale: "zh-CN",
  assistantPermissionMode: "confirm-sensitive",
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const stored = JSON.parse(raw) as Partial<AppSettings> & {
      /** v0.1.7 及更早版本的浏览器专用权限。 */
      browserAgentMode?: "confirm-sensitive" | "always-allow" | "read-only";
    };
    const assistantPermissionMode: AssistantPermissionMode =
      stored.assistantPermissionMode === "yolo" ||
      stored.assistantPermissionMode === "read-only" ||
      stored.assistantPermissionMode === "confirm-sensitive"
        ? stored.assistantPermissionMode
        : stored.browserAgentMode === "always-allow"
          ? "yolo"
          : stored.browserAgentMode === "read-only"
            ? "read-only"
            : "confirm-sensitive";
    return {
      uiScale:
        typeof stored.uiScale === "number" ? stored.uiScale : DEFAULT_SETTINGS.uiScale,
      fontBody: stored.fontBody === "serif" ? "serif" : "sans",
      fontHeading: stored.fontHeading === "sans" ? "sans" : "serif",
      appFontFamily:
        typeof stored.appFontFamily === "string" ? stored.appFontFamily : "",
      browserCustomCss:
        typeof stored.browserCustomCss === "string" ? stored.browserCustomCss : "",
      locale: stored.locale === "en" ? "en" : "zh-CN",
      assistantPermissionMode,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function applyTheme(theme: Theme, palette: ThemePalette) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.dataset.themePalette = palette;
}

export const useAppStore = create<AppStore>((set, get) => {
  const commit = (patch: Partial<AppStore>) => {
    set(patch);
    const { projects, tasks, tagLibrary, loadError } = get();
    // 存档没读出来时在内存里改动是可以的，但绝不能写回去覆盖原文件
    if (loadError !== null) return;
    schedulePersist({ projects, tasks, tagLibrary });
  };

  return {
    loaded: false,
    loadError: null,
    projects: [],
    tasks: [],
    tagLibrary: [],
    selectedProjectId: null,
    selectedTaskId: null,
    view: "list",
    theme: "light",
    themeMode: "system",
    themePalette: "paper",
    graphDirection: "LR",
    graphNodePositions: loadGraphPositions(),
    graphFilter: "all",
    graphFocusTaskId: null,
    search: "",
    statusFilter: "all",
    collapsedGroups: loadCollapsedGroups(),
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
      const media = window.matchMedia("(prefers-color-scheme: dark)");
      const preference = migrateThemePreference(
        localStorage.getItem(THEME_KEY),
        localStorage.getItem(THEME_MODE_KEY),
        localStorage.getItem(THEME_PALETTE_KEY)
      );
      const theme = resolveThemeMode(preference.mode, media.matches);
      applyTheme(theme, preference.palette);
      const settings = loadSettings();
      applyAppearance(settings);
      media.addEventListener("change", (event) => {
        const state = get();
        if (state.themeMode !== "system") return;
        const resolved = resolveThemeMode("system", event.matches);
        applyTheme(resolved, state.themePalette);
        set({ theme: resolved });
      });

      const result = await loadPersisted();
      // 读失败绝不能当成首次启动：seed 会在 350ms 后原子覆盖用户真实存档
      if (result.kind === "error") {
        set({ loaded: true, loadError: result.message });
        return;
      }
      const fresh = result.kind === "missing";
      const data = fresh ? seedData() : result.data;
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
        themeMode: preference.mode,
        themePalette: preference.palette,
        settings,
        projects: data.projects,
        tasks: reconcileTrackedTaskStatuses(data.tasks),
        tagLibrary,
        selectedProjectId: data.projects[0]?.id ?? null,
      });
      if (fresh)
        schedulePersist({ projects: data.projects, tasks: data.tasks, tagLibrary });
    },

    setView: (view) => set({ view }),
    setTheme: (theme) => {
      if (get().themePalette === "white") theme = "light";
      localStorage.setItem(THEME_MODE_KEY, theme);
      localStorage.setItem(THEME_KEY, theme);
      applyTheme(theme, get().themePalette);
      set({ theme, themeMode: theme });
    },
    setThemeMode: (themeMode) => {
      if (get().themePalette === "white") themeMode = "light";
      localStorage.setItem(THEME_MODE_KEY, themeMode);
      const theme = resolveThemeMode(
        themeMode,
        window.matchMedia("(prefers-color-scheme: dark)").matches
      );
      applyTheme(theme, get().themePalette);
      set({ theme, themeMode });
    },
    setThemePalette: (themePalette) => {
      localStorage.setItem(THEME_PALETTE_KEY, themePalette);
      if (themePalette === "white") {
        localStorage.setItem(THEME_MODE_KEY, "light");
        localStorage.setItem(THEME_KEY, "light");
        applyTheme("light", themePalette);
        set({ theme: "light", themeMode: "light", themePalette });
        return;
      }
      applyTheme(get().theme, themePalette);
      set({ themePalette });
    },
    setGraphDirection: (graphDirection) => {
      if (get().graphDirection === graphDirection) return;
      // 手动位置是方向相关的，切换方向后整体重排
      localStorage.setItem(GRAPH_POSITIONS_KEY, "{}");
      set({ graphDirection, graphNodePositions: {} });
    },
    setGraphNodePositions: (positions) => {
      const next = { ...get().graphNodePositions, ...positions };
      localStorage.setItem(GRAPH_POSITIONS_KEY, JSON.stringify(next));
      set({ graphNodePositions: next });
    },
    setGraphFilter: (graphFilter) => set({ graphFilter }),
    setGraphFocus: (graphFocusTaskId) => set({ graphFocusTaskId }),
    setSearch: (search) => set({ search }),
    setStatusFilter: (statusFilter) => set({ statusFilter }),
    toggleGroup: (title) => {
      const current = get().collapsedGroups;
      const next = current.includes(title)
        ? current.filter((t) => t !== title)
        : [...current, title];
      localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      set({ collapsedGroups: next });
    },
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
        tasks: reconcileTrackedTaskStatuses(
          tasks.map((task) => ({
            ...task,
            tracking: normalizeTaskTracking(task.tracking),
          }))
        ),
        selectedProjectId: projects[0]?.id ?? null,
        selectedTaskId: null,
        graphFocusTaskId: null,
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
    // 筛选条件跟着走到新项目会让它看起来像空项目，一并归位
    selectProject: (id) =>
      set({
        selectedProjectId: id,
        selectedTaskId: null,
        graphFocusTaskId: null,
        search: "",
        statusFilter: "all",
        graphFilter: "all",
      }),
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
      const index = projects.findIndex((p) => p.id === id);
      if (index === -1) return null;
      const project = projects[index];
      const owned = tasks.filter((t) => t.projectId === id);
      const rest = projects.filter((p) => p.id !== id);
      commit({
        projects: rest,
        tasks: tasks.filter((t) => t.projectId !== id),
        selectedProjectId:
          selectedProjectId === id ? (rest[0]?.id ?? null) : selectedProjectId,
        selectedTaskId: null,
        graphFocusTaskId: null,
      });
      return { project, tasks: owned, index };
    },

    restoreProject: (removed) => {
      const { projects, tasks } = get();
      if (projects.some((p) => p.id === removed.project.id)) return;
      const next = [...projects];
      next.splice(Math.min(removed.index, next.length), 0, removed.project);
      commit({
        projects: next,
        tasks: [...tasks, ...removed.tasks],
        selectedProjectId: removed.project.id,
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
        tracking: { type: "standard" },
        ...patch,
      };
      task.tracking = normalizeTaskTracking(task.tracking);
      commit({ tasks: [...tasks, task], selectedTaskId: task.id });
      return task;
    },

    updateTask: (id, patch) => {
      const updated = get().tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              ...patch,
              tracking: normalizeTaskTracking(patch.tracking ?? t.tracking),
            }
          : t
      );
      commit({
        tasks: reconcileTrackedTaskStatuses(updated),
      });
    },

    deleteTask: (id) => {
      const { tasks, selectedTaskId, graphFocusTaskId, graphNodePositions } =
        get();
      const task = tasks.find((t) => t.id === id);
      if (!task) return null;
      const referencedBy = tasks
        .filter((t) => t.deps.includes(id))
        .map((t) => t.id);
      const patch: Partial<AppStore> = {
        tasks: reconcileTrackedTaskStatuses(
          tasks
            .filter((t) => t.id !== id)
            .map((t) =>
              t.deps.includes(id)
                ? { ...t, deps: t.deps.filter((d) => d !== id) }
                : t
            )
        ),
        selectedTaskId: selectedTaskId === id ? null : selectedTaskId,
      };
      if (graphFocusTaskId === id) patch.graphFocusTaskId = null;
      if (id in graphNodePositions) {
        const positions = { ...graphNodePositions };
        delete positions[id];
        patch.graphNodePositions = positions;
      }
      commit(patch);
      return { task, referencedBy };
    },

    /**
     * 一次性删除多个任务。
     *
     * 逐个调 deleteTask 是错的：删掉第一个时会把它从别人的 deps 里摘掉，等轮到
     * 第二个，它的 referencedBy 快照已经不完整，撤销就会漏恢复依赖边。这里在
     * 动手之前先按原始列表算好所有引用关系。
     */
    deleteTasks: (ids) => {
      const { tasks, selectedTaskId, graphFocusTaskId, graphNodePositions } =
        get();
      const doomed = new Set(ids.filter((id) => tasks.some((t) => t.id === id)));
      if (doomed.size === 0) return [];

      const removed: RemovedTask[] = [...doomed].map((id) => ({
        task: tasks.find((t) => t.id === id)!,
        // 只记录「活下来的」引用者，被一起删掉的那些自带 deps
        referencedBy: tasks
          .filter((t) => !doomed.has(t.id) && t.deps.includes(id))
          .map((t) => t.id),
      }));

      const positions = { ...graphNodePositions };
      for (const id of doomed) delete positions[id];

      commit({
        tasks: reconcileTrackedTaskStatuses(
          tasks
            .filter((t) => !doomed.has(t.id))
            .map((t) =>
              t.deps.some((d) => doomed.has(d))
                ? { ...t, deps: t.deps.filter((d) => !doomed.has(d)) }
                : t
            )
        ),
        selectedTaskId:
          selectedTaskId && doomed.has(selectedTaskId) ? null : selectedTaskId,
        graphFocusTaskId:
          graphFocusTaskId && doomed.has(graphFocusTaskId)
            ? null
            : graphFocusTaskId,
        graphNodePositions: positions,
      });
      return removed;
    },

    restoreTasks: (removed) => {
      if (removed.length === 0) return;
      const { tasks } = get();
      const back = removed.filter(
        (r) => !tasks.some((t) => t.id === r.task.id)
      );
      if (back.length === 0) return;
      // 先把任务放回去，再逐条接回原来指向它们的依赖边
      let next = [...tasks, ...back.map((r) => r.task)];
      for (const { task, referencedBy } of back) {
        const refs = new Set(referencedBy);
        next = next.map((t) =>
          refs.has(t.id) && !t.deps.includes(task.id)
            ? { ...t, deps: [...t.deps, task.id] }
            : t
        );
      }
      commit({ tasks: reconcileTrackedTaskStatuses(next) });
    },

    restoreTask: (removed) => {
      const { tasks } = get();
      const refs = new Set(removed.referencedBy);
      commit({
        tasks: reconcileTrackedTaskStatuses([
          ...tasks.map((t) =>
            refs.has(t.id) ? { ...t, deps: [...t.deps, removed.task.id] } : t
          ),
          removed.task,
        ]),
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
        tracking:
          src.tracking.type === "progress"
            ? { ...src.tracking, current: 0 }
            : src.tracking.type === "checkin"
              ? { ...src.tracking, records: [] }
              : { type: "standard" },
      };
      commit({ tasks: [...tasks, copy], selectedTaskId: copy.id });
      return copy;
    },

    setStatus: (id, status) => {
      const { tasks } = get();
      const byId = new Map(tasks.map((t) => [t.id, t]));
      const task = byId.get(id);
      if (!task) return false;
      if (task.tracking.type !== "standard") return false;
      // 受阻任务不可直接完成
      if (status === "done" && isBlocked(task, byId)) return false;
      commit({
        tasks: reconcileTrackedTaskStatuses(
          tasks.map((t) =>
            t.id === id
              ? {
                  ...t,
                  status,
                  completedAt: status === "done" ? Date.now() : null,
                }
              : t
          )
        ),
      });
      return true;
    },

    trackTask: (id, action) => {
      const tasks = get().tasks;
      if (!tasks.some((task) => task.id === id)) return false;
      const updated = tasks.map((task) =>
        task.id === id ? updateTaskTracking(task, action) : task
      );
      commit({ tasks: reconcileTrackedTaskStatuses(updated) });
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
      const updated = tasks.map((t) =>
        t.id === taskId ? { ...t, deps: [...t.deps, depId] } : t
      );
      commit({
        tasks: reconcileTrackedTaskStatuses(updated),
      });
      return "ok";
    },

    removeDep: (taskId, depId) => {
      const updated = get().tasks.map((t) =>
        t.id === taskId
          ? { ...t, deps: t.deps.filter((d) => d !== depId) }
          : t
      );
      commit({
        tasks: reconcileTrackedTaskStatuses(updated),
      });
    },
  };
});
