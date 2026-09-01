"use client";

import {
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from "react";
import { humanizeKey } from "@/lib/plain-labels";
import { edgePath, graphCanvasHeight, layoutCaseGraph } from "@/lib/graph-layout";
import {
  graphCanvasEdgeLabel,
  graphCanvasEdgeLabelPriority,
  isAlwaysVisibleGraphRelationship,
  pickVisibleGraphEdgeLabelIds,
  shouldShowGraphCanvasEdgeLabel,
} from "@/lib/case-intelligence-ux";

type GraphNode = {
  id: string;
  displayName: string;
  nodeType: string;
};

type GraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  label?: string | null;
  status: string;
};

function nodeFill(nodeType: string): string {
  const type = nodeType.toLowerCase();
  if (type === "person" || type === "client") return "#d7e4dd";
  if (type === "organization") return "#e8efe4";
  if (type === "document") return "#f3eee4";
  if (type === "event" || type === "deadline") return "#efe8dc";
  if (type === "fact") return "#e7ece8";
  return "#f4f1ea";
}

function isVerifiedEdge(status: string): boolean {
  return status === "approved" || status === "edited_and_approved";
}

export function CaseGraphCanvas({
  nodes,
  edges,
  proposedEdges,
  selectedId,
  selectedEdgeId,
  onSelect,
  onSelectEdge,
  showSuggested,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
  proposedEdges: GraphEdge[];
  selectedId: string | null;
  selectedEdgeId?: string | null;
  onSelect: (id: string) => void;
  onSelectEdge?: (id: string) => void;
  showSuggested: boolean;
}) {
  const [pan, setPan] = useState({ x: 24, y: 16 });
  const [zoom, setZoom] = useState(1);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const drag = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const width = 1100;
  const height = graphCanvasHeight(nodes.length);
  const layout = useMemo(() => layoutCaseGraph({ nodes, width, height }), [nodes, width, height]);
  const byId = useMemo(() => new Map(layout.map((n) => [n.id, n])), [layout]);

  const visibleEdges = showSuggested ? [...edges, ...proposedEdges] : edges;

  const edgeViews = useMemo(() => {
    return visibleEdges.flatMap((edge) => {
      const from = byId.get(edge.fromNodeId);
      const to = byId.get(edge.toNodeId);
      if (!from || !to) return [];
      const hovered = hoveredEdgeId === edge.id;
      const selected = selectedEdgeId === edge.id;
      const connectedToSelectedNode = Boolean(
        selectedId && (edge.fromNodeId === selectedId || edge.toNodeId === selectedId),
      );
      const alwaysVisible = isAlwaysVisibleGraphRelationship(edge.relationshipType);
      const showLabel = shouldShowGraphCanvasEdgeLabel({
        relationshipType: edge.relationshipType,
        hovered,
        selected,
        connectedToSelectedNode,
      });
      return [
        {
          edge,
          from,
          to,
          verified: isVerifiedEdge(edge.status),
          label: graphCanvasEdgeLabel(edge.relationshipType),
          midX: (from.x + from.width + to.x) / 2,
          midY: (from.y + from.height / 2 + to.y + to.height / 2) / 2,
          hovered,
          selected,
          showLabel,
          priority: graphCanvasEdgeLabelPriority({
            hovered,
            selected,
            alwaysVisible,
            connectedToSelectedNode,
          }),
        },
      ];
    });
  }, [byId, hoveredEdgeId, selectedEdgeId, selectedId, visibleEdges]);

  const visibleLabelIds = useMemo(() => {
    return pickVisibleGraphEdgeLabelIds(
      edgeViews
        .filter((view) => view.showLabel)
        .map((view) => ({
          id: view.edge.id,
          x: view.midX,
          y: view.midY,
          priority: view.priority,
        })),
    );
  }, [edgeViews]);

  function onPointerDown(event: ReactPointerEvent<SVGSVGElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("[data-node-id]") || target.closest("[data-edge-id]")) return;
    drag.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    setPan({
      x: drag.current.panX + (event.clientX - drag.current.x),
      y: drag.current.panY + (event.clientY - drag.current.y),
    });
  }

  function onPointerUp() {
    drag.current = null;
  }

  function onWheel(event: WheelEvent<SVGSVGElement>) {
    event.preventDefault();
    const next = Math.min(1.8, Math.max(0.55, zoom + (event.deltaY < 0 ? 0.08 : -0.08)));
    setZoom(next);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-white/80">
      <svg
        className="h-[28rem] w-full touch-none cursor-grab active:cursor-grabbing"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Case relationship graph"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {edgeViews.map((view) => {
            const { edge, from, to, verified, label, midX, midY, hovered, selected } = view;
            const showLabel = visibleLabelIds.has(edge.id);
            const trust = verified ? "Verified" : "Suggested by Nyaya";
            return (
              <g
                key={edge.id}
                data-edge-id={edge.id}
                data-relationship-type={edge.relationshipType}
                className="cursor-pointer"
                onPointerEnter={() => setHoveredEdgeId(edge.id)}
                onPointerLeave={() =>
                  setHoveredEdgeId((current) => (current === edge.id ? null : current))
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectEdge?.(edge.id);
                }}
              >
                <title>{`${label} · ${trust}`}</title>
                <path
                  d={edgePath(from, to)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                />
                <path
                  d={edgePath(from, to)}
                  fill="none"
                  stroke={verified ? "var(--ng-accent)" : "#8a5a12"}
                  strokeWidth={
                    verified ? (hovered || selected ? 2.2 : 1.6) : hovered || selected ? 2 : 1.4
                  }
                  strokeDasharray={verified ? undefined : "6 4"}
                  opacity={verified ? 0.85 : 0.7}
                />
                {showLabel ? (
                  <text
                    data-graph-edge-label={edge.id}
                    x={midX}
                    y={midY - 6}
                    textAnchor="middle"
                    className="fill-ink/70"
                    fontSize="10"
                    fontWeight={hovered || selected ? 600 : 500}
                  >
                    {label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {layout.map((node) => {
            const selected = selectedId === node.id;
            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={`translate(${node.x} ${node.y})`}
                className="cursor-pointer"
                role="button"
                tabIndex={0}
                aria-label={`${node.label}, ${humanizeKey(node.nodeType)}`}
                aria-pressed={selected}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(node.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(node.id);
                  }
                }}
              >
                <title>{`${node.label} · ${humanizeKey(node.nodeType)}`}</title>
                <rect
                  width={node.width}
                  height={node.height}
                  rx={8}
                  fill={nodeFill(node.nodeType)}
                  stroke={selected ? "var(--ng-accent)" : "var(--ng-line)"}
                  strokeWidth={selected ? 2 : 1}
                />
                <text x={10} y={18} fontSize="11" className="fill-ink" fontWeight={600}>
                  {node.label.length > 22 ? `${node.label.slice(0, 21)}…` : node.label}
                </text>
                <text x={10} y={33} fontSize="9" className="fill-ink/55">
                  {humanizeKey(node.nodeType)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <p className="border-t border-line px-3 py-2 text-[11px] text-ink/50">
        Drag to pan · scroll to zoom · hover or select a line for the relationship · solid
        connections are verified · dashed connections are suggested by Nyaya
      </p>
    </div>
  );
}
