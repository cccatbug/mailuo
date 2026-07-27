import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { toast } from "sonner";
import {
  Check,
  LayoutGrid,
  ListPlus,
  NotebookPen,
  Play,
  Plus,
  RotateCcw,
  SquareSplitVertical,
  Trash2,
} from "lucide-react";
import { polishNotesWithToast } from "@/features/tasks/TaskListPanel";
import { useAppStore } from "@/store/useAppStore";
import { isBlocked, wouldCreateCycle } from "@/lib/deps";
import type { Task } from "@/types";
import { TaskNode, type TaskNodeType } from "./TaskNode";
import { layoutWithDagre } from "./layout";

const nodeTypes = { task: TaskNode };

function buildGraph(
  tasks: Task[],
  direction: "LR" | "TB",
  selectedTaskId: string | null
): { nodes: TaskNodeType[]; edges: Edge[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const edgeList = tasks.flatMap((t) =>
    t.deps
      .filter((d) => byId.has(d))
      .map((d) => ({ source: d, target: t.id }))
  );
  const pos = layoutWithDagre(tasks, edgeList, direction);

  const nodes: TaskNodeType[] = tasks.map((t) => ({
    id: t.id,
    type: "task",
    position: pos.get(t.id)!,
    selected: t.id === selectedTaskId,
    deletable: false,
    data: { task: t, blocked: isBlocked(t, byId), direction },
  }));

  const edges: Edge[] = edgeList.map(({ source, target }) => {
    const dep = byId.get(source)!;
    const to = byId.get(target)!;
    const blocking = dep.status !== "done" && to.status !== "done";
    const settled = dep.status === "done";
    return {
      id: `${source}->${target}`,
      source,
      target,
      animated: blocking,
      className: blocking ? "blocking" : settled ? "done-edge" : undefined,
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    };
  });

  return { nodes, edges };
}

interface FlowMenu {
  kind: "node" | "pane";
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

function Flow({ tasks }: { tasks: Task[] }) {
  const selectedTaskId = useAppStore((s) => s.selectedTaskId);
  const selectTask = useAppStore((s) => s.selectTask);
  const direction = useAppStore((s) => s.graphDirection);
  const addDep = useAppStore((s) => s.addDep);
  const removeDep = useAppStore((s) => s.removeDep);
  const [menu, setMenu] = useState<FlowMenu | null>(null);

  const { fitView } = useReactFlow();
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const graph = useMemo(
    () => buildGraph(tasks, direction, selectedTaskId),
    [tasks, direction, selectedTaskId]
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
  }, [graph, setNodes, setEdges]);

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
      deleted.forEach((e) => removeDep(e.target, e.source));
      if (deleted.length > 0) toast("已移除依赖");
    },
    [removeDep]
  );

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
      onNodeClick={(_, node) => selectTask(node.id)}
      onPaneClick={() => {
        selectTask(null);
        setMenu(null);
      }}
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
      nodesConnectable
      nodesDraggable
      edgesFocusable
      deleteKeyCode={["Backspace", "Delete"]}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.3}
      maxZoom={1.6}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} />
      <Controls showInteractive={false} position="bottom-left" />
      <MiniMap
        pannable
        zoomable
        position="bottom-right"
        nodeColor={(n) => {
          const task = (n as TaskNodeType).data?.task;
          if (!task) return "var(--muted)";
          if (task.status === "done") return "var(--status-done)";
          if (task.status === "doing") return "var(--status-doing)";
          return "var(--muted-foreground)";
        }}
        maskColor="color-mix(in oklch, var(--background) 75%, transparent)"
        bgColor="var(--card)"
      />
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
            className="fixed z-50 w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
            style={{
              left: Math.min(menu.x, window.innerWidth - 190),
              top: Math.min(menu.y, window.innerHeight - 220),
            }}
          >
            {menu.kind === "node" && menu.taskId ? (
              (() => {
                const task = byId.get(menu.taskId);
                if (!task) return null;
                const blocked = isBlocked(task, byId);
                const store = useAppStore.getState();
                const close = () => setMenu(null);
                return (
                  <>
                    {task.status !== "doing" && task.status !== "done" && (
                      <MenuButton
                        icon={Play}
                        label="开始进行"
                        onClick={() => {
                          store.setStatus(task.id, "doing");
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
                          store.setStatus(task.id, "done");
                          close();
                        }}
                      />
                    ) : (
                      <MenuButton
                        icon={RotateCcw}
                        label="恢复为待办"
                        onClick={() => {
                          store.setStatus(task.id, "todo");
                          close();
                        }}
                      />
                    )}
                    <div className="my-1 h-px bg-border" />
                    <MenuButton
                      icon={SquareSplitVertical}
                      label="AI 拆解为子任务"
                      onClick={() => {
                        store.setAiDialog({ type: "breakdown", taskId: task.id });
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
                      icon={Trash2}
                      label="删除任务"
                      destructive
                      onClick={() => {
                        const removed = store.deleteTask(task.id);
                        if (removed) {
                          toast(`已删除「${removed.task.title}」`, {
                            action: {
                              label: "撤销",
                              onClick: () => store.restoreTask(removed),
                            },
                          });
                        }
                        close();
                      }}
                    />
                  </>
                );
              })()
            ) : (
              <>
                <MenuButton
                  icon={Plus}
                  label="添加任务"
                  onClick={() => {
                    const store = useAppStore.getState();
                    const task = store.addTask("新任务");
                    if (task) toast.success("已添加任务，可在右侧改名");
                    setMenu(null);
                  }}
                />
                <MenuButton
                  icon={ListPlus}
                  label="AI 依赖建议"
                  onClick={() => {
                    const store = useAppStore.getState();
                    if (store.selectedProjectId) {
                      store.setAiDialog({
                        type: "suggestDeps",
                        projectId: store.selectedProjectId,
                      });
                    }
                    setMenu(null);
                  }}
                />
                <MenuButton
                  icon={LayoutGrid}
                  label="适配视野"
                  onClick={() => {
                    fitView({ padding: 0.15, duration: 300 });
                    setMenu(null);
                  }}
                />
              </>
            )}
          </div>
        </>
      )}
      <div className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full border bg-card/80 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
        从节点右侧拖出连线以建立依赖 · 选中连线按 ⌫ 移除
      </div>
    </ReactFlow>
  );
}

export function TaskFlow({ tasks }: { tasks: Task[] }) {
  return (
    <div className="h-full w-full">
      <ReactFlowProvider>
        <Flow tasks={tasks} />
      </ReactFlowProvider>
    </div>
  );
}
