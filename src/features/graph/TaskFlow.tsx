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
  Check,
  Focus,
  LayoutGrid,
  Link2,
  ListPlus,
  NotebookPen,
  Play,
  Plus,
  RotateCcw,
  SquareSplitVertical,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { polishNotesWithToast } from "@/features/tasks/TaskListPanel";
import { useAppStore, type NodePosition, type RemovedTask, type StatusFilter } from "@/store/useAppStore";
import { dependencyChainOf, isBlocked, wouldCreateCycle } from "@/lib/deps";
import type { Task } from "@/types";
import { TaskNode, type TaskNodeType } from "./TaskNode";
import { assignTaskColorSlots } from "./node-colors";
import { layoutWithDagre, NODE_H, NODE_W } from "./layout";

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
      dimmed: highlight !== null && !highlight.has(t.id),
      editing: editingId === t.id,
      onEditDone: (title: string) => editHandlers.done(t.id, title),
      onEditCancel: editHandlers.cancel,
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
  const editHandlers = useMemo(
    () => ({ done: onEditDone, cancel: onEditCancel }),
    [onEditDone, onEditCancel]
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
    selectedIds.forEach((id) => {
      if (store.setStatus(id, "done")) done += 1;
      else blocked += 1;
    });
    if (done === 0) toast.error("所选任务均受阻，无法完成");
    else if (blocked > 0) toast.success(`已完成 ${done} 项，${blocked} 项受阻未完成`);
    else toast.success(`已完成 ${done} 项`);
  }, [selectedIds]);

  const batchDelete = useCallback(() => {
    const store = useAppStore.getState();
    const removed = selectedIds
      .map((id) => store.deleteTask(id))
      .filter((r): r is RemovedTask => r !== null);
    if (removed.length === 0) return;
    toast(`已删除 ${removed.length} 个任务`, {
      action: {
        label: "撤销",
        onClick: () => removed.forEach((r) => store.restoreTask(r)),
      },
    });
  }, [selectedIds]);

  // 键盘导航：方向键 / Tab 在节点间移动选中
  const visibleOrder = useMemo(() => graph.nodes.map((n) => n.id), [graph.nodes]);
  const onFlowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (menu || editingId) return;
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
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
    [menu, editingId, visibleOrder, selectedTaskId, selectTask, graph.nodes, setCenter, getViewport]
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

      {/* 批量操作条（多选时） */}
      {selectedIds.length > 1 && (
        <div className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border bg-card/80 px-2 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <span className="px-1.5">已选 {selectedIds.length} 项</span>
          <button
            className="rounded-full px-2 py-0.5 hover:bg-accent hover:text-foreground"
            onClick={batchComplete}
          >
            标记完成
          </button>
          <button
            className="rounded-full px-2 py-0.5 text-destructive hover:bg-destructive/10"
            onClick={batchDelete}
          >
            删除
          </button>
          <button
            className="rounded-full px-2 py-0.5 hover:bg-accent hover:text-foreground"
            onClick={() => useAppStore.getState().selectTask(null)}
          >
            清除选择
          </button>
        </div>
      )}

      {/* 操作提示 */}
      {tasks.length > 0 && selectedIds.length <= 1 && (
        <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
          {direction === "LR"
            ? "从节点右侧拖出连线以建立依赖"
            : "从节点底部拖出连线以建立依赖"}
          {" · "}双击节点改名 · 选中连线按 ⌫ 移除 · Shift 拖拽多选
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
                const s = useAppStore.getState();
                const close = () => setMenu(null);
                return (
                  <>
                    {task.status !== "doing" && task.status !== "done" && (
                      <MenuButton
                        icon={Play}
                        label="开始进行"
                        onClick={() => {
                          s.setStatus(task.id, "doing");
                          close();
                        }}
                      />
                    )}
                    {task.status !== "done" ? (
                      <MenuButton
                        icon={Check}
                        label="标记完成"
                        disabled={blocked}
                        onClick={() => {
                          s.setStatus(task.id, "done");
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
                    )}
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
                      label="聚焦此任务链路"
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
