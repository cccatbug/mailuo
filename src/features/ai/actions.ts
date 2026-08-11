import { runAgent, runAgentJson } from "@/lib/ai";
import { useAppStore } from "@/store/useAppStore";
import type { Priority, Status, Task } from "@/types";
import { sanitizeUiSpec, UI_CATALOG_PROMPT, type UiSpec } from "./uiCatalog";
import { taskTrackingSnapshot } from "@/lib/task-tracking";
import { describeSchedule, taskSchedule } from "@/lib/task-schedule";

/* ---------- 上下文构造 ---------- */

export function projectContext(projectId: string): string {
  const { projects, tasks } = useAppStore.getState();
  const project = projects.find((p) => p.id === projectId);
  const list = tasks.filter((t) => t.projectId === projectId);
  const date = (timestamp: number) =>
    new Date(timestamp).toISOString().slice(0, 10);
  const lines = list.map((t, i) => {
    const tracking = taskTrackingSnapshot(t);
    const schedule = taskSchedule(t);
    const deps = t.deps
      .map((d) => list.findIndex((x) => x.id === d))
      .filter((n) => n >= 0)
      .map((n) => `T${n + 1}`)
      .join(",");
    return `T${i + 1} 「${t.title}」 状态:${t.status} 优先级:${t.priority}${
      schedule.type !== "none" ? ` 安排:${describeSchedule(schedule)}` : ""
    }${
      t.tracking.type === "progress"
        ? ` 类型:进度 进度:${tracking.summary}`
        : t.tracking.type === "checkin"
          ? ` 类型:打卡 进度:${tracking.summary} 连续:${tracking.streak}`
          : " 类型:普通"
    }${t.tags.length ? ` 标签:[${t.tags.join(",")}]` : ""}${
      typeof t.importance === "number"
        ? ` 重要度:${Math.round(t.importance * 100)}`
        : ""
    }${
      typeof t.urgency === "number"
        ? ` 紧急度:${Math.round(t.urgency * 100)}`
        : ""
    } 创建:${date(t.createdAt)}${
      t.completedAt ? ` 完成:${date(t.completedAt)}` : ""
    }${deps ? ` 前置:[${deps}]` : ""}${t.notes ? ` 备注:${t.notes.slice(0, 60)}` : ""}`;
  });
  return `项目「${project?.name ?? ""}」当前共 ${list.length} 个任务：\n${lines.join("\n")}`;
}

/* ---------- 结构化产物 ---------- */

export interface DraftTask {
  title: string;
  notes?: string;
  priority?: Priority;
  /** 依赖同批次中的其它任务（0 起下标） */
  deps?: number[];
}

function sanitizeDrafts(raw: { tasks?: DraftTask[] }): DraftTask[] {
  const items = Array.isArray(raw.tasks) ? raw.tasks : [];
  return items
    .filter((t) => typeof t.title === "string" && t.title.trim())
    .slice(0, 100)
    .map((t, _, arr) => ({
      title: t.title.trim().slice(0, 60),
      notes: typeof t.notes === "string" ? t.notes.slice(0, 500) : "",
      priority: (["high", "normal", "low"] as const).includes(
        t.priority as Priority
      )
        ? t.priority
        : "normal",
      deps: Array.isArray(t.deps)
        ? t.deps.filter(
            (n) => Number.isInteger(n) && n >= 0 && n < arr.length
          )
        : [],
    }));
}

/** AI 规划项目：从目标生成任务 DAG 草案 */
export async function aiPlanProject(
  projectId: string,
  goal: string
): Promise<DraftTask[]> {
  const raw = await runAgentJson<{ tasks?: DraftTask[] }>({
    useCase: "project-plan",
    prompt: `目标：${goal}`,
    context: { projectSnapshot: projectContext(projectId) },
  });
  const drafts = sanitizeDrafts(raw);
  if (drafts.length === 0) throw new Error("AI 未能生成有效任务");
  return drafts;
}

/** AI 拆解任务：把一个任务分解为若干前置子任务 */
export async function aiBreakdownTask(taskId: string, instruction = "请拆解上下文中的目标任务。"): Promise<DraftTask[]> {
  const { tasks } = useAppStore.getState();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("任务不存在");
  const raw = await runAgentJson<{ tasks?: DraftTask[] }>({
    useCase: "task-breakdown",
    prompt: instruction,
    context: {
      projectSnapshot: projectContext(task.projectId),
      taskDetails: `任务：「${task.title}」${
        task.notes ? `\n备注：${task.notes}` : ""
      }`,
    },
  });
  const drafts = sanitizeDrafts(raw);
  if (drafts.length === 0) throw new Error("AI 未能生成有效子任务");
  return drafts;
}

/** 把草案任务写入项目；forTaskId 存在时，原任务将依赖所有新任务 */
export function applyDrafts(
  projectId: string,
  drafts: DraftTask[],
  selectedIdx: number[],
  forTaskId?: string
): number {
  const store = useAppStore.getState();
  const chosen = selectedIdx.filter((i) => i >= 0 && i < drafts.length);
  const idMap = new Map<number, string>();
  for (const i of chosen) {
    const d = drafts[i];
    const prev = store.selectedProjectId;
    // addTask 依赖 selectedProjectId，先确保指向目标项目
    if (prev !== projectId) useAppStore.setState({ selectedProjectId: projectId });
    const task = useAppStore.getState().addTask(d.title, {
      notes: d.notes ?? "",
      priority: d.priority ?? "normal",
    });
    if (task) idMap.set(i, task.id);
  }
  // 依赖回填（仅在两端都被选中时）
  for (const i of chosen) {
    const id = idMap.get(i);
    if (!id) continue;
    for (const dep of drafts[i].deps ?? []) {
      const depId = idMap.get(dep);
      if (depId) useAppStore.getState().addDep(id, depId);
    }
  }
  if (forTaskId) {
    for (const id of idMap.values()) {
      useAppStore.getState().addDep(forTaskId, id);
    }
  }
  return idMap.size;
}

/* ---------- 依赖建议 ---------- */

export interface DepSuggestion {
  fromIdx: number; // 前置任务下标（T1 → 0）
  toIdx: number; // 依赖方下标
  reason: string;
}

export async function aiSuggestDeps(
  projectId: string,
  instruction = "请分析项目任务的缺失依赖。"
): Promise<DepSuggestion[]> {
  const { tasks } = useAppStore.getState();
  const list = tasks.filter((t) => t.projectId === projectId);
  const raw = await runAgentJson<{
    suggestions?: { from?: string; to?: string; reason?: string }[];
  }>({
    useCase: "dependency-suggest",
    prompt: instruction,
    context: { projectSnapshot: projectContext(projectId) },
  });
  const parse = (s: string | undefined) => {
    const m = /^T(\d+)$/.exec((s ?? "").trim());
    if (!m) return -1;
    const n = Number(m[1]) - 1;
    return n >= 0 && n < list.length ? n : -1;
  };
  return (raw.suggestions ?? [])
    .map((s) => ({
      fromIdx: parse(s.from),
      toIdx: parse(s.to),
      reason: typeof s.reason === "string" ? s.reason.slice(0, 100) : "",
    }))
    .filter(
      (s) =>
        s.fromIdx >= 0 &&
        s.toIdx >= 0 &&
        s.fromIdx !== s.toIdx &&
        !list[s.toIdx].deps.includes(list[s.fromIdx].id)
    )
    .slice(0, 8);
}

/* ---------- 备注润色 ---------- */

export async function aiPolishNotes(taskId: string, instruction = "请润色上下文中的任务备注。"): Promise<string> {
  const { tasks } = useAppStore.getState();
  const task = tasks.find((t) => t.id === taskId);
  if (!task) throw new Error("任务不存在");
  const text = await runAgent({
    useCase: "notes-polish",
    prompt: instruction,
    context: {
      taskDetails: `任务：「${task.title}」\n现有备注：${task.notes || "（空）"}`,
    },
  });
  return text.trim();
}

/* ---------- 助手操作协议 ---------- */

export interface AssistantOp {
  op:
    | "create_task"
    | "set_status"
    | "set_priority"
    | "set_due"
    | "add_dep"
    | "set_notes"
    | "delete_task"
    | "add_tags"
    | "remove_tags"
    | "remember";
  title?: string;
  notes?: string;
  priority?: Priority;
  status?: Status;
  date?: string;
  task?: string;
  depends_on?: string;
  tags?: string[];
}

export const ASSISTANT_SYSTEM = `你是「小枢」（英文名 Shu），「脉络」待办应用的内置 AI 助手，帮助用户管理项目驱动、带依赖关系的任务。你的名字取自"枢纽"——你是任务脉络的中心节点。
回答保持简洁、直接、可执行，语气亲切但不啰嗦。每条用户消息开头会附带当前项目的任务快照，以它为准。

## 操作执行协议（必须遵守）
当用户要求你对任务做任何操作（创建、修改、删除、打标签等）时，你**必须**在回复末尾输出一个 JSON 操作块。格式如下：

\`\`\`mailuo-actions
{"ops":[{"op":"create_task","title":"任务标题","notes":"**目标**：完成某功能。\\n- 步骤一\\n- 步骤二\\n\\n[参考资料](https://example.com)","priority":"normal","tags":["标签1","标签2"],"depends_on":"前置任务标题"}]}
\`\`\`

支持的 op 类型（共 10 种）：
- create_task：创建任务（title 必填；可选 notes、priority、tags、depends_on）
- set_status：修改状态（task=任务标题，status=todo|doing|done）
- set_priority：调整优先级（task=任务标题，priority=high|normal|low）
- set_due：设定期限（task=任务标题，date=YYYY-MM-DD）
- add_dep：建立依赖（task=下游标题，depends_on=前置标题）
- set_notes：覆写备注（task=任务标题，notes=markdown 全文）
- delete_task：删除任务（task=任务标题）
- add_tags：添加标签（task=任务标题，tags=["标签A","标签B"]）
- remove_tags：移除标签（task=任务标题，tags=["旧标签"]）
- remember：写入长期记忆（notes=值得记住的用户偏好或事实）

**关键规则：**
- 代码块标记必须是 \`mailuo-actions\`（不是 json）
- task/depends_on 必须用任务的**准确标题**
- 放在回复**最末尾**，之后不要有任何文字
- **不要跳过这个块**——即使用户只说"帮我创建任务"，也必须在回复中产出它，不要只口头承诺

## 标签使用规范（重要）
标签是任务管理的重要手段，你必须主动为任务添加标签：
- 每次创建任务时，务必根据任务内容推断并附上 2-5 个中文标签（2-4 字），如"前端""后端""设计""文档""Bug""优化""紧急""调研""部署""测试"等
- 如果用户提到了某个领域或模块名，必须将其作为标签（如用户说"优化首页性能"→ 标签应含"性能""首页"）
- 定期观察项目里已有的标签库（从任务快照中可见），优先复用已有标签保持一致性
- 批量创建时也要为每个任务分别思考合适的标签
- 主动建议：当你审视任务列表时，如果发现有些任务缺少标签或标签不准确，主动提出 add_tags / remove_tags 操作

## 任务备注的写法（重要）
任务备注必须使用完整 Markdown 格式（绝不能是纯文本），会在任务详情中渲染。写备注时遵循：
- 结构清晰：**加粗**一句话目标开头，然后用短列表（-）写关键步骤或验收标准，控制在可扫读的长度
- 资源链接：必须把相关的文件路径、参考资料、设计稿链接等以 Markdown 链接形式写入备注，格式 [描述](url)。例如 [设计稿](https://figma.com/...)、[接口文档](https://api.example.com/docs)、[本地文件](file://~/documents/spec.md)
- 需要背景资料时，善用 bash 工具（curl 等）检索/抓取，把高价值链接以 [标题](url) 形式放进备注
- 长内容外置：调研总结、方案草稿等长文写成工作目录里的 .md 文件，备注里用「详见工作区 \`文件名.md\`」引用，不要把长文塞进备注
- 用户让你"充实/完善某任务"时，优先产出 set_notes 操作，务必写出完整的 markdown 结构

## 用户附件
用户消息可能附带图片、文本或其它文件。附件会保存到当前工作目录的 \`.attachments/\`，并在消息中提供清单和相对路径：
- 图片会同时作为视觉输入发送；应直接观察图片内容，不要要求用户重复描述
- 文本附件的内容会直接加入上下文；需要完整版本时再使用 read 工具读取文件
- PDF、压缩包等二进制文件可使用 bash 检查或调用工作目录中的工具处理
- 回答时说明你实际使用了哪些附件；如果格式无法读取，明确指出具体文件和原因

## 结构化界面（主动使用）
当指标看板、清单汇总、对比表格、进度总览或数据图表明显比纯文字更清晰时，输出 \`mailuo-ui\` 代码块（内容是 json-render 扁平 spec，root 指向根元素 id，可以混排在正文中间，一次最多 3 块）：
\`\`\`mailuo-ui
{"root":"card1","elements":{"card1":{"type":"Card","props":{"title":"进度总览"},"children":["p1","b1"]},"p1":{"type":"Progress","props":{"label":"整体完成率","percent":40},"children":[]},"b1":{"type":"Button","props":{"label":"新建周报任务"},"on":{"press":{"action":"create_task","params":{"title":"写周报","priority":"normal"}}},"children":[]}}}
\`\`\`

${UI_CATALOG_PROMPT}
`;

/** 从助手回复中拆出正文、操作列表、图表与结构化界面 */
export function parseAssistantReply(text: string): {
  content: string;
  ops: AssistantOp[];
  uiSpecs: UiSpec[];
} {
  let content = text;
  let ops: AssistantOp[] = [];
  const uiSpecs: UiSpec[] = [];

  // 按优先级尝试多种匹配方式
  let actionMatch: RegExpMatchArray | null = null;

  // 1) 标准 mailuo-actions 围栏
  actionMatch = content.match(/```mailuo-actions\s*([\s\S]*?)```/);

  // 2) 包含 "ops" 的 json 围栏（模型可能用普通 json 块）
  if (!actionMatch) {
    const m = content.match(/```json\s*([\s\S]*?)```/g);
    if (m) {
      for (const block of m.reverse()) {
        if (/"[oO][pP][sS]"/.test(block)) {
          actionMatch = block.match(/```json\s*([\s\S]*?)```/);
          break;
        }
      }
    }
  }

  // 3) 末尾裸 JSON 对象（含 "ops" 键）
  if (!actionMatch) {
    const m = content.match(/\{\s*"[oO][pP][sS]"\s*:\s*\[[\s\S]*?\]\s*\}(?:\s*)$/);
    if (m) actionMatch = m;
  }

  if (actionMatch) {
    try {
      const parsed = JSON.parse(actionMatch[1]) as { ops?: AssistantOp[] };
      ops = Array.isArray(parsed.ops) ? parsed.ops.slice(0, 200) : [];
    } catch {
      ops = [];
    }
    content = content.replace(actionMatch[0], "");
  }

  for (const m of content.matchAll(/```mailuo-ui\s*([\s\S]*?)```/g)) {
    try {
      const spec = sanitizeUiSpec(JSON.parse(m[1]));
      if (spec) uiSpecs.push(spec);
    } catch {
      // 忽略坏界面块
    }
  }
  content = content.replace(/```mailuo-ui\s*[\s\S]*?```/g, "");

  return {
    content: content.trim(),
    ops,
    uiSpecs: uiSpecs.slice(0, 3),
  };
}

function findByTitle(list: Task[], title: string | undefined): Task | null {
  if (!title) return null;
  const t = title.trim();
  return (
    list.find((x) => x.title === t) ??
    list.find((x) => x.title.includes(t) || t.includes(x.title)) ??
    null
  );
}

/** 执行助手提出的操作，返回执行摘要 */
export function applyAssistantOps(
  projectId: string,
  ops: AssistantOp[]
): string {
  let done = 0;
  let skipped = 0;
  for (const op of ops) {
    const store = useAppStore.getState();
    const list = store.tasks.filter((t) => t.projectId === projectId);
    switch (op.op) {
      case "create_task": {
        if (!op.title?.trim()) {
          skipped++;
          break;
        }
        if (store.selectedProjectId !== projectId)
          useAppStore.setState({ selectedProjectId: projectId });
        const task = useAppStore.getState().addTask(op.title, {
          notes: op.notes ?? "",
          priority: op.priority ?? "normal",
          tags: Array.isArray(op.tags)
            ? [...new Set(op.tags.map((t) => t.trim()).filter(Boolean).slice(0, 10))]
            : [],
        });
        if (task && op.depends_on) {
          const dep = findByTitle(list, op.depends_on);
          if (dep) useAppStore.getState().addDep(task.id, dep.id);
        }
        if (task && Array.isArray(op.tags)) {
          useAppStore.getState().addTagsToLibrary(
            op.tags.map((t) => t.trim()).filter(Boolean)
          );
        }
        task ? done++ : skipped++;
        break;
      }
      case "set_status": {
        const t = findByTitle(list, op.task);
        if (t && op.status && ["todo", "doing", "done"].includes(op.status)) {
          store.setStatus(t.id, op.status) ? done++ : skipped++;
        } else skipped++;
        break;
      }
      case "set_priority": {
        const t = findByTitle(list, op.task);
        if (t && op.priority && ["high", "normal", "low"].includes(op.priority)) {
          store.setPriority(t.id, op.priority);
          done++;
        } else skipped++;
        break;
      }
      case "set_due": {
        const t = findByTitle(list, op.task);
        if (t && op.date && /^\d{4}-\d{2}-\d{2}$/.test(op.date)) {
          store.updateTask(t.id, { dueDate: op.date });
          done++;
        } else skipped++;
        break;
      }
      case "add_dep": {
        const t = findByTitle(list, op.task);
        const dep = findByTitle(list, op.depends_on);
        if (t && dep && store.addDep(t.id, dep.id) === "ok") done++;
        else skipped++;
        break;
      }
      case "set_notes": {
        const t = findByTitle(list, op.task);
        if (t && typeof op.notes === "string") {
          store.updateTask(t.id, { notes: op.notes });
          done++;
        } else skipped++;
        break;
      }
      case "delete_task": {
        const t = findByTitle(list, op.task);
        if (t) {
          const result = store.deleteTask(t.id);
          if (result) {
            // 提示可撤销
            done++;
          } else {
            skipped++;
          }
        } else skipped++;
        break;
      }
      case "add_tags": {
        const t = findByTitle(list, op.task);
        if (t && Array.isArray(op.tags) && op.tags.length > 0) {
          const clean = [
            ...new Set(op.tags.map((tag) => tag.trim()).filter(Boolean)),
          ];
          store.addTagsToLibrary(clean);
          for (const tag of clean) store.addTag(t.id, tag);
          done++;
        } else skipped++;
        break;
      }
      case "remove_tags": {
        const t = findByTitle(list, op.task);
        if (t && Array.isArray(op.tags) && op.tags.length > 0) {
          for (const tag of op.tags.map((tag) => tag.trim()).filter(Boolean)) {
            store.removeTag(t.id, tag);
          }
          done++;
        } else skipped++;
        break;
      }
      case "remember": {
        if (op.notes?.trim()) {
          void import("@/lib/bridge").then(({ bridge }) =>
            bridge?.rememberMemory(op.notes!.trim())
          );
          done++;
        } else skipped++;
        break;
      }
      default:
        skipped++;
    }
  }
  return skipped > 0 ? `已执行 ${done} 项，跳过 ${skipped} 项` : `已执行 ${done} 项操作`;
}
