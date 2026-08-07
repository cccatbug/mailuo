import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import type {
  Priority,
  RecurrenceUnit,
  Status,
  Task,
  TaskSchedule,
} from "@/types";
import { isBlocked } from "@/lib/deps";
import { taskTrackingSnapshot } from "@/lib/task-tracking";
import {
  daysBetween,
  describeSchedule,
  normalizeTaskSchedule,
  scheduleStatus,
  taskSchedule,
  todayISO,
  toISODate,
} from "@/lib/task-schedule";
import type { TaskCommand, TaskView } from "@/shared/task-commands";

/* ---------- 输入收敛 ---------- */

interface ScheduleInput {
  kind?: string;
  due?: string;
  start?: string;
  unit?: string;
  interval?: number;
  weekdays?: number[];
  monthDay?: number;
  until?: string;
}

interface TrackingInput {
  kind?: string;
  current?: number;
  target?: number;
  unit?: string;
  cadence?: string;
  checkIn?: boolean;
}

/** 把工具的扁平安排输入翻译成内部 TaskSchedule */
function toSchedule(input: ScheduleInput | undefined): TaskSchedule | undefined {
  if (!input || !input.kind) return undefined;
  if (input.kind === "none") return { type: "none" };
  const due = input.due ?? todayISO();
  if (input.kind === "recurring") {
    return normalizeTaskSchedule({
      type: "recurring",
      start: input.start ?? due,
      due,
      rule: {
        unit: (input.unit ?? "day") as RecurrenceUnit,
        interval: input.interval ?? 1,
        weekdays: input.weekdays ?? [],
        monthDay: input.monthDay ?? 0,
      },
      doneCount: 0,
      lastDone: null,
      until: input.until ?? null,
    });
  }
  return normalizeTaskSchedule({
    type: "once",
    start: input.start ?? null,
    due,
  });
}

/* ---------- 任务视图 ---------- */

function isoDay(timestamp: number): string {
  return toISODate(new Date(timestamp));
}

function toView(
  task: Task,
  byId: Map<string, Task>,
  dependents: Map<string, string[]>,
  projectName: string,
  includeNotes: boolean
): TaskView {
  const schedule = taskSchedule(task);
  const status = scheduleStatus(schedule);
  const tracking = taskTrackingSnapshot(task);
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    blocked: isBlocked(task, byId),
    priority: task.priority,
    project: projectName,
    projectId: task.projectId,
    tags: task.tags,
    schedule: describeSchedule(schedule),
    due: status.due,
    overdueDays: status.state === "overdue" ? -status.days : 0,
    type: task.tracking.type,
    progress: tracking.summary,
    dependsOn: task.deps
      .map((id) => byId.get(id)?.title)
      .filter((title): title is string => title !== undefined),
    requiredBy: (dependents.get(task.id) ?? [])
      .map((id) => byId.get(id)?.title)
      .filter((title): title is string => title !== undefined),
    ...(includeNotes && task.notes ? { notes: task.notes } : {}),
    createdAt: isoDay(task.createdAt),
    completedAt: task.completedAt ? isoDay(task.completedAt) : null,
  };
}

function dependentIndex(tasks: Task[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const task of tasks) {
    for (const dep of task.deps) {
      const list = index.get(dep) ?? [];
      list.push(task.id);
      index.set(dep, list);
    }
  }
  return index;
}

/**
 * 按 id 或标题找任务。
 *
 * 模型给的标题常有细微出入（多个句号、少个字），所以 id → 精确标题 → 归一化
 * 标题 → 包含关系，逐级放宽；但不做模糊到会误伤的地步。
 */
function resolveTask(list: Task[], reference: string | undefined): Task | null {
  if (!reference) return null;
  const key = reference.trim();
  if (!key) return null;
  const byId = list.find((task) => task.id === key);
  if (byId) return byId;
  const exact = list.filter((task) => task.title === key);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const normalize = (value: string) =>
    value.toLowerCase().replace(/[\s「」『』"'（）()【】\[\].,。，、!！?？:：;；-]/g, "");
  const target = normalize(key);
  const normalized = list.filter((task) => normalize(task.title) === target);
  if (normalized.length === 1) return normalized[0];
  const contains = list.filter(
    (task) => normalize(task.title).includes(target) && target.length >= 2
  );
  return contains.length === 1 ? contains[0] : null;
}

/* ---------- 命令执行 ---------- */

interface CommandContext {
  projectId: string;
  projectTasks: Task[];
  byId: Map<string, Task>;
}

function context(projectIdHint?: unknown): CommandContext {
  const store = useAppStore.getState();
  const reference =
    typeof projectIdHint === "string" ? projectIdHint.trim() : "";
  const target = reference
    ? store.projects.find((p) => p.id === reference || p.name === reference)
    : undefined;
  if (reference && !target) throw new Error(`找不到项目「${reference}」`);
  const projectId = target?.id ?? store.selectedProjectId ?? "";
  const projectTasks = store.tasks.filter((t) => t.projectId === projectId);
  return {
    projectId,
    projectTasks,
    byId: new Map(store.tasks.map((t) => [t.id, t])),
  };
}

function listTasks(payload: Record<string, unknown>): unknown {
  const store = useAppStore.getState();
  const { projectId } = context(payload.projectId);
  const all = payload.allProjects === true;
  const scoped = all
    ? store.tasks
    : store.tasks.filter((task) => task.projectId === projectId);

  const byId = new Map(store.tasks.map((task) => [task.id, task]));
  const dependents = dependentIndex(store.tasks);
  const today = todayISO();
  const status = typeof payload.status === "string" ? payload.status : "all";
  const tags = Array.isArray(payload.tags) ? (payload.tags as string[]) : [];
  const search =
    typeof payload.search === "string" ? payload.search.trim().toLowerCase() : "";
  const limit = Math.min(
    200,
    Math.max(1, typeof payload.limit === "number" ? payload.limit : 50)
  );
  const includeNotes = payload.includeNotes === true;

  const filtered = scoped.filter((task) => {
    if (tags.length > 0 && !tags.some((tag) => task.tags.includes(tag))) return false;
    if (
      search &&
      !`${task.title} ${task.notes} ${task.tags.join(" ")}`
        .toLowerCase()
        .includes(search)
    ) {
      return false;
    }
    switch (status) {
      case "todo":
        return task.status === "todo";
      case "doing":
        return task.status === "doing";
      case "done":
        return task.status === "done";
      case "blocked":
        return isBlocked(task, byId);
      case "overdue":
        return (
          task.status !== "done" &&
          scheduleStatus(taskSchedule(task), today).state === "overdue"
        );
      case "today": {
        if (task.status === "done") return false;
        const state = scheduleStatus(taskSchedule(task), today);
        return state.state === "overdue" || state.state === "today";
      }
      case "week": {
        if (task.status === "done") return false;
        const due = taskSchedule(task);
        if (due.type === "none") return false;
        const gap = daysBetween(today, due.due);
        return gap >= 0 && gap <= 7;
      }
      default:
        return true;
    }
  });

  const projectName = (id: string) =>
    store.projects.find((project) => project.id === id)?.name ?? "";

  return {
    today,
    currentProject: projectName(projectId),
    total: filtered.length,
    returned: Math.min(filtered.length, limit),
    tasks: filtered
      .slice(0, limit)
      .map((task) =>
        toView(task, byId, dependents, projectName(task.projectId), includeNotes)
      ),
    ...(filtered.length > limit
      ? { note: `还有 ${filtered.length - limit} 项未返回，请缩小筛选范围` }
      : {}),
  };
}

function taskDetail(payload: Record<string, unknown>): unknown {
  const store = useAppStore.getState();
  const task = resolveTask(
    store.tasks,
    typeof payload.task === "string" ? payload.task : undefined
  );
  if (!task) throw new Error(`找不到任务「${String(payload.task ?? "")}」`);
  const byId = new Map(store.tasks.map((entry) => [entry.id, entry]));
  const dependents = dependentIndex(store.tasks);
  const projectName =
    store.projects.find((project) => project.id === task.projectId)?.name ?? "";
  const schedule = taskSchedule(task);
  return {
    ...toView(task, byId, dependents, projectName, true),
    notes: task.notes,
    scheduleDetail: schedule,
    trackingDetail: task.tracking,
    importance: task.importance ?? null,
    urgency: task.urgency ?? null,
  };
}

function createTasks(payload: Record<string, unknown>): unknown {
  const store = useAppStore.getState();
  const { projectId } = context(payload.projectId);
  if (!projectId) throw new Error("当前没有选中的项目，无法创建任务");
  const drafts = Array.isArray(payload.tasks)
    ? (payload.tasks as Record<string, unknown>[])
    : [];
  if (drafts.length === 0) throw new Error("没有要创建的任务");

  // addTask 认的是 selectedProjectId，先把当前项目指过去
  const previousProjectId = store.selectedProjectId;
  const previousTaskId = store.selectedTaskId;
  if (previousProjectId !== projectId) {
    useAppStore.setState({ selectedProjectId: projectId });
  }

  const created: { id: string; title: string }[] = [];
  const createdByIndex = new Map<number, { id: string; title: string }>();
  const titleToIds = new Map<string, string[]>();
  const failed: string[] = [];

  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const title = typeof draft.title === "string" ? draft.title.trim() : "";
    if (!title) {
      failed.push("（缺少标题）");
      continue;
    }
    const tracking = draft.tracking as TrackingInput | undefined;
    const schedule = toSchedule(draft.schedule as ScheduleInput | undefined);
    if (
      schedule?.type === "recurring" &&
      tracking?.kind !== undefined &&
      tracking.kind !== "standard"
    ) {
      failed.push(`${title}（进度/打卡任务不能叠加定期轮次）`);
      continue;
    }
    const task = useAppStore.getState().addTask(title, {
      notes: typeof draft.notes === "string" ? draft.notes : "",
      priority: (["high", "normal", "low"] as Priority[]).includes(
        draft.priority as Priority
      )
        ? (draft.priority as Priority)
        : "normal",
      tags: Array.isArray(draft.tags)
        ? [
            ...new Set(
              (draft.tags as string[])
                .map((tag) => String(tag).trim())
                .filter(Boolean)
                .slice(0, 10)
            ),
          ]
        : [],
      schedule,
    });
    if (!task) {
      failed.push(title);
      continue;
    }
    created.push({ id: task.id, title: task.title });
    createdByIndex.set(index, { id: task.id, title: task.title });
    titleToIds.set(task.title, [
      ...(titleToIds.get(task.title) ?? []),
      task.id,
    ]);
    if (Array.isArray(draft.tags)) {
      useAppStore
        .getState()
        .addTagsToLibrary((draft.tags as string[]).map((tag) => String(tag)));
    }
    applyTracking(task.id, tracking);
  }

  // 依赖回填放在最后：同批任务可以互相引用，前面还没建出来的这时已经在了
  const linked: string[] = [];
  const refused: string[] = [];
  for (let index = 0; index < drafts.length; index += 1) {
    const draft = drafts[index];
    const self = createdByIndex.get(index);
    if (!self) continue;
    const deps = Array.isArray(draft.dependsOn) ? (draft.dependsOn as string[]) : [];
    for (const reference of deps) {
      const state = useAppStore.getState();
      const pool = state.tasks.filter((task) => task.projectId === projectId);
      const key = String(reference).trim();
      const createdIds = titleToIds.get(key) ?? [];
      const dep = createdIds.length === 1
        ? pool.find((task) => task.id === createdIds[0])
        : createdIds.length > 1
          ? null
          : resolveTask(pool, key);
      if (!dep) {
        refused.push(
          `${self.title} ← ${reference}（${createdIds.length > 1 ? "同名任务不唯一" : "找不到前置任务"}）`
        );
        continue;
      }
      const result = state.addDep(self.id, dep.id);
      if (result === "ok") linked.push(`${self.title} ← ${dep.title}`);
      else if (result === "dup") refused.push(`${self.title} ← ${dep.title}（已存在）`);
      else if (result === "cycle") refused.push(`${self.title} ← ${dep.title}（会成环）`);
      else refused.push(`${self.title} ← ${dep.title}（无法建立依赖）`);
    }
  }

  // 指定其它项目创建只是数据落点，不应悄悄把用户当前工作区切走。
  if (previousProjectId !== projectId) {
    useAppStore.setState({
      selectedProjectId: previousProjectId,
      selectedTaskId: previousTaskId,
    });
  }

  if (created.length > 0) {
    toast.success(`小枢创建了 ${created.length} 个任务`);
  }
  return {
    created,
    dependencies: linked,
    ...(refused.length > 0 ? { skipped: refused } : {}),
    ...(failed.length > 0 ? { failed } : {}),
  };
}

function applyTracking(taskId: string, tracking: TrackingInput | undefined): void {
  if (!tracking?.kind) return;
  const store = useAppStore.getState();
  if (tracking.kind === "progress") {
    store.trackTask(taskId, { type: "set-type", taskType: "progress" });
    useAppStore.getState().trackTask(taskId, {
      type: "set-progress",
      current: tracking.current,
      target: tracking.target,
      unit: tracking.unit,
    });
    return;
  }
  if (tracking.kind === "checkin") {
    store.trackTask(taskId, { type: "set-type", taskType: "checkin" });
    useAppStore.getState().trackTask(taskId, {
      type: "set-checkin",
      cadence: tracking.cadence === "monthly" ? "monthly" : "daily",
      target: tracking.target,
    });
    if (tracking.checkIn) {
      useAppStore.getState().trackTask(taskId, { type: "toggle-checkin" });
    }
    return;
  }
  store.trackTask(taskId, { type: "set-type", taskType: "standard" });
}

function updateTasks(payload: Record<string, unknown>): unknown {
  const updates = Array.isArray(payload.updates)
    ? (payload.updates as Record<string, unknown>[])
    : [];
  if (updates.length === 0) throw new Error("没有要修改的任务");

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const update of updates) {
    const store = useAppStore.getState();
    const task = resolveTask(
      store.tasks,
      typeof update.task === "string" ? update.task : undefined
    );
    if (!task) {
      skipped.push(`${String(update.task ?? "")}（找不到任务）`);
      continue;
    }
    const changes: string[] = [];

    const patch: Partial<Task> = {};
    if (typeof update.title === "string" && update.title.trim()) {
      patch.title = update.title.trim();
      changes.push("标题");
    }
    if (typeof update.notes === "string") {
      patch.notes = update.notes;
      changes.push("备注");
    } else if (typeof update.appendNotes === "string" && update.appendNotes.trim()) {
      patch.notes = task.notes
        ? `${task.notes.trimEnd()}\n\n${update.appendNotes.trim()}`
        : update.appendNotes.trim();
      changes.push("备注");
    }
    let schedule = toSchedule(update.schedule as ScheduleInput | undefined);
    const trackingInput = update.tracking as TrackingInput | undefined;
    const nextTrackingType = trackingInput?.kind ?? task.tracking.type;
    if (schedule?.type === "recurring" && nextTrackingType !== "standard") {
      skipped.push(`${task.title}（进度/打卡任务不能叠加定期轮次）`);
      schedule = undefined;
    }
    if (schedule) {
      patch.schedule = schedule;
      changes.push("日期安排");
    }
    if (Object.keys(patch).length > 0) store.updateTask(task.id, patch);

    if ((["high", "normal", "low"] as Priority[]).includes(update.priority as Priority)) {
      useAppStore.getState().setPriority(task.id, update.priority as Priority);
      changes.push("优先级");
    }

    if (typeof update.importance === "number" || typeof update.urgency === "number") {
      const current = useAppStore.getState().tasks.find((t) => t.id === task.id);
      useAppStore
        .getState()
        .setImportance(
          task.id,
          typeof update.importance === "number"
            ? update.importance
            : (current?.importance ?? 0.5),
          typeof update.urgency === "number"
            ? update.urgency
            : (current?.urgency ?? 0.5)
        );
      changes.push("四象限位置");
    }

    if (Array.isArray(update.addTags)) {
      for (const tag of update.addTags as string[]) {
        useAppStore.getState().addTag(task.id, String(tag));
      }
      changes.push("标签");
    }
    if (Array.isArray(update.removeTags)) {
      for (const tag of update.removeTags as string[]) {
        useAppStore.getState().removeTag(task.id, String(tag));
      }
      changes.push("标签");
    }

    const wasRecurring = taskSchedule(task).type === "recurring";
    applyTracking(task.id, trackingInput);
    if (trackingInput?.kind) {
      changes.push("追踪方式");
      if (wasRecurring && trackingInput.kind !== "standard") {
        changes.push("日期安排改为一次性期限");
      }
    }

    if (typeof update.status === "string") {
      const next = update.status as Status;
      const latest = useAppStore.getState().tasks.find((t) => t.id === task.id);
      if (latest && latest.tracking.type !== "standard") {
        skipped.push(`${task.title}（进度/打卡任务的状态由进展决定，未改状态）`);
      } else if (useAppStore.getState().setStatus(task.id, next)) {
        changes.push(
          next === "done" && latest && taskSchedule(latest).type === "recurring"
            ? "完成本轮（下次处理日已顺延）"
            : "状态"
        );
      } else {
        skipped.push(`${task.title}（前置任务未完成，无法标记完成）`);
      }
    }

    if (changes.length > 0) {
      applied.push(`${task.title}：${[...new Set(changes)].join("、")}`);
    } else if (!skipped.some((entry) => entry.startsWith(task.title))) {
      skipped.push(`${task.title}（没有可改的字段）`);
    }
  }

  if (applied.length > 0) toast.success(`小枢更新了 ${applied.length} 个任务`);
  return { applied, ...(skipped.length > 0 ? { skipped } : {}) };
}

function deleteTasks(payload: Record<string, unknown>): unknown {
  const references = Array.isArray(payload.tasks) ? (payload.tasks as string[]) : [];
  if (references.length === 0) throw new Error("没有要删除的任务");
  const store = useAppStore.getState();
  const ids: string[] = [];
  const titles: string[] = [];
  const missing: string[] = [];
  for (const reference of references) {
    const task = resolveTask(store.tasks, String(reference));
    if (!task) {
      missing.push(String(reference));
      continue;
    }
    if (ids.includes(task.id)) continue;
    ids.push(task.id);
    titles.push(task.title);
  }
  if (ids.length === 0) {
    return { deleted: [], missing, note: "没有匹配到任何任务，什么都没删" };
  }
  const removed = store.deleteTasks(ids);
  // 删除是唯一不可逆的操作，撤销入口必须立刻摆在用户面前
  toast(`小枢删除了 ${removed.length} 个任务`, {
    duration: 15_000,
    action: {
      label: "撤销",
      onClick: () => useAppStore.getState().restoreTasks(removed),
    },
  });
  return {
    deleted: titles,
    ...(missing.length > 0 ? { missing } : {}),
    note: "用户可以在应用里撤销这次删除",
  };
}

function linkTasks(payload: Record<string, unknown>): unknown {
  const links = Array.isArray(payload.links)
    ? (payload.links as Record<string, unknown>[])
    : [];
  if (links.length === 0) throw new Error("没有要处理的依赖");
  const linked: string[] = [];
  const unlinked: string[] = [];
  const skipped: string[] = [];

  for (const link of links) {
    const store = useAppStore.getState();
    const task = resolveTask(store.tasks, String(link.task ?? ""));
    const dep = resolveTask(store.tasks, String(link.dependsOn ?? ""));
    if (!task || !dep) {
      skipped.push(`${String(link.task ?? "")} ← ${String(link.dependsOn ?? "")}（找不到任务）`);
      continue;
    }
    if (link.remove === true) {
      if (!task.deps.includes(dep.id)) {
        skipped.push(`${task.title} ← ${dep.title}（依赖不存在）`);
        continue;
      }
      store.removeDep(task.id, dep.id);
      unlinked.push(`${task.title} ← ${dep.title}`);
      continue;
    }
    const result = store.addDep(task.id, dep.id);
    if (result === "ok") linked.push(`${task.title} ← ${dep.title}`);
    else if (result === "dup") skipped.push(`${task.title} ← ${dep.title}（已存在）`);
    else if (result === "cycle") skipped.push(`${task.title} ← ${dep.title}（会成环）`);
    else skipped.push(`${task.title} ← ${dep.title}（跨项目无法依赖）`);
  }

  return {
    ...(linked.length > 0 ? { linked } : {}),
    ...(unlinked.length > 0 ? { unlinked } : {}),
    ...(skipped.length > 0 ? { skipped } : {}),
  };
}

function listProjects(payload: Record<string, unknown>, switching: boolean): unknown {
  const store = useAppStore.getState();
  if (switching) {
    const reference = String(payload.switchTo ?? "").trim();
    const target = store.projects.find(
      (project) => project.id === reference || project.name === reference
    );
    if (!target) throw new Error(`找不到项目「${reference}」`);
    store.selectProject(target.id);
    toast.info(`小枢切换到项目「${target.name}」`);
  }

  const current = useAppStore.getState();
  return {
    currentProjectId: current.selectedProjectId,
    projects: current.projects.map((project) => {
      const tasks = current.tasks.filter((task) => task.projectId === project.id);
      const done = tasks.filter((task) => task.status === "done").length;
      return {
        id: project.id,
        name: project.name,
        current: project.id === current.selectedProjectId,
        archived: project.archived === true,
        total: tasks.length,
        done,
        percent: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100),
      };
    }),
  };
}

/** 主进程发来的任务命令在这里落到 store 上 */
export function runTaskCommand(command: TaskCommand): unknown {
  const payload = command.payload ?? {};
  switch (command.action) {
    case "list_tasks":
      return listTasks(payload);
    case "task_detail":
      return taskDetail(payload);
    case "create_tasks":
      return createTasks(payload);
    case "update_tasks":
      return updateTasks(payload);
    case "delete_tasks":
      return deleteTasks(payload);
    case "link_tasks":
      return linkTasks(payload);
    case "list_projects":
      return listProjects(payload, false);
    case "switch_project":
      return listProjects(payload, true);
    default:
      throw new Error(`未知的任务命令：${String(command.action)}`);
  }
}
