import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type OnNodeDrag,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarCheck2,
  Check,
  CopyPlus,
  Focus,
  Gauge,
  LayoutGrid,
  Link2,
  ListPlus,
  NotebookPen,
  Play,
  Plus,
  RotateCcw,
  SquareSplitVertical,
  Trash2,
  Waypoints,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { polishNotesWithToast } from "@/features/tasks/TaskListPanel";
import { useAppStore, type NodePosition, type StatusFilter } from "@/store/useAppStore";
import { dependencyChainOf, isBlocked, wouldCreateCycle } from "@/lib/deps";
import { isSubmitKey } from "@/lib/keyboard";
import { addDaysISO, taskSchedule, todayISO } from "@/lib/task-schedule";
import type { Priority, Task } from "@/types";
import { PRIORITY_LABEL } from "@/types";
import { TaskNode, type TaskNodeType } from "./TaskNode";
import { assignTaskColorSlots } from "./node-colors";
import { layoutWithDagre, NODE_H, NODE_W } from "./layout";
import { taskTrackingSnapshot } from "@/lib/task-tracking";

const nodeTypes = { task: TaskNode };

const FILTER_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "全部" },
  { key: "doing", label: "进行中" },
  { key: "blocked", label: "受阻" },
  { key: "done", label: "已完成" },
];

function applyFilter(
  tasks: Task[],
  filter: StatusFilter,
  byId: Map<string, Task>
): Task[] {
  switch (filter) {
    case "all":
      return tasks;
    case "todo":
      return tasks.filter((t) => t.status === "todo");
    case "doing":
      return tasks.filter((t) => t.status === "doing");
    case "done":
      return tasks.filter((t) => t.status === "done");
    case "blocked":
      return tasks.filter((t) => isBlocked(t, byId));
  }
}

interface EditHandlers {
  done: (id: string, title: string) => void;
  cancel: () => void;
  complete: (id: string) => void;
  addNext: (id: string) => void;
}

function buildGraph(
  tasks: Task[],
  direction: "LR" | "TB",
  selectedIds: string[],
  manualPositions: Record<string, NodePosition>,
  filter: StatusFilter,
  focusTaskId: string | null,
  editingId: string | null,
  editHandlers: EditHandlers
): { nodes: TaskNodeType[]; edges: Edge[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  // 后续任务数：整张图算一次，别让每个节点各自扫一遍全表
  const dependentCount = new Map<string, number>();
  for (const task of tasks) {
    for (const dep of task.deps) {
      dependentCount.set(dep, (dependentCount.get(dep) ?? 0) + 1);
    }
  }
  // 聚焦模式：只看聚焦任务的完整链路
  const focusChain = focusTaskId ? dependencyChainOf(focusTaskId, byId) : null;
  const visible = applyFilter(tasks, filter, byId).filter(
    (t) => focusChain === null || focusChain.has(t.id)
  );
  const edgeList = visible.flatMap((t) =>
    t.deps
      .filter((d) => byId.has(d) && (focusChain === null || focusChain.has(d)))
      .map((d) => ({ source: d, target: t.id }))
  );
  // 位置：手动拖拽过的优先，其余用 dagre（选中/高亮变化不会影响位置）
  const pos = layoutWithDagre(visible, edgeList, direction);
  const colorSlots = assignTaskColorSlots(tasks);
  // 单选时高亮选中任务的完整链路，其余变淡；多选/未选中不高亮
  const highlight =
    selectedIds.length === 1 ? dependencyChainOf(selectedIds[0], byId) : null;
  const selectedSet = new Set(selectedIds);

  const nodes: TaskNodeType[] = visible.map((t) => ({
    id: t.id,
    type: "task",
    position: manualPositions[t.id] ?? pos.get(t.id)!,
    selected: selectedSet.has(t.id),
    deletable: false,
    data: {
      task: t,
      blocked: isBlocked(t, byId),
      direction,
      colorSlot: colorSlots.get(t.id) ?? 0,
      dependents: dependentCount.get(t.id) ?? 0,
      dimmed: highlight !== null && !highlight.has(t.id),
      editing: editingId === t.id,
      onEditDone: (title: string) => editHandlers.done(t.id, title),
      onEditCancel: editHandlers.cancel,
      onComplete: () => editHandlers.complete(t.id),
      onAddNext: () => editHandlers.addNext(t.id),
    },
  }));

  const edges: Edge[] = edgeList.map(({ source, target }) => {
    const dep = byId.get(source)!;
    const to = byId.get(target)!;
    const blocking = dep.status !== "done" && to.status !== "done";
    const settled = dep.status === "done";
    const dimmed =
      highlight !== null &&
      (!highlight.has(source) || !highlight.has(target));
    return {
      id: `${source}->${target}`,
      source,
      target,
      animated: blocking,
      className: dimmed
        ? "dimmed-edge"
        : blocking
          ? highlight !== null
            ? "chain-edge"
            : "blocking"
          : settled
            ? "done-edge"
            : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    };
  });

  return { nodes, edges };
}

interface FlowMenu {
  kind: "node" | "pane" | "deps";
  x: number;
  y: number;
  taskId?: string;
}

function MenuButton({
  icon: Icon,
  label,
  destructive = false,
  disabled = false,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40 ${
        destructive ? "text-destructive" : ""
      }`}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

/**
 * 多选后的批量编辑条。
 *
 * 脉络图上真正费时的不是改一个任务，而是把一整串任务的优先级、期限、标签调成
 * 一致——所以这些字段直接摊在条上，不藏进二级菜单。
 */
function BatchBar({
  count,
  onComplete,
  onDelete,
  onPriority,
  onDue,
  onTag,
  onSelectChain,
  onChain,
  onClear,
}: {
  count: number;
  onComplete: () => void;
  onDelete: () => void;
  onPriority: (priority: Priority) => void;
  onDue: (offset: number | null) => void;
  onTag: (tag: string) => void;
  onSelectChain: () => void;
  onChain: () => void;
  onClear: () => void;
}) {
  const tagLibrary = useAppStore((s) => s.tagLibrary);
  const [tagDraft, setTagDraft] = useState("");
  const [panel, setPanel] = useState<"priority" | "due" | "tag" | null>(null);

  const toggle = (next: typeof panel) =>
    setPanel((current) => (current === next ? null : next));

  const Chip = ({
    active,
    children,
    onClick,
  }: {
    active?: boolean;
    children: React.ReactNode;
    onClick: () => void;
  }) => (
    <button
      className={cn(
        "rounded-full px-2 py-0.5 transition-colors",
        active
          ? "bg-accent font-medium text-accent-foreground"
          : "hover:bg-accent hover:text-foreground"
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );

  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 flex-col items-center gap-1">
      {panel === "priority" && (
        <div className="flex items-center gap-0.5 rounded-full border bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          {(["high", "normal", "low"] as Priority[]).map((priority) => (
            <Chip key={priority} onClick={() => onPriority(priority)}>
              {PRIORITY_LABEL[priority]}
            </Chip>
          ))}
        </div>
      )}
      {panel === "due" && (
        <div className="flex items-center gap-0.5 rounded-full border bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <Chip onClick={() => onDue(0)}>今天</Chip>
          <Chip onClick={() => onDue(1)}>明天</Chip>
          <Chip onClick={() => onDue(7)}>下周</Chip>
          <Chip onClick={() => onDue(30)}>下个月</Chip>
          <Chip onClick={() => onDue(null)}>清除</Chip>
        </div>
      )}
      {panel === "tag" && (
        <div className="flex max-w-md flex-wrap items-center gap-1 rounded-2xl border bg-card/95 px-2 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <input
            value={tagDraft}
            placeholder="新标签，回车添加"
            className="h-6 w-32 rounded-full border border-dashed bg-transparent px-2 text-xs outline-none focus:border-primary"
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (isSubmitKey(event, { allowShift: true }) && tagDraft.trim()) {
                onTag(tagDraft);
                setTagDraft("");
              }
            }}
          />
          {tagLibrary.slice(0, 10).map((tag) => (
            <Chip key={tag} onClick={() => onTag(tag)}>
              ＋{tag}
            </Chip>
          ))}
        </div>
      )}

      <div className="flex items-center gap-0.5 rounded-full border bg-card/95 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
        <span className="px-1.5 tabular-nums">已选 {count} 项</span>
        <span className="mx-0.5 h-3 w-px bg-border" />
        <Chip onClick={onComplete}>完成</Chip>
        <Chip active={panel === "priority"} onClick={() => toggle("priority")}>
          优先级
        </Chip>
        <Chip active={panel === "due"} onClick={() => toggle("due")}>
          期限
        </Chip>
        <Chip active={panel === "tag"} onClick={() => toggle("tag")}>
          标签
        </Chip>
        <span className="mx-0.5 h-3 w-px bg-border" />
        <Chip onClick={onSelectChain}>选整条脉络</Chip>
        <Chip onClick={onChain}>串成一条链</Chip>
        <span className="mx-0.5 h-3 w-px bg-border" />
        <button
          className="rounded-full px-2 py-0.5 text-destructive transition-colors hover:bg-destructive/10"
          onClick={onDelete}
        >
          删除
        </button>
        <Chip onClick={onClear}>取消选择</Chip>
      </div>
    </div>
  );
}

function Flow({ tasks, wrapRef }: { tasks: Task[]; wrapRef: React.RefObject<HTMLDivElement | null> }) {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const selectTask = useAppStore((s) => s.selectTask);
  const direction = useAppStore((s) => s.graphDirection);
  const graphNodePositions = useAppStore((s) => s.graphNodePositions);
  const graphFilter = useAppStore((s) => s.graphFilter);
  const focusTaskId = useAppStore((s) => s.graphFocusTaskId);
  const addDep = useAppStore((s) => s.addDep);
  const removeDep = useAppStore((s) => s.removeDep);
  const [menu, setMenu] = useState<FlowMenu | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 图内选中（含多选）。单选与侧栏 selectedTaskId 联动
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    selectedTaskId ? [selectedTaskId] : []
  );

  const { fitView, setCenter, getViewport } = useReactFlow();
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  // 拖拽中暂停按 props 重建节点，避免选中变化把被拖节点拉回旧位置
  const draggingRef = useRef(false);

  const onEditDone = useCallback((id: string, title: string) => {
    useAppStore.getState().updateTask(id, { title });
    setEditingId(null);
  }, []);
  const onEditCancel = useCallback(() => setEditingId(null), []);

  /** 卡片上的「完成」按钮：三种任务类型各有各的完成方式 */
  const onQuickComplete = useCallback((id: string) => {
    const store = useAppStore.getState();
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task) return;
    if (task.tracking.type === "checkin") {
      store.trackTask(id, { type: "toggle-checkin" });
      return;
    }
    if (task.tracking.type === "progress") {
      store.selectTask(id);
      toast.info("在右侧详情里调整进度");
      return;
    }
    if (task.status === "done") {
      store.setStatus(id, "todo");
      return;
    }
    if (!store.setStatus(id, "done")) {
      toast.warning("前置任务未完成，暂不可完成");
    } else if (taskSchedule(task).type === "recurring") {
      toast.success("已完成本轮，下次处理日已顺延");
    }
  }, []);

  /**
   * 从一个节点长出下一环。
   *
   * 「快速编织一整条脉络」靠的就是它：建任务、连依赖、进入改名，一次点击接一环。
   */
  const onAddNext = useCallback((id: string) => {
    const store = useAppStore.getState();
    const source = store.tasks.find((candidate) => candidate.id === id);
    if (!source) return;
    if (store.graphFocusTaskId) store.setGraphFocus(null);
    const task = store.addTask("新任务", { priority: source.priority });
    if (!task) return;
    store.addDep(task.id, id);
    setEditingId(task.id);
  }, []);

  const editHandlers = useMemo(
    () => ({
      done: onEditDone,
      cancel: onEditCancel,
      complete: onQuickComplete,
      addNext: onAddNext,
    }),
    [onEditDone, onEditCancel, onQuickComplete, onAddNext]
  );

  const graph = useMemo(
    () =>
      buildGraph(
        tasks,
        direction,
        selectedIds,
        graphNodePositions,
        graphFilter,
        focusTaskId,
        editingId,
        editHandlers
      ),
    [
      tasks,
      direction,
      selectedIds,
      graphNodePositions,
      graphFilter,
      focusTaskId,
      editingId,
      editHandlers,
    ]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);
  // 最新选中值的稳定镜像：供稳定的 onSelectionChange 回调读取
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

  useEffect(() => {
    if (draggingRef.current) return;
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

  // 侧栏等其他入口选中任务时，图中同步单选；图内多选不受影响
  useEffect(() => {
    setSelectedIds((prev) => {
      if (selectedTaskId === null) return prev.length === 0 ? prev : [];
      if (prev.length === 1 && prev[0] === selectedTaskId) return prev;
      return [selectedTaskId];
    });
  }, [selectedTaskId]);

  // 聚焦/改名目标被删后自动退出
  useEffect(() => {
    if (focusTaskId && !byId.has(focusTaskId)) {
      useAppStore.getState().setGraphFocus(null);
    }
    if (editingId && !byId.has(editingId)) setEditingId(null);
  }, [focusTaskId, editingId, byId]);

  // 布局方向变化后自动适配视野（初次渲染交给 fitView prop，避免竞态）
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [direction, fitView]);

  // 栏头「适配视野」按钮通过全局事件触发（工具条在面板 header，拿不到 flow 实例）
  useEffect(() => {
    const onFit = () => void fitView({ padding: 0.15, duration: 300 });
    window.addEventListener("mailuo:fitview", onFit);
    return () => window.removeEventListener("mailuo:fitview", onFit);
  }, [fitView]);

  const isValidConnection: IsValidConnection = useCallback(
    (conn) => {
      if (!conn.source || !conn.target || conn.source === conn.target)
        return false;
      return !wouldCreateCycle(conn.target, conn.source, byId);
    },
    [byId]
  );

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const result = addDep(conn.target, conn.source);
      if (result === "ok") {
        toast.success("已建立依赖", {
          description: `「${byId.get(conn.target)?.title}」现在依赖「${byId.get(conn.source)?.title}」`,
        });
      } else if (result === "cycle") {
        toast.error("无法建立依赖：会形成循环");
      }
    },
    [addDep, byId]
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (deleted.length === 0) return;
      deleted.forEach((e) => removeDep(e.target, e.source));
      toast(`已移除 ${deleted.length} 条依赖`, {
        action: {
          label: "撤销",
          onClick: () => {
            const store = useAppStore.getState();
            deleted.forEach((e) => {
              if (e.source && e.target) store.addDep(e.target, e.source);
            });
          },
        },
      });
    },
    [removeDep]
  );

  // 图内选中变化：单选联动侧栏；多选/连边选中只记节点（批量条用）
  // 点空白不清空详情面板：任务保持选中，直到点击新任务才切换
  // 注意：handler 必须保持稳定引用 —— xyflow 的 SelectionListener 会把
  // onSelectionChange 放进 effect 依赖，函数每次变化都会重复触发，导致死循环
  const onSelectionChange = useCallback(
    ({ nodes: sel, edges: selEdges }: { nodes: TaskNodeType[]; edges: Edge[] }) => {
      const ids = sel.map((n) => n.id);
      const setIfChanged = (next: string[]) =>
        setSelectedIds((prev) => {
          if (
            prev.length === next.length &&
            prev.every((id, i) => id === next[i])
          ) {
            return prev;
          }
          return next;
        });
      if (selEdges.length > 0) {
        // 框选常连带选中连线，此时只记录节点选中
        setIfChanged(ids.length > 0 ? ids : selectedIdsRef.current);
        return;
      }
      const store = useAppStore.getState();
      if (ids.length === 1) {
        setIfChanged(ids);
        if (store.selectedTaskId !== ids[0]) store.selectTask(ids[0]);
      } else if (ids.length > 1) {
        setIfChanged(ids);
      } else {
        // 点空白：保留当前选中并重新点亮（React Flow 已内部取消选中），不清空详情
        const keep =
          selectedIdsRef.current.length > 0
            ? selectedIdsRef.current
            : store.selectedTaskId
              ? [store.selectedTaskId]
              : [];
        if (keep.length > 0) {
          const keepSet = new Set(keep);
          setNodes((nds) =>
            nds.map((n) => ({ ...n, selected: keepSet.has(n.id) }))
          );
        }
      }
    },
    []
  );

  // 拖拽结束落库，组拖动时把选中节点一并保存
  const onNodeDragStart: OnNodeDrag<TaskNodeType> = useCallback(() => {
    draggingRef.current = true;
  }, []);
  const onNodeDragStop: OnNodeDrag<TaskNodeType> = useCallback(
    (_event, node, allNodes) => {
      draggingRef.current = false;
      const selected = allNodes.filter((n) => n.selected);
      const store = useAppStore.getState();
      const next: Record<string, NodePosition> = {};
      (selected.length > 1 ? selected : [node]).forEach(
        (n) => (next[n.id] = n.position)
      );
      store.setGraphNodePositions(next);
    },
    []
  );

  const batchComplete = useCallback(() => {
    const store = useAppStore.getState();
    let done = 0;
    let blocked = 0;
    let tracked = 0;
    selectedIds.forEach((id) => {
      const task = store.tasks.find((candidate) => candidate.id === id);
      if (task?.tracking.type !== "standard") {
        tracked += 1;
      } else if (store.setStatus(id, "done")) {
        done += 1;
      } else {
        blocked += 1;
      }
    });
    if (done === 0 && tracked > 0 && blocked === 0) {
      toast.info("进度与打卡任务需要分别记录，已保留原状态");
    } else if (done === 0) {
      toast.error("所选普通任务均受阻，无法完成");
    } else {
      const remainder = [
        blocked > 0 ? `${blocked} 项受阻` : "",
        tracked > 0 ? `${tracked} 项需单独记录` : "",
      ].filter(Boolean);
      toast.success(
        `已完成 ${done} 项${remainder.length ? `，${remainder.join("，")}` : ""}`
      );
    }
  }, [selectedIds]);

  const batchDelete = useCallback(() => {
    const store = useAppStore.getState();
    const removed = store.deleteTasks(selectedIds);
    if (removed.length === 0) return;
    toast(`已删除 ${removed.length} 个任务`, {
      action: {
        label: "撤销",
        onClick: () => store.restoreTasks(removed),
      },
    });
  }, [selectedIds]);

  const batchPriority = useCallback(
    (priority: Priority) => {
      const store = useAppStore.getState();
      selectedIds.forEach((id) => store.setPriority(id, priority));
      toast.success(`已把 ${selectedIds.length} 项设为「${PRIORITY_LABEL[priority]}」`);
    },
    [selectedIds]
  );

  const batchDue = useCallback(
    (offset: number | null) => {
      const store = useAppStore.getState();
      const due = offset === null ? null : addDaysISO(todayISO(), offset);
      selectedIds.forEach((id) => store.updateTask(id, { dueDate: due }));
      toast.success(
        due
          ? `已把 ${selectedIds.length} 项的期限设为 ${due.slice(5).replace("-", "/")}`
          : `已清除 ${selectedIds.length} 项的期限`
      );
    },
    [selectedIds]
  );

  const batchTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (!trimmed) return;
      const store = useAppStore.getState();
      selectedIds.forEach((id) => store.addTag(id, trimmed));
      toast.success(`已给 ${selectedIds.length} 项加上「${trimmed}」`);
    },
    [selectedIds]
  );

  /** 把当前选中扩展成完整依赖链路：编辑一整条脉络前先一次选齐 */
  const selectChain = useCallback(() => {
    const seeds = selectedIds.length > 0 ? selectedIds : selectedTaskId ? [selectedTaskId] : [];
    if (seeds.length === 0) return;
    const chain = new Set<string>();
    for (const id of seeds) {
      for (const member of dependencyChainOf(id, byId)) chain.add(member);
    }
    const ids = [...chain];
    setSelectedIds(ids);
    const chainSet = new Set(ids);
    setNodes((nds) => nds.map((n) => ({ ...n, selected: chainSet.has(n.id) })));
    toast.success(`已选中整条脉络，共 ${ids.length} 项`);
  }, [selectedIds, selectedTaskId, byId, setNodes]);

  /** 串成一条链：按当前选中顺序依次建立依赖 */
  const chainSelected = useCallback(() => {
    const store = useAppStore.getState();
    // 选中顺序不可靠，按图上的排布顺序串才符合直觉
    const selected = new Set(selectedIds);
    const ordered = [...graph.nodes]
      .filter((node) => selected.has(node.id))
      .sort((a, b) =>
        direction === "LR"
          ? a.position.x - b.position.x || a.position.y - b.position.y
          : a.position.y - b.position.y || a.position.x - b.position.x
      )
      .map((node) => node.id);
    let linked = 0;
    let refused = 0;
    for (let index = 1; index < ordered.length; index += 1) {
      const result = store.addDep(ordered[index], ordered[index - 1]);
      if (result === "ok") linked += 1;
      else if (result === "cycle") refused += 1;
    }
    if (linked === 0) {
      toast.info(refused > 0 ? "无法串联：会形成循环" : "这些任务已经串好了");
      return;
    }
    toast.success(
      `已串联 ${linked} 条依赖${refused > 0 ? `，${refused} 条会成环已跳过` : ""}`
    );
  }, [graph.nodes, selectedIds, direction]);

  // 键盘导航：方向键 / Tab 在节点间移动选中
  const visibleOrder = useMemo(() => graph.nodes.map((n) => n.id), [graph.nodes]);
  const onFlowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (menu || editingId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      // 单键快捷编辑：手不用离开图就能接链、改名、完成、选整条脉络
      if (!e.metaKey && !e.ctrlKey && !e.altKey) {
        const key = e.key.toLowerCase();
        if (key === "n" && selectedTaskId) {
          e.preventDefault();
          onAddNext(selectedTaskId);
          return;
        }
        if (key === "e" && selectedTaskId) {
          e.preventDefault();
          setEditingId(selectedTaskId);
          return;
        }
        if (key === "c" && (selectedTaskId || selectedIds.length > 0)) {
          e.preventDefault();
          selectChain();
          return;
        }
        if (e.key === " " && selectedTaskId) {
          e.preventDefault();
          onQuickComplete(selectedTaskId);
          return;
        }
        if (key === "f" && selectedTaskId) {
          e.preventDefault();
          useAppStore.getState().setGraphFocus(selectedTaskId);
          setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 60);
          return;
        }
        if (e.key === "Escape" && focusTaskId) {
          e.preventDefault();
          useAppStore.getState().setGraphFocus(null);
          return;
        }
      }
      if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Tab"].includes(e.key))
        return;
      const ids = visibleOrder;
      if (ids.length === 0) return;
      const idx = selectedTaskId ? ids.indexOf(selectedTaskId) : -1;
      const forward =
        e.key === "ArrowRight" ||
        e.key === "ArrowDown" ||
        (e.key === "Tab" && !e.shiftKey);
      const next = idx === -1 ? (forward ? 0 : ids.length - 1) : (idx + (forward ? 1 : -1) + ids.length) % ids.length;
      e.preventDefault();
      const id = ids[next];
      selectTask(id);
      // 目标不在视野内时平移过去
      const node = graph.nodes.find((n) => n.id === id);
      if (node) {
        const vp = getViewport();
        const w = wrapRef.current?.clientWidth ?? 0;
        const h = wrapRef.current?.clientHeight ?? 0;
        const nx = node.position.x * vp.zoom + vp.x;
        const ny = node.position.y * vp.zoom + vp.y;
        const nw = NODE_W * vp.zoom;
        const nh = NODE_H * vp.zoom;
        if (nx < -40 || ny < -40 || nx + nw > w + 40 || ny + nh > h + 40) {
          setCenter(node.position.x + NODE_W / 2, node.position.y + NODE_H / 2, {
            duration: 150,
          });
        }
      }
    },
    [
      menu,
      editingId,
      visibleOrder,
      selectedTaskId,
      selectedIds,
      selectTask,
      graph.nodes,
      setCenter,
      getViewport,
      wrapRef,
      onAddNext,
      onQuickComplete,
      selectChain,
      fitView,
      focusTaskId,
    ]
  );

  const focusTask = focusTaskId ? byId.get(focusTaskId) : null;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onEdgesDelete={onEdgesDelete}
      isValidConnection={isValidConnection}
      onSelectionChange={onSelectionChange}
      onNodeDoubleClick={(_, node) => setEditingId(node.id)}
      onNodeDragStart={onNodeDragStart}
      onNodeDragStop={onNodeDragStop}
      onPaneClick={() => setMenu(null)}
      onNodeContextMenu={(e, node) => {
        e.preventDefault();
        selectTask(node.id);
        setMenu({ kind: "node", x: e.clientX, y: e.clientY, taskId: node.id });
      }}
      onPaneContextMenu={(e) => {
        e.preventDefault();
        setMenu({ kind: "pane", x: e.clientX, y: e.clientY });
      }}
      onMoveStart={() => setMenu(null)}
      onKeyDown={onFlowKeyDown}
      nodesConnectable
      nodesDraggable
      edgesFocusable
      selectionOnDrag
      selectionMode={SelectionMode.Partial}
      selectionKeyCode="Shift"
      multiSelectionKeyCode={["Meta", "Ctrl", "Shift"]}
      deleteKeyCode={["Backspace", "Delete"]}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.3}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        nodeColor={(n) => {
          const slot = (n as TaskNodeType).data?.colorSlot;
          return typeof slot === "number"
            ? `var(--graph-node-${slot + 1})`
            : "var(--muted)";
        }}
        maskColor="color-mix(in oklch, var(--background) 75%, transparent)"
        bgColor="var(--card)"
      />

      {/* 聚焦模式提示条 */}
      {focusTask && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <Focus className="size-3.5 text-primary" />
          <span className="max-w-60 truncate">
            聚焦于「{focusTask.title}」· 共 {graph.nodes.length} 个任务
          </span>
          <button
            className="rounded-full p-0.5 hover:bg-accent hover:text-foreground"
            onClick={() => {
              useAppStore.getState().setGraphFocus(null);
              setTimeout(
                () => fitView({ padding: 0.15, duration: 300 }),
                60
              );
            }}
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {/* 状态过滤 chips（聚焦时隐藏，聚焦已承担筛选职责；无结果显示清除提示） */}
      {!focusTaskId && tasks.length > 0 && graph.nodes.length > 0 && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-card/80 p-1 text-xs backdrop-blur">
          {FILTER_CHIPS.map((c) => (
            <button
              key={c.key}
              className={cn(
                "rounded-full px-2.5 py-0.5 transition-colors",
                graphFilter === c.key
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
              onClick={() => useAppStore.getState().setGraphFilter(c.key)}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {/* 筛选后无结果 */}
      {graph.nodes.length === 0 && tasks.length > 0 && !focusTaskId && (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          <span>没有匹配的任务</span>
          <button
            className="hover:text-foreground"
            onClick={() => {
              const s = useAppStore.getState();
              s.setGraphFilter("all");
              s.setGraphFocus(null);
            }}
          >
            清除筛选
          </button>
        </div>
      )}

      {/* 空项目 */}
      {tasks.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
          <div className="text-sm text-muted-foreground">
            脉络图还没有任务
          </div>
          <Button
            size="sm"
            className="pointer-events-auto"
            onClick={() => {
              const task = useAppStore.getState().addTask("新任务");
              if (task) toast.success("已添加任务，可在右侧改名");
            }}
          >
            <Plus className="mr-1.5 size-4" />
            添加第一个任务
          </Button>
          <p className="pointer-events-auto text-xs text-muted-foreground/70">
            右键画布可添加任务，拖拽连线可建立依赖
          </p>
        </div>
      )}

      {/* 批量编辑条（多选时）——一次改一整条脉络 */}
      {selectedIds.length > 1 && (
        <BatchBar
          count={selectedIds.length}
          onComplete={batchComplete}
          onDelete={batchDelete}
          onPriority={batchPriority}
          onDue={batchDue}
          onTag={batchTag}
          onSelectChain={selectChain}
          onChain={chainSelected}
          onClear={() => {
            setSelectedIds([]);
            setNodes((nds) => nds.map((n) => ({ ...n, selected: false })));
          }}
        />
      )}

      {/* 操作提示 */}
      {tasks.length > 0 && selectedIds.length <= 1 && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          {direction === "LR" ? "右侧拖出连线建依赖" : "底部拖出连线建依赖"}
          {" · "}双击改名 · N 接下一环 · C 选整条脉络 · Shift 拖拽多选
        </div>
      )}

      {menu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div
            className={cn(
              "fixed z-50 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md",
              menu.kind === "deps" ? "w-60" : "w-44"
            )}
            style={{
              left: Math.min(
                menu.x,
                window.innerWidth - (menu.kind === "deps" ? 248 : 184)
              ),
              top: Math.min(
                menu.y,
                window.innerHeight - (menu.kind === "deps" ? 320 : 220)
              ),
            }}
          >
            {menu.kind === "node" && menu.taskId ? (
              (() => {
                const task = byId.get(menu.taskId);
                if (!task) return null;
                const blocked = isBlocked(task, byId);
                const tracking = taskTrackingSnapshot(task);
                const s = useAppStore.getState();
                const close = () => setMenu(null);
                return (
                  <>
                    {task.tracking.type === "standard" && task.status !== "doing" && task.status !== "done" && (
                      <MenuButton
                        icon={Play}
                        label="开始进行"
                        onClick={() => {
                          s.setStatus(task.id, "doing");
                          close();
                        }}
                      />
                    )}
                    {task.tracking.type === "standard" && (task.status !== "done" ? (
                      <MenuButton
                        icon={Check}
                        label="标记完成"
                        disabled={blocked}
                        onClick={() => {
                          onQuickComplete(task.id);
                          close();
                        }}
                      />
                    ) : (
                      <MenuButton
                        icon={RotateCcw}
                        label="恢复为待办"
                        onClick={() => {
                          s.setStatus(task.id, "todo");
                          close();
                        }}
                      />
                    ))}
                    {task.tracking.type === "checkin" && (
                      <MenuButton
                        icon={CalendarCheck2}
                        label={
                          tracking.checkedInCurrentPeriod
                            ? `撤销${tracking.currentPeriodLabel}打卡`
                            : `${tracking.currentPeriodLabel}打卡`
                        }
                        onClick={() => {
                          s.trackTask(task.id, { type: "toggle-checkin" });
                          close();
                        }}
                      />
                    )}
                    {task.tracking.type === "progress" && (
                      <MenuButton
                        icon={Gauge}
                        label={`调整进度 · ${tracking.summary}`}
                        onClick={() => {
                          s.selectTask(task.id);
                          close();
                        }}
                      />
                    )}
                    <div className="my-1 h-px bg-border" />
                    <MenuButton
                      icon={Plus}
                      label="接一个后继任务（N）"
                      onClick={() => {
                        onAddNext(task.id);
                        close();
                      }}
                    />
                    <MenuButton
                      icon={NotebookPen}
                      label="重命名（E）"
                      onClick={() => {
                        setEditingId(task.id);
                        close();
                      }}
                    />
                    <MenuButton
                      icon={CopyPlus}
                      label="复制任务"
                      onClick={() => {
                        const copy = s.duplicateTask(task.id);
                        if (copy) toast.success("已创建副本");
                        close();
                      }}
                    />
                    <MenuButton
                      icon={Waypoints}
                      label="选中整条脉络（C）"
                      onClick={() => {
                        s.selectTask(task.id);
                        setTimeout(selectChain, 0);
                        close();
                      }}
                    />
                    <div className="my-1 h-px bg-border" />
                    <MenuButton
                      icon={SquareSplitVertical}
                      label="AI 拆解为子任务"
                      onClick={() => {
                        s.setAiDialog({ type: "breakdown", taskId: task.id });
                        close();
                      }}
                    />
                    <MenuButton
                      icon={NotebookPen}
                      label="AI 润色备注"
                      onClick={() => {
                        polishNotesWithToast(task.id);
                        close();
                      }}
                    />
                    <div className="my-1 h-px bg-border" />
                    <MenuButton
                      icon={Link2}
                      label={`管理依赖（${task.deps.length}）`}
                      onClick={() =>
                        setMenu({ ...menu, kind: "deps", taskId: task.id })
                      }
                    />
                    <MenuButton
                      icon={Focus}
                      label="聚焦此任务链路（F）"
                      onClick={() => {
                        s.setGraphFocus(task.id);
                        close();
                        setTimeout(
                          () => fitView({ padding: 0.15, duration: 300 }),
                          60
                        );
                      }}
                    />
                    <div className="my-1 h-px bg-border" />
                    <MenuButton
                      icon={Trash2}
                      label="删除任务"
                      destructive
                      onClick={() => {
                        const removed = s.deleteTask(task.id);
                        if (removed) {
                          toast(`已删除「${removed.task.title}」`, {
                            action: {
                              label: "撤销",
                              onClick: () => s.restoreTask(removed),
                            },
                          });
                        }
                        close();
                      }}
                    />
                  </>
                );
              })()
            ) : menu.kind === "deps" && menu.taskId ? (
              (() => {
                const task = byId.get(menu.taskId);
                if (!task) return null;
                const deps = task.deps
                  .map((id) => byId.get(id))
                  .filter((t): t is Task => t !== undefined);
                const s = useAppStore.getState();
                return (
                  <>
                    <div className="flex items-center gap-1 border-b px-2 py-1.5 text-xs font-medium text-muted-foreground">
                      <button
                        className="rounded p-0.5 hover:bg-accent hover:text-foreground"
                        onClick={() => setMenu({ ...menu, kind: "node" })}
                      >
                        <ArrowLeft className="size-3.5" />
                      </button>
                      <span className="truncate">「{task.title}」的前置依赖</span>
                    </div>
                    {deps.length === 0 ? (
                      <div className="px-2.5 py-2 text-xs text-muted-foreground">
                        暂无前置依赖，从节点手柄拖出连线即可添加
                      </div>
                    ) : (
                      deps.map((d) => (
                        <div
                          key={d.id}
                          className="group flex items-center gap-1.5 rounded-md px-2 py-1 hover:bg-accent"
                        >
                          <span className="flex-1 truncate text-sm">{d.title}</span>
                          <button
                            className="rounded p-0.5 text-muted-foreground opacity-60 hover:text-destructive group-hover:opacity-100"
                            onClick={() => {
                              s.removeDep(task.id, d.id);
                              toast(`已移除依赖「${d.title}」`);
                            }}
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      ))
                    )}
                  </>
                );
              })()
            ) : (
              (() => {
                const s = useAppStore.getState();
                const close = () => setMenu(null);
                return (
                  <>
                    <MenuButton
                      icon={Plus}
                      label="添加任务"
                      onClick={() => {
                        // 聚焦时新任务不在链路上，退出聚焦以免任务凭空消失
                        if (s.graphFocusTaskId) s.setGraphFocus(null);
                        const task = s.addTask("新任务");
                        if (task) toast.success("已添加任务，可在右侧改名");
                        close();
                      }}
                    />
                    <MenuButton
                      icon={Waypoints}
                      label="全选"
                      onClick={() => {
                        const ids = graph.nodes.map((node) => node.id);
                        setSelectedIds(ids);
                        setNodes((nds) =>
                          nds.map((node) => ({ ...node, selected: true }))
                        );
                        close();
                      }}
                    />
                    <MenuButton
                      icon={LayoutGrid}
                      label="重新自动排布"
                      onClick={() => {
                        // 清掉手工位置，交回 dagre 重新分层
                        s.setGraphNodePositions({});
                        localStorage.setItem("mailuo-graph-positions", "{}");
                        useAppStore.setState({ graphNodePositions: {} });
                        setTimeout(
                          () => fitView({ padding: 0.15, duration: 300 }),
                          60
                        );
                        toast.success("已恢复自动排布");
                        close();
                      }}
                    />
                    <div className="my-1 h-px bg-border" />
                    <MenuButton
                      icon={ListPlus}
                      label="AI 依赖建议"
                      onClick={() => {
                        if (s.selectedProjectId) {
                          s.setAiDialog({
                            type: "suggestDeps",
                            projectId: s.selectedProjectId,
                          });
                        }
                        close();
                      }}
                    />
                    {s.graphFocusTaskId && (
                      <MenuButton
                        icon={XCircle}
                        label="退出聚焦"
                        onClick={() => {
                          s.setGraphFocus(null);
                          close();
                          setTimeout(
                            () => fitView({ padding: 0.15, duration: 300 }),
                            60
                          );
                        }}
                      />
                    )}
                    <MenuButton
                      icon={LayoutGrid}
                      label="适配视野"
                      onClick={() => {
                        fitView({ padding: 0.15, duration: 300 });
                        close();
                      }}
                    />
                  </>
                );
              })()
            )}
          </div>
        </>
      )}
    </ReactFlow>
  );
}

export function TaskFlow({ tasks }: { tasks: Task[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div className="h-full w-full" ref={wrapRef}>
      <ReactFlowProvider>
        <Flow tasks={tasks} wrapRef={wrapRef} />
      </ReactFlowProvider>
    </div>
  );
}
