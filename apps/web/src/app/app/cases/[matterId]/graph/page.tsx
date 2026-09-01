"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@nyayagrid/ui";
import { humanizeKey } from "@/lib/plain-labels";
import {
  CaseGraphCanvas,
  EmptyState,
  ErrorState,
  FilterChipBar,
  IntelligenceDialog,
  IntelligenceHeader,
  IntelligenceInspector,
  LoadingState,
  OverflowMenu,
  RelatedList,
  SourceDrawer,
  TrustStatus,
  type SourceDrawerItem,
} from "@/components/ux";
import {
  GRAPH_RELATIONSHIP_OPTIONS,
  askNyayaHref,
  graphNodeFilterType,
  isVerifiedStatus,
  sourceCountLabel,
  trustStatusFromRecord,
  userFacingLoadError,
} from "@/lib/case-intelligence-ux";

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
  fromName?: string;
  toName?: string;
  sources?: GraphEdgeSource[];
};

type Neighborhood = {
  center: GraphNode;
  neighbors: GraphNode[];
  edges: GraphEdge[];
};

type GraphView = "graph" | "connections";
type NodeFilter = "all" | "people" | "organizations" | "documents" | "events" | "facts";

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

export default function CaseGraphPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [proposedEdges, setProposedEdges] = useState<GraphEdge[]>([]);
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [neighborhood, setNeighborhood] = useState<Neighborhood | null>(null);
  const [selectedProposed, setSelectedProposed] = useState<GraphEdge | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphEdge | null>(null);
  const [q, setQ] = useState("");
  const [nodeFilter, setNodeFilter] = useState<NodeFilter>("all");
  const [view, setView] = useState<GraphView>("graph");
  const [showSuggested, setShowSuggested] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
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
    const res = await fetch(`/api/v1/matters/${matterId}/graph?${qs.toString()}`);
    const json = await res.json();
    if (!res.ok) throw new Error(userFacingLoadError("graph", res.status));
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
      .catch((err) => setError(err instanceof Error ? err.message : userFacingLoadError("graph")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  const filteredNodes = useMemo(() => {
    const query = q.trim().toLowerCase();
    return nodes.filter((n) => {
      if (nodeFilter !== "all" && graphNodeFilterType(n.nodeType) !== nodeFilter) return false;
      if (query && !n.displayName.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [nodes, nodeFilter, q]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);
  const visibleEdges = edges.filter(
    (e) => filteredNodeIds.has(e.fromNodeId) && filteredNodeIds.has(e.toNodeId),
  );
  const visibleProposed = proposedEdges.filter(
    (e) => filteredNodeIds.has(e.fromNodeId) && filteredNodeIds.has(e.toNodeId),
  );

  function selectCanvasEdge(edgeId: string) {
    const proposed = proposedEdges.find((edge) => edge.id === edgeId);
    if (proposed) {
      setSelected(null);
      setNeighborhood(null);
      setSelectedEdge(null);
      setSelectedProposed(proposed);
      setEditLabel(proposed.label ?? "");
      setEditRelationship(proposed.relationshipType);
      return;
    }
    const verified = edges.find((edge) => edge.id === edgeId);
    if (!verified) return;
    setSelected(null);
    setNeighborhood(null);
    setSelectedProposed(null);
    setSelectedEdge(verified);
    void loadVerifiedEdgeSources(verified);
  }

  async function loadVerifiedEdgeSources(edge: GraphEdge) {
    if ((edge.sources ?? []).length > 0) return;
    const res = await fetch(`/api/v1/matters/${matterId}/graph/nodes/${edge.fromNodeId}`);
    if (!res.ok) return;
    const json = (await res.json()) as Neighborhood;
    const match = (json.edges ?? []).find((item) => item.id === edge.id);
    const sources = match?.sources;
    if (!sources?.length) return;
    setSelectedEdge((current) =>
      current?.id === edge.id ? { ...current, sources } : current,
    );
  }

  async function selectNode(node: GraphNode) {
    setSelected(node);
    setSelectedProposed(null);
    setSelectedEdge(null);
    setError("");
    const res = await fetch(`/api/v1/matters/${matterId}/graph/nodes/${node.id}`);
    const json = await res.json();
    if (!res.ok) {
      setNeighborhood(null);
      setError(userFacingLoadError("graph"));
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
      if (!res.ok) throw new Error("We couldn't update the graph. Try again.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update the graph. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function extractRelationships() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/graph/extract`, { method: "POST" });
      if (!res.ok) throw new Error("We couldn't suggest connections. Try again.");
      const { nextProposed } = await load();
      if (nextProposed[0]) setSelectedProposed(nextProposed[0]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't suggest connections. Try again.");
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
      if (!res.ok) throw new Error("We couldn't add that connection. Try again.");
      setAddOpen(false);
      await load();
      if (selected) await selectNode(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't add that connection. Try again.");
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
      if (!res.ok) throw new Error("We couldn't update that connection. Try again.");
      await load();
      setSelectedProposed(null);
      if (selected) await selectNode(selected);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We couldn't update that connection. Try again.",
      );
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

  const inspectorOpen = Boolean(selected || selectedProposed || selectedEdge);

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        title="Graph"
        description="How people, documents, events, and facts connect. Dashed lines are suggestions — they are not confirmed."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => setAddOpen(true)}>
              + Add connection
            </Button>
            <OverflowMenu label="Update graph">
              <div className="flex flex-col gap-1">
                <Button type="button" variant="ghost" disabled={busy} onClick={materialize}>
                  Build from confirmed facts
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={extractRelationships}
                >
                  Suggest connections
                </Button>
              </div>
            </OverflowMenu>
          </div>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <FilterChipBar
        value={nodeFilter}
        onChange={(id) => setNodeFilter(id as NodeFilter)}
        search={q}
        searchPlaceholder="Search graph"
        searchLabel="Search graph"
        onSearchChange={setQ}
        options={[
          { id: "all", label: "All", count: nodes.length },
          { id: "people", label: "People" },
          { id: "organizations", label: "Organizations" },
          { id: "documents", label: "Documents" },
          { id: "events", label: "Events" },
          { id: "facts", label: "Facts" },
        ]}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
            view === "graph" ? "border-accent bg-accent-soft/50" : "border-line bg-white"
          }`}
          onClick={() => setView("graph")}
        >
          Graph
        </button>
        <button
          type="button"
          className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
            view === "connections" ? "border-accent bg-accent-soft/50" : "border-line bg-white"
          }`}
          onClick={() => setView("connections")}
        >
          Connections
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink/65">
          <input
            type="checkbox"
            checked={showSuggested}
            onChange={(e) => setShowSuggested(e.target.checked)}
          />
          Show suggested connections
        </label>
      </div>

      {nodes.length === 0 ? (
        <EmptyState
          title="Connections will appear as case intelligence is confirmed."
          description="Verify people, events, and facts, then update the graph. Suggested connections stay visually distinct until you accept them."
          action={
            proposedEdges.length > 0 ? (
              <Button type="button" variant="secondary" onClick={() => setShowSuggested(true)}>
                Review suggestions
              </Button>
            ) : (
              <Button type="button" variant="secondary" disabled={busy} onClick={materialize}>
                Build from confirmed facts
              </Button>
            )
          }
        />
      ) : (
        <div
          className={inspectorOpen ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" : undefined}
        >
          <div className="min-w-0">
            {view === "graph" ? (
              <>
                <CaseGraphCanvas
                  nodes={filteredNodes}
                  edges={visibleEdges}
                  proposedEdges={visibleProposed}
                  selectedId={selected?.id ?? null}
                  selectedEdgeId={selectedEdge?.id ?? selectedProposed?.id ?? null}
                  showSuggested={showSuggested}
                  onSelect={(id) => {
                    const node = nodes.find((n) => n.id === id);
                    if (node) void selectNode(node);
                  }}
                  onSelectEdge={selectCanvasEdge}
                />
                <ul className="sr-only" aria-label="Verified connections">
                  {visibleEdges.map((edge) => (
                    <li key={`sr-verified-${edge.id}`}>
                      {edge.fromName} · {humanizeKey(edge.relationshipType)} · {edge.toName} ·
                      Verified
                    </li>
                  ))}
                </ul>
                {showSuggested ? (
                  <ul className="sr-only" aria-label="Proposed graph edges">
                    {visibleProposed.length === 0 ? (
                      <li>No suggested connections.</li>
                    ) : (
                      visibleProposed.map((edge) => (
                        <li key={`sr-proposed-${edge.id}`}>
                          {edge.fromName} · {humanizeKey(edge.relationshipType)} · {edge.toName} ·
                          Suggested by Nyaya
                        </li>
                      ))
                    )}
                  </ul>
                ) : null}
              </>
            ) : (
              <div className="space-y-4">
                <section>
                  <h3 className="mb-2 font-display text-lg text-ink">Verified connections</h3>
                  {visibleEdges.length === 0 ? (
                    <p className="text-sm text-ink/60">No verified connections yet.</p>
                  ) : (
                    <ul aria-label="Verified connections" className="space-y-2 text-sm">
                      {visibleEdges.map((edge) => (
                        <li
                          key={edge.id}
                          className="rounded-lg border border-line bg-white px-3 py-2"
                        >
                          {edge.fromName} · {humanizeKey(edge.relationshipType)} · {edge.toName}{" "}
                          <TrustStatus kind="verified" />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                {showSuggested ? (
                  <section>
                    <h3 className="mb-2 font-display text-lg text-ink">Suggested connections</h3>
                    {visibleProposed.length === 0 ? (
                      <ul aria-label="Proposed graph edges" className="text-sm text-ink/60">
                        <li>No suggested connections.</li>
                      </ul>
                    ) : (
                      <ul aria-label="Proposed graph edges" className="space-y-2 text-sm">
                        {visibleProposed.map((edge) => (
                          <li key={edge.id}>
                            <button
                              type="button"
                              className="w-full rounded-lg border border-amber-700/20 bg-amber-50/40 px-3 py-2 text-left"
                              onClick={() => {
                                setSelected(null);
                                setNeighborhood(null);
                                setSelectedEdge(null);
                                setSelectedProposed(edge);
                                setEditLabel(edge.label ?? "");
                                setEditRelationship(edge.relationshipType);
                              }}
                            >
                              {edge.fromName} · {humanizeKey(edge.relationshipType)} · {edge.toName}{" "}
                              <TrustStatus kind="suggested" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                ) : null}
              </div>
            )}
          </div>

          <IntelligenceInspector
            open={inspectorOpen}
            title={
              selectedProposed
                ? `${selectedProposed.fromName} → ${selectedProposed.toName}`
                : selectedEdge
                  ? `${selectedEdge.fromName} → ${selectedEdge.toName}`
                  : (selected?.displayName ?? "Details")
            }
            subtitle={
              selectedProposed
                ? humanizeKey(selectedProposed.relationshipType)
                : selectedEdge
                  ? humanizeKey(selectedEdge.relationshipType)
                  : selected
                    ? humanizeKey(selected.nodeType)
                    : undefined
            }
            status={
              selectedProposed ? (
                <TrustStatus kind="suggested" />
              ) : selectedEdge ? (
                <TrustStatus
                  kind={isVerifiedStatus(selectedEdge.status) ? "verified" : "suggested"}
                />
              ) : selected ? (
                <TrustStatus
                  kind={trustStatusFromRecord({ status: selected.status ?? "approved" })}
                />
              ) : undefined
            }
            onClose={() => {
              setSelected(null);
              setSelectedProposed(null);
              setSelectedEdge(null);
              setNeighborhood(null);
            }}
            actions={
              selectedProposed ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openSources(selectedProposed.sources ?? [])}
                  >
                    {sourceCountLabel((selectedProposed.sources ?? []).length)}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => reviewEdge(selectedProposed.id, "approve")}
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    variant="ghost"
                    onClick={() => reviewEdge(selectedProposed.id, "reject")}
                  >
                    Dismiss
                  </Button>
                </>
              ) : selectedEdge ? (
                (selectedEdge.sources ?? []).length > 0 ? (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => openSources(selectedEdge.sources ?? [])}
                  >
                    {sourceCountLabel((selectedEdge.sources ?? []).length)}
                  </Button>
                ) : null
              ) : selected ? (
                <>
                  {(() => {
                    const href = nodeHref(matterId, selected);
                    if (!href) return null;
                    const label =
                      selected.canonicalEntityType === "matter_entity"
                        ? "View people"
                        : selected.canonicalEntityType === "timeline_event"
                          ? "View timeline"
                          : selected.canonicalEntityType === "document"
                            ? "View evidence"
                            : "Open linked record";
                    return (
                      <Link
                        href={href}
                        className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
                      >
                        {label}
                      </Link>
                    );
                  })()}
                  <Link
                    href={askNyayaHref(matterId)}
                    className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
                  >
                    Ask Nyaya about this
                  </Link>
                </>
              ) : null
            }
          >
            {selectedEdge ? (
              <>
                <p className="text-sm text-ink/70">
                  {humanizeKey(selectedEdge.relationshipType)} ·{" "}
                  {isVerifiedStatus(selectedEdge.status) ? "Verified" : "Suggested by Nyaya"}
                </p>
                <p className="text-sm text-ink/60">
                  {selectedEdge.fromName} → {selectedEdge.toName}
                </p>
                {(selectedEdge.sources ?? []).length > 0 ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-accent underline"
                    onClick={() => openSources(selectedEdge.sources ?? [])}
                  >
                    {sourceCountLabel((selectedEdge.sources ?? []).length)}
                  </button>
                ) : null}
              </>
            ) : selectedProposed ? (
              <>
                <p className="text-sm text-ink/70">
                  Suggested by Nyaya. This is not a verified connection.
                </p>
                {(selectedProposed.sources ?? []).length === 0 ? (
                  <p className="text-ink/55">
                    Nyaya cannot confirm this connection until it points to a quote in the files.
                  </p>
                ) : null}
                <input
                  className="w-full rounded border border-line px-2 py-1.5"
                  aria-label="Connection label"
                  placeholder="Label"
                  value={editLabel}
                  onChange={(e) => setEditLabel(e.target.value)}
                />
                <select
                  className="w-full rounded border border-line px-2 py-1.5"
                  aria-label="Relationship"
                  value={editRelationship}
                  onChange={(e) => setEditRelationship(e.target.value)}
                >
                  {GRAPH_RELATIONSHIP_OPTIONS.map((type) => (
                    <option key={type} value={type}>
                      {humanizeKey(type)}
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  disabled={busy}
                  variant="secondary"
                  onClick={() => reviewEdge(selectedProposed.id, "edit_and_approve")}
                >
                  Save and accept
                </Button>
              </>
            ) : neighborhood ? (
              <>
                <RelatedList heading="Connected to" empty="No connections yet.">
                  {neighborhood.edges.length > 0 ? (
                    <p>
                      {neighborhood.neighbors.length} linked{" "}
                      {neighborhood.neighbors.length === 1 ? "item" : "items"}
                    </p>
                  ) : null}
                </RelatedList>
                <RelatedList heading="Important connections">
                  {(neighborhood.edges ?? []).length > 0 ? (
                    <ul className="space-y-2">
                      {neighborhood.edges.map((edge) => {
                        const otherId =
                          edge.fromNodeId === neighborhood.center.id
                            ? edge.toNodeId
                            : edge.fromNodeId;
                        const other = neighborhood.neighbors.find((n) => n.id === otherId);
                        return (
                          <li key={edge.id}>
                            <button
                              type="button"
                              className="text-left font-semibold hover:text-accent"
                              onClick={() => other && selectNode(other)}
                            >
                              {other?.displayName ?? "Connected item"}
                            </button>
                            <p className="text-xs text-ink/55">
                              {humanizeKey(edge.relationshipType)} ·{" "}
                              {isVerifiedStatus(edge.status) ? "Verified" : "Suggested by Nyaya"}
                            </p>
                            {(edge.sources ?? []).length > 0 ? (
                              <button
                                type="button"
                                className="text-xs font-semibold text-accent underline"
                                onClick={() => openSources(edge.sources ?? [])}
                              >
                                View source
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </RelatedList>
              </>
            ) : (
              <p className="text-ink/60">Select a person, document, or event on the graph.</p>
            )}
          </IntelligenceInspector>
        </div>
      )}

      <IntelligenceDialog
        open={addOpen}
        title="Add connection"
        description="Manual connections are recorded as verified immediately."
        onClose={() => setAddOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={createEdge}>
          <label className="text-xs text-ink/60">
            From
            <select
              className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm"
              value={fromNodeId}
              onChange={(e) => setFromNodeId(e.target.value)}
              required
            >
              <option value="">Select</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink/60">
            Relationship
            <select
              className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm"
              value={relationshipType}
              onChange={(e) => setRelationshipType(e.target.value)}
              required
            >
              {GRAPH_RELATIONSHIP_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {humanizeKey(type)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-ink/60">
            To
            <select
              className="mt-1 w-full rounded border border-line px-2 py-1.5 text-sm"
              value={toNodeId}
              onChange={(e) => setToNodeId(e.target.value)}
              required
            >
              <option value="">Select</option>
              {nodes.map((n) => (
                <option key={`to-${n.id}`} value={n.id}>
                  {n.displayName}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={busy} type="submit">
            Save connection
          </Button>
        </form>
      </IntelligenceDialog>
      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
