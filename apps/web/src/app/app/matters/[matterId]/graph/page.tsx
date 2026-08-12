"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { MatterShell } from "@/components/shell";
import { Badge, Button, Panel } from "@nyayagrid/ui";

export default function MatterGraphPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [nodes, setNodes] = useState<any[]>([]);
  const [edges, setEdges] = useState<any[]>([]);
  const [proposedEdges, setProposedEdges] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [neighborhood, setNeighborhood] = useState<any | null>(null);
  const [q, setQ] = useState("");
  const [nodeType, setNodeType] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fromNodeId, setFromNodeId] = useState("");
  const [toNodeId, setToNodeId] = useState("");
  const [relationshipType, setRelationshipType] = useState("related_to");

  async function load() {
    const qs = new URLSearchParams();
    if (q) qs.set("q", q);
    if (nodeType) qs.set("nodeType", nodeType);
    const res = await fetch(`/api/v1/matters/${matterId}/graph?${qs.toString()}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load graph");
    setNodes(json.nodes ?? []);
    setEdges(json.edges ?? []);
    setProposedEdges(json.proposedEdges ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [matterId]);

  const nodeTypes = useMemo(() => [...new Set(nodes.map((n) => n.nodeType))].sort(), [nodes]);

  async function selectNode(node: any) {
    setSelected(node);
    const res = await fetch(`/api/v1/matters/${matterId}/graph/nodes/${node.id}`);
    const json = await res.json();
    if (!res.ok) {
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
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extract failed");
    } finally {
      setBusy(false);
    }
  }

  async function createEdge(e: FormEvent) {
    e.preventDefault();
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create edge failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewEdge(edgeId: string, action: "approve" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/graph/edges/${edgeId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Review failed");
      await load();
      if (selected) await selectNode(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <MatterShell matterId={matterId} title="Nyaya Graph">
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={materialize}>
          Materialize from verified intelligence
        </Button>
        <Button disabled={busy} variant="secondary" onClick={extractRelationships}>
          Propose AI relationships
        </Button>
        <Badge>{nodes.length} nodes</Badge>
        <Badge>{edges.length} verified edges</Badge>
        <Badge>{proposedEdges.length} proposed</Badge>
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <input
          className="rounded border border-line px-3 py-1.5 text-sm"
          placeholder="Search nodes"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => load().catch((err) => setError(err.message))}
        />
        <select
          className="rounded border border-line px-2 py-1.5 text-sm"
          value={nodeType}
          onChange={(e) => {
            setNodeType(e.target.value);
            setTimeout(() => load().catch((err) => setError(err.message)), 0);
          }}
        >
          <option value="">All types</option>
          {nodeTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <Panel title="Nodes">
            {nodes.length === 0 ? (
              <p className="text-sm text-ink/70">
                No graph nodes yet. Materialize verified intelligence.
              </p>
            ) : (
              <ul className="max-h-[28rem] space-y-2 overflow-auto text-sm">
                {nodes.map((node) => (
                  <li key={node.id}>
                    <button
                      type="button"
                      className="text-left font-semibold hover:text-accent"
                      onClick={() => selectNode(node)}
                    >
                      {node.displayName}
                    </button>
                    <div className="text-ink/60">
                      {node.nodeType} · {node.canonicalEntityType}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Proposed relationships">
            {proposedEdges.length === 0 ? (
              <p className="text-sm text-ink/70">No proposed edges.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {proposedEdges.map((edge) => (
                  <li key={edge.id} className="rounded border border-line p-2">
                    <div className="font-semibold">{edge.relationshipType}</div>
                    <div className="text-ink/70">{edge.label || "Proposed relationship"}</div>
                    <div className="mt-2 flex gap-2">
                      <Button disabled={busy} onClick={() => reviewEdge(edge.id, "approve")}>
                        Approve
                      </Button>
                      <Button
                        disabled={busy}
                        variant="ghost"
                        onClick={() => reviewEdge(edge.id, "reject")}
                      >
                        Reject
                      </Button>
                    </div>
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
                    {neighborhood.center.nodeType} · canonical{" "}
                    {neighborhood.center.canonicalEntityType}/
                    {neighborhood.center.canonicalEntityId.slice(0, 8)}…
                  </div>
                </div>
                {(neighborhood.edges ?? []).length === 0 ? (
                  <p className="text-ink/70">No connected verified edges.</p>
                ) : (
                  <ul className="space-y-3">
                    {neighborhood.edges.map((edge: any) => {
                      const otherId =
                        edge.fromNodeId === neighborhood.center.id
                          ? edge.toNodeId
                          : edge.fromNodeId;
                      const other = neighborhood.neighbors.find((n: any) => n.id === otherId);
                      return (
                        <li key={edge.id} className="rounded border border-line p-2">
                          <div className="font-semibold">
                            {edge.relationshipType} → {other?.displayName ?? otherId.slice(0, 8)}
                          </div>
                          <div className="text-ink/60">
                            {edge.origin} · {edge.status} · {(edge.sources ?? []).length} sources
                          </div>
                          {(edge.sources ?? []).map((source: any) => (
                            <p key={source.id} className="mt-1 text-ink/80">
                              {source.supportingText}
                            </p>
                          ))}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Create manual relationship">
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
          </Panel>

          <Panel title="Relationship list">
            {edges.length === 0 ? (
              <p className="text-sm text-ink/70">No verified relationships.</p>
            ) : (
              <ul className="max-h-64 space-y-2 overflow-auto text-sm">
                {edges.map((edge) => (
                  <li key={edge.id}>
                    {edge.relationshipType} · {edge.origin} · {edge.status}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </MatterShell>
  );
}
