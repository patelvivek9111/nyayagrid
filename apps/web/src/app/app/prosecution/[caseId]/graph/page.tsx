"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState, StatusLabel } from "@/components/ux";
import { Button } from "@nyayagrid/ui";
import { humanizeKey } from "@/lib/plain-labels";

type GraphNode = {
  id: string;
  nodeKind: string;
  displayName: string;
  status: string;
  isVerified: boolean;
  origin: string;
};

type GraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  status: string;
  isVerified: boolean;
  origin: string;
};

export default function ProsecutionCaseGraphPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  const { organizationId } = useActiveOrganization();
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);

  async function loadGraph() {
    if (!organizationId || !caseId) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/prosecution/cases/${caseId}/graph?organizationId=${organizationId}`,
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not load case graph.");
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load case graph.");
      setNodes([]);
      setEdges([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId, caseId]);

  async function syncProjection() {
    if (!organizationId || !caseId) return;
    setSyncing(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/prosecution/cases/${caseId}/graph`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync_projection", organizationId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not sync graph.");
      setNodes(data.nodes ?? []);
      setEdges(data.edges ?? []);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not sync graph.");
    } finally {
      setSyncing(false);
    }
  }

  async function reviewEdge(edgeId: string, action: "approve" | "reject") {
    if (!organizationId || !caseId) return;
    setError("");
    try {
      const response = await fetch(
        `/api/v1/prosecution/cases/${caseId}/graph/edges/${edgeId}/review`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ organizationId, action }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not review edge.");
      setEdges((prev) =>
        prev.map((edge) => (edge.id === edgeId ? { ...edge, ...data.edge } : edge)),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not review edge.");
    }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <ProfessionalShell title="Case graph">
      <p className="mb-4 max-w-2xl text-sm text-ink/70">
        Case-scoped Nyaya Graph for this criminal case. Proposed relationships are never shown as
        verified facts. Sync projects defendants, charges, elements, evidence, and witnesses from
        case records with provenance.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link className="text-sm text-accent underline" href={`/app/prosecution/${caseId}`}>
          Back to case
        </Link>
        <Button
          type="button"
          onClick={() => void syncProjection()}
          disabled={syncing || !organizationId}
        >
          {syncing ? "Syncing…" : "Sync from case records"}
        </Button>
      </div>
      {loading ? <LoadingState label="Loading case graph" /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && !error && nodes.length === 0 ? (
        <EmptyState
          title="No graph nodes yet"
          description="Sync from case records to create source-backed nodes and proposed relationships."
        />
      ) : null}
      {nodes.length > 0 ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Nodes</h2>
            <ul className="space-y-1 text-sm">
              {nodes.map((node) => (
                <li key={node.id} className="rounded border border-line px-3 py-2">
                  <span className="font-medium text-ink">{node.displayName}</span>
                  <span className="text-ink/55"> · {humanizeKey(node.nodeKind)}</span>
                  <span className="ml-2">
                    <StatusLabel label={node.isVerified ? "Verified" : humanizeKey(node.status)} />
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h2 className="mb-2 text-sm font-semibold text-ink">Relationships</h2>
            {edges.length === 0 ? (
              <p className="text-sm text-ink/60">No relationships yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {edges.map((edge) => (
                  <li key={edge.id} className="rounded border border-line px-3 py-2">
                    <div>
                      {nodeById.get(edge.fromNodeId)?.displayName ?? edge.fromNodeId.slice(0, 8)}
                      {" → "}
                      <span className="font-medium">{humanizeKey(edge.relationshipType)}</span>
                      {" → "}
                      {nodeById.get(edge.toNodeId)?.displayName ?? edge.toNodeId.slice(0, 8)}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <StatusLabel
                        label={edge.isVerified ? "Verified" : humanizeKey(edge.status)}
                      />
                      <span className="text-xs text-ink/50">{humanizeKey(edge.origin)}</span>
                      {edge.status === "proposed" ? (
                        <>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void reviewEdge(edge.id, "approve")}
                          >
                            Approve
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            onClick={() => void reviewEdge(edge.id, "reject")}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </ProfessionalShell>
  );
}
