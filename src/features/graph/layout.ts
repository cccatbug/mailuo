import dagre from "@dagrejs/dagre";
import type { GraphDirection } from "@/store/useAppStore";

export const NODE_W = 208;
export const NODE_H = 100;

export interface LayoutInput {
  id: string;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

/** dagre 分层布局，返回每个节点的左上角坐标 */
export function layoutWithDagre(
  nodes: LayoutInput[],
  edges: LayoutEdge[],
  direction: GraphDirection
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    nodesep: 28,
    ranksep: direction === "LR" ? 64 : 52,
    marginx: 24,
    marginy: 24,
  });
  nodes.forEach((n) => g.setNode(n.id, { width: NODE_W, height: NODE_H }));
  edges.forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);

  const pos = new Map<string, { x: number; y: number }>();
  nodes.forEach((n) => {
    const p = g.node(n.id);
    pos.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  });
  return pos;
}
