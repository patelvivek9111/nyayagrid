"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Panel } from "@nyayagrid/ui";
import { humanizeKey } from "@/lib/plain-labels";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SourceDrawer,
  SuggestedBadge,
  VerifiedBadge,
  type SourceDrawerItem,
} from "@/components/ux";

type GraphNode = {
  id: string;
  displayName: string;
  nodeType: string;
  canonicalEntityType: string;
  canonicalEntityId: string;
  status?: string;
};

type GraphEdgeSource = {
  id: string;
  documentId: string;
  chunkId: string;
  page: number | null;
  supportingText: string;
  documentTitle?: string;
};

type GraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  label: string | null;
  origin: string;
  status: string;
  badge?: "verified" | "suggested" | "historical";
  fromName?: string;
  toName?: string;
  sources?: GraphEdgeSource[];
};

type Neighborhood = {
  center: GraphNode;
  neighbors: GraphNode[];
  edges: GraphEdge[];
};

function isVerified(status: string) {
  return status === "approved" || status === "edited_and_approved";
}

function nodeHref(
  matterId: string,
  node: Pick<GraphNode, "canonicalEntityType" | "canonicalEntityId">,
) {
  if (node.canonicalEntityType === "matter_entity") {
    return `/app/cases/${matterId}/people?entityId=${node.canonicalEntityId}`;
  }
  if (node.canonicalEntityType === "timeline_event") {
    return `/app/cases/${matterId}/timeline?eventId=${node.canonicalEntityId}`;
  }
  if (node.canonicalEntityType === "document") {
    return `/app/cases/${matterId}/documents`;
  }
  if (node.canonicalEntityType === "task") {
    return `/app/cases/${matterId}/tasks?taskId=${node.canonicalEntityId}`;
  }
  if (node.canonicalEntityType === "deadline_candidate") {
    return `/app/cases/${matterId}/tasks?deadlineId=${node.canonicalEntityId}`;
  }
  return null;
}

function groupNodes(nodes: GraphNode[]) {
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const list = groups.get(node.nodeType) ?? [];
    list.push(node);
    groups.set(node.nodeType, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function CaseGraphPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [proposedEdges, setProposedEdges] = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [neighborhood, setNeighborhood] = useState<Neighborhood | null>(null);
  const [selectedProposed, setSelectedProposed] = useState<GraphEdge | null>(null);
  const [q, setQ] = useState("");
  const [nodeType, setNodeType] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [fromNodeId, setFromNodeId] = useState("");
  const [toNodeId, setToNodeId] = useState("");
  const [relationshipType, setRelationshipType] = useState("related_to");
  const [editLabel, setEditLabel] = useState("");
  const [editRelationship, setEditRelationship] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  async function load() {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (nodeType) qs.set("nodeType", nodeType);
    const res = await fetch(`/api/v1/matters/${matterId}/graph?${qs.toString()}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load graph");
    const nextNodes: GraphNode[] = json.nodes ?? [];
    setNodes(nextNodes);
    setEdges(json.edges ?? []);
    const nextProposed: GraphEdge[] = json.proposedEdges ?? [];
    setProposedEdges(nextProposed);
    return { nextNodes, nextProposed };
  }

  useEffect(() => {
    const nodeId = new URLSearchParams(window.location.search).get("nodeId");
    setLoading(true);
    load()
      .then(({ nextNodes }) => {
        const match = nodeId ? nextNodes.find((n) => n.id === nodeId) : null;
        if (match) return selectNode(match);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load graph"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  const nodeTypes = useMemo(() => [...new Set(nodes.map((n) => n.nodeType))].sort(), [nodes]);

  async function selectNode(node: GraphNode) {
    setSelected(node);
    setSelectedProposed(null);
    setError("");
    const res = await fetch(`/api/v1/matters/${matterId}/graph/nodes/${node.id}`);
    const json = await res.json();
    if (!res.ok) {
      setNeighborhood(null);
      setError(json?.error?.message ?? "Failed to load neighborhood");
      return;
    }
    setNeighborhood(json);
  }

  async function materialize() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/graph`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Materialize failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Materialize failed");
    } finally {
      setBusy(false);
    }
  }

  async function extractRelationships() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/graph/extract`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Extract failed");
      const { nextProposed } = await load();
      if (nextProposed[0]) setSelectedProposed(nextProposed[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extract failed");
    } finally {
      setBusy(false);
    }
  }

  async function createEdge(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/graph/edges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromNodeId, toNodeId, relationshipType }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create edge failed");
      await load();
      if (selected) await selectNode(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create edge failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewEdge(edgeId: string, action: "approve" | "edit_and_approve" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/graph/edges/${edgeId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "edit_and_approve"
            ? {
                action,
                edits: {
                  label: editLabel || null,
                  relationshipType: editRelationship || undefined,
                },
              }
            : { action },
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Review failed");
      await load();
      setSelectedProposed(null);
      if (selected) await selectNode(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  function openSources(sources: GraphEdgeSource[]) {
    setDrawerItems(
      sources.map((s) => ({
        id: s.id,
        title: s.documentTitle ?? "Case document",
        classLabel: "Matter Evidence",
        subtitle: s.page != null ? `Page ${s.page}` : undefined,
        quote: s.supportingText,
        chunkId: s.chunkId,
        documentId: s.documentId,
      })),
    );
    setDrawerOpen(true);
  }

  if (loading) return <LoadingState label="Loading graph…" />;
  if (error && nodes.length === 0 && proposedEdges.length === 0) {
    return <ErrorState message={error} />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-ink">Nyaya Graph</h2>
        <p className="text-sm text-ink/60">
          Who is connected to whom — and which file that comes from. Suggestions stay suggestions
          until you confirm them.
        </p>
      </div>
      {error ? <ErrorState message={error} /> : null}

      <div className="flex flex-wrap gap-2">
        <Button disabled={busy} onClick={materialize}>
          Build from confirmed facts
        </Button>
        <Button disabled={busy} variant="secondary" onClick={extractRelationships}>
          Suggest connections
        </Button>
        <Badge>{nodes.length} nodes</Badge>
        <Badge>{edges.length} verified edges</Badge>
        <Badge>{proposedEdges.length} proposed</Badge>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          className="rounded border border-line px-3 py-1.5 text-sm"
          placeholder="Search people, files, or events"
          aria-label="Search people, files, or events"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => load().catch((err) => setError(err.message))}
        />
        <select
          className="rounded border border-line px-2 py-1.5 text-sm"
          aria-label="Filter graph node type"
          value={nodeType}
          onChange={(e) => {
            setNodeType(e.target.value);
            setTimeout(() => load().catch((err) => setError(err.message)), 0);
          }}
        >
          <option value="">All types</option>
          {nodeTypes.map((type) => (
            <option key={type} value={type}>
              {humanizeKey(type)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <Panel title="Nodes">
            {nodes.length === 0 ? (
              <EmptyState
                title="No graph nodes yet"
                description="Create people, files, events, and facts from what you have already confirmed."
              />
            ) : (
              <div className="max-h-[28rem] space-y-4 overflow-auto">
                {groupNodes(nodes).map(([type, items]) => (
                  <div key={type}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">
                      {type}
                    </p>
                    <ul className="space-y-2 text-sm">
                      {items.map((node) => (
                        <li key={node.id}>
                          <button
                            type="button"
                            className="text-left font-semibold hover:text-accent"
                            onClick={() => selectNode(node)}
                          >
                            {node.displayName}
                          </button>
                          <div className="text-ink/60">{node.canonicalEntityType}</div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Proposed relationships">
            {proposedEdges.length === 0 ? (
              <p className="text-sm text-ink/70">
                No suggested connections yet. After files are processed, use Suggest connections.
                Proposed edges stay Suggested until you approve them — they are never shown as
                Verified.
              </p>
            ) : (
              <ul aria-label="Proposed graph edges" className="space-y-3 text-sm">
                {proposedEdges.map((edge) => (
                  <li
                    key={edge.id}
                    className="rounded border border-amber-700/20 bg-amber-50/40 p-2"
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => {
                        setSelectedProposed(edge);
                        setEditLabel(edge.label ?? "");
                        setEditRelationship(edge.relationshipType);
                      }}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">
                          {edge.fromName} — {humanizeKey(edge.relationshipType)} → {edge.toName}
                        </span>
                        <SuggestedBadge />
                      </div>
                      <p className="mt-1 text-xs text-ink/60">
                        {edge.label || "Proposed relationship"} · {(edge.sources ?? []).length}{" "}
                        source{(edge.sources ?? []).length === 1 ? "" : "s"}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title="Neighborhood">
            {!neighborhood ? (
              <p className="text-sm text-ink/70">
                Select a node to inspect its immediate neighborhood and evidence.
              </p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-semibold">{neighborhood.center.displayName}</div>
                  <div className="text-ink/60">
                    {humanizeKey(neighborhood.center.nodeType)}
                  </div>
                  {(() => {
                    const href = nodeHref(matterId, neighborhood.center);
                    if (!href) return null;
                    const label =
                      neighborhood.center.canonicalEntityType === "matter_entity"
                        ? "Open in People"
                        : neighborhood.center.canonicalEntityType === "timeline_event"
                          ? "Open in Timeline"
                          : neighborhood.center.canonicalEntityType === "document"
                            ? "Open in Documents"
                            : "Open linked record";
                    return (
                      <Link href={href} className="text-xs font-semibold text-accent underline">
                        {label} →
                      </Link>
                    );
                  })()}
                </div>
                {(neighborhood.edges ?? []).length === 0 ? (
                  <p className="text-ink/70">
                    No connected edges yet. Proposed edges appear here as Suggested until approved.
                  </p>
                ) : (
                  <ul className="space-y-3">
                    {neighborhood.edges.map((edge) => {
                      const otherId =
                        edge.fromNodeId === neighborhood.center.id
                          ? edge.toNodeId
                          : edge.fromNodeId;
                      const other = neighborhood.neighbors.find((n) => n.id === otherId);
                      const otherHref = other ? nodeHref(matterId, other) : null;
                      return (
                        <li key={edge.id} className="rounded border border-line p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">
                              {humanizeKey(edge.relationshipType)} → {other?.displayName ?? otherId.slice(0, 8)}
                            </span>
                            {isVerified(edge.status) ? <VerifiedBadge /> : <SuggestedBadge />}
                          </div>
                          <div className="text-ink/60">
                            {edge.origin} · {(edge.sources ?? []).length} sources
                          </div>
                          {otherHref && other ? (
                            <Link
                              href={otherHref}
                              className="text-xs font-semibold text-accent underline"
                            >
                              Open {other.displayName}
                            </Link>
                          ) : null}
                          {(edge.sources ?? []).length > 0 ? (
                            <Button
                              className="mt-2"
                              type="button"
                              variant="secondary"
                              onClick={() => openSources(edge.sources ?? [])}
                            >
                              Inspect sources
                            </Button>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </Panel>

          <Panel title={selectedProposed ? "Review proposed edge" : "Create manual relationship"}>
            {selectedProposed ? (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <SuggestedBadge />
                  <Badge>{selectedProposed.origin}</Badge>
                </div>
                <p>
                  {selectedProposed.fromName} — {humanizeKey(selectedProposed.relationshipType)} →{" "}
                  {selectedProposed.toName}
                </p>
                {(selectedProposed.sources ?? []).length === 0 ? (
                  <p className="text-ink/55">
                    Nyaya cannot confirm this connection until it points to a quote in the files.
                  </p>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openSources(selectedProposed.sources ?? [])}
                  >
                    Inspect sources ({selectedProposed.sources!.length})
                  </Button>
                )}
                <input
                  className="w-full rounded border border-line px-2 py-1.5"
                  aria-label="Edit relationship label"
                  placeholder="Label"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                />
                <input
                  className="w-full rounded border border-line px-2 py-1.5"
                  aria-label="Edit relationship type"
                  placeholder="Relationship type"
                  value={editRelationship}
                  onChange={(e) => setEditRelationship(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => reviewEdge(selectedProposed.id, "approve")}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    variant="secondary"
                    onClick={() => reviewEdge(selectedProposed.id, "edit_and_approve")}
                  >
                    Edit & approve
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    variant="ghost"
                    onClick={() => reviewEdge(selectedProposed.id, "reject")}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            ) : (
              <form className="space-y-2" onSubmit={createEdge}>
                <select
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                  value={fromNodeId}
                  onChange={(e) => setFromNodeId(e.target.value)}
                  required
                >
                  <option value="">From node</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.displayName}
                    </option>
                  ))}
                </select>
                <select
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                  value={toNodeId}
                  onChange={(e) => setToNodeId(e.target.value)}
                  required
                >
                  <option value="">To node</option>
                  {nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.displayName}
                    </option>
                  ))}
                </select>
                <input
                  className="w-full rounded border border-line px-2 py-1.5 text-sm"
                  value={relationshipType}
                  onChange={(e) => setRelationshipType(e.target.value)}
                  required
                />
                <Button disabled={busy} type="submit">
                  Create approved edge
                </Button>
              </form>
            )}
          </Panel>

          <Panel title="Relationship list">
            {edges.length === 0 ? (
              <p className="text-sm text-ink/70">No verified relationships.</p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-auto text-sm">
                {edges.map((edge) => (
                  <li key={edge.id} className="flex flex-wrap items-center gap-2">
                    <span>
                      {edge.fromName} — {humanizeKey(edge.relationshipType)} → {edge.toName}
                    </span>
                    {isVerified(edge.status) ? <VerifiedBadge /> : <SuggestedBadge />}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
