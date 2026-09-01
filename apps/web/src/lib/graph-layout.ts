export type LayoutNode = {
  id: string;
  label: string;
  nodeType: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type LayoutEdge = {
  id: string;
  fromId: string;
  toId: string;
  label: string;
  verified: boolean;
};

const COLUMN_ORDER = [
  "person",
  "client",
  "organization",
  "document",
  "event",
  "deadline",
  "fact",
  "task",
  "matter",
  "other",
];

function columnIndex(nodeType: string): number {
  const idx = COLUMN_ORDER.indexOf(nodeType.toLowerCase());
  return idx >= 0 ? idx : COLUMN_ORDER.indexOf("other");
}

export function layoutCaseGraph(params: {
  nodes: Array<{ id: string; displayName: string; nodeType: string }>;
  width: number;
  height: number;
}): LayoutNode[] {
  const width = Math.max(params.width, 640);
  const columns = new Map<number, Array<{ id: string; displayName: string; nodeType: string }>>();
  for (const node of params.nodes) {
    const idx = columnIndex(node.nodeType);
    const list = columns.get(idx) ?? [];
    list.push(node);
    columns.set(idx, list);
  }
  const usedColumns = [...columns.keys()].sort((a, b) => a - b);
  const colCount = Math.max(usedColumns.length, 1);
  const colWidth = width / colCount;
  const nodeWidth = Math.min(168, Math.max(120, colWidth - 28));
  const nodeHeight = 44;
  const laid: LayoutNode[] = [];

  usedColumns.forEach((col, visualCol) => {
    const items = columns.get(col) ?? [];
    const gap = 16;
    const totalHeight = items.length * (nodeHeight + gap) - gap;
    const startY = Math.max(24, (Math.max(params.height, totalHeight + 48) - totalHeight) / 2);
    items.forEach((node, row) => {
      laid.push({
        id: node.id,
        label: node.displayName,
        nodeType: node.nodeType,
        x: visualCol * colWidth + (colWidth - nodeWidth) / 2,
        y: startY + row * (nodeHeight + gap),
        width: nodeWidth,
        height: nodeHeight,
      });
    });
  });
  return laid;
}

export function edgePath(
  from: Pick<LayoutNode, "x" | "y" | "width" | "height">,
  to: Pick<LayoutNode, "x" | "y" | "width" | "height">,
): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

export function graphCanvasHeight(nodeCount: number): number {
  return Math.max(420, 72 + nodeCount * 18);
}
