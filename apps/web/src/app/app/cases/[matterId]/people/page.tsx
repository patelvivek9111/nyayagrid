"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Panel, Badge, Button } from "@nyayagrid/ui";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SourceDrawer,
  SuggestedBadge,
  VerifiedBadge,
  type SourceDrawerItem,
} from "@/components/ux";

type EntityRole = { role: string; status: string };
type EntityAlias = { alias: string };
type EntitySource = {
  id: string;
  documentId: string;
  chunkId: string;
  page?: number | null;
  supportingText?: string | null;
  documentTitle?: string | null;
};

type Entity = {
  id: string;
  displayName: string;
  entityType: string;
  status: string;
  description?: string | null;
  origin?: string | null;
  roles?: EntityRole[];
  aliases?: EntityAlias[];
  sources?: EntitySource[];
  graphNodeId?: string | null;
};

type GraphNeighbor = { id: string; displayName: string; nodeType: string };
type GraphEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relationshipType: string;
  status: string;
};
type Neighborhood = {
  center: { id: string; displayName: string };
  neighbors: GraphNeighbor[];
  edges: GraphEdge[];
};

type Filter = "all" | "suggested" | "verified";

function isVerified(status: string) {
  return status === "approved" || status === "edited_and_approved";
}

function parseList(raw: string) {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function CasePeoplePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [entities, setEntities] = useState<Entity[]>([]);
  const [selected, setSelected] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);
  const [neighborhood, setNeighborhood] = useState<Neighborhood | null>(null);
  const [neighborhoodLoading, setNeighborhoodLoading] = useState(false);

  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<"person" | "organization">("person");
  const [createRoles, setCreateRoles] = useState("");
  const [createAliases, setCreateAliases] = useState("");

  const [editName, setEditName] = useState("");
  const [editType, setEditType] = useState<"person" | "organization">("person");
  const [editDescription, setEditDescription] = useState("");
  const [editRoles, setEditRoles] = useState("");
  const [editAliases, setEditAliases] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [editing, setEditing] = useState(false);

  async function load(keepId?: string | null) {
    const res = await fetch(`/api/v1/matters/${matterId}/entities`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load people");
    const next: Entity[] = data.entities ?? [];
    setEntities(next);
    const id = keepId ?? selected?.id;
    setSelected(id ? (next.find((e) => e.id === id) ?? null) : null);
    return next;
  }

  useEffect(() => {
    const entityId = new URLSearchParams(window.location.search).get("entityId");
    setLoading(true);
    load(entityId)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load people"))
      .finally(() => setLoading(false));
    // Initial load only; subsequent refreshes go through load().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  useEffect(() => {
    if (!selected) {
      setEditName("");
      setEditType("person");
      setEditDescription("");
      setEditRoles("");
      setEditAliases("");
      setRejectReason("");
      setEditing(false);
      setNeighborhood(null);
      return;
    }
    setEditName(selected.displayName);
    setEditType(selected.entityType === "organization" ? "organization" : "person");
    setEditDescription(selected.description ?? "");
    setEditRoles((selected.roles ?? []).map((r) => r.role).join(", "));
    setEditAliases((selected.aliases ?? []).map((a) => a.alias).join(", "));
    setRejectReason("");
    setEditing(selected.status === "proposed");

    if (!selected.graphNodeId) {
      setNeighborhood(null);
      return;
    }
    setNeighborhoodLoading(true);
    fetch(`/api/v1/matters/${matterId}/graph/nodes/${selected.graphNodeId}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load graph neighborhood");
        setNeighborhood(json);
      })
      .catch(() => setNeighborhood(null))
      .finally(() => setNeighborhoodLoading(false));
  }, [selected?.id, selected?.graphNodeId, selected?.status, matterId]);

  const suggestedCount = useMemo(
    () => entities.filter((e) => e.status === "proposed").length,
    [entities],
  );
  const verifiedCount = useMemo(
    () => entities.filter((e) => isVerified(e.status)).length,
    [entities],
  );

  const visible = useMemo(() => {
    if (filter === "suggested") return entities.filter((e) => e.status === "proposed");
    if (filter === "verified") return entities.filter((e) => isVerified(e.status));
    return entities;
  }, [entities, filter]);

  async function review(action: "approve" | "edit_and_approve" | "reject") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        action,
        rejectionReason: rejectReason || null,
      };
      if (action === "edit_and_approve") {
        body.edits = {
          displayName: editName.trim(),
          entityType: editType,
          description: editDescription.trim() || null,
          roles: parseList(editRoles),
          aliases: parseList(editAliases),
        };
      }
      const res = await fetch(`/api/v1/matters/${matterId}/entities/${selected.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Review failed");
      setEditing(false);
      await load(action === "reject" ? null : selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function createEntity(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: createName.trim(),
          entityType: createType,
          roles: parseList(createRoles),
          aliases: parseList(createAliases),
        }),
      });
      const json = await res.json();
      if (!res.ok)
        throw new Error(json?.error?.message ?? "Failed to create person or organization");
      setCreateName("");
      setCreateRoles("");
      setCreateAliases("");
      const next = await load(json.entity?.id ?? null);
      const created = next.find((ent) => ent.id === json.entity?.id);
      if (created) setSelected(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function analyzeDocuments() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/intelligence/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Extraction failed");
      await load(selected?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  function openSources(entity: Entity) {
    setDrawerItems(
      (entity.sources ?? []).map((s) => ({
        id: s.id,
        title: s.documentTitle ?? "Case document",
        classLabel: "Matter Evidence",
        subtitle: s.page != null ? `Page ${s.page}` : undefined,
        quote: s.supportingText ?? undefined,
        chunkId: s.chunkId,
        href: `/app/cases/${matterId}/documents`,
      })),
    );
    setDrawerOpen(true);
  }

  if (loading) return <LoadingState label="Loading people…" />;
  if (error && entities.length === 0) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">People & Organizations</h2>
          <p className="text-sm text-ink/60">
            Review suggested people and organizations here. Proposed names stay suggestions until
            you approve them — they are never shown as verified.
          </p>
        </div>
        <Button type="button" variant="secondary" disabled={busy} onClick={analyzeDocuments}>
          {busy ? "Working…" : "Analyze documents"}
        </Button>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["all", `All (${entities.length})`],
            ["suggested", `Suggestions (${suggestedCount})`],
            ["verified", `Verified (${verifiedCount})`],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
              filter === key ? "border-accent bg-accent-soft/50" : "border-line bg-white"
            }`}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {entities.length === 0 ? (
        <EmptyState
          title="No people yet"
          description="Nyaya can propose people and organizations from uploaded documents, or you can add one manually below."
          action={
            <Button type="button" variant="secondary" disabled={busy} onClick={analyzeDocuments}>
              Analyze documents
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter === "suggested" ? "No suggestions pending" : "No verified people yet"}
          description={
            filter === "suggested"
              ? "Approve suggestions from the All view, or analyze documents for new proposals."
              : "Approve a suggested person, or add one manually. Manual entries are verified immediately."
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <ul
            aria-label="People and organizations"
            className="divide-y divide-line rounded-lg border border-line bg-white"
          >
            {visible.map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  className={`flex w-full items-start justify-between gap-2 px-4 py-3 text-left hover:bg-accent-soft/30 ${
                    selected?.id === e.id ? "bg-accent-soft/40" : ""
                  }`}
                  onClick={() => setSelected(e)}
                >
                  <div>
                    <p className="font-semibold text-sm">{e.displayName}</p>
                    <p className="text-xs text-ink/55">{e.entityType}</p>
                  </div>
                  {e.status === "proposed" ? <SuggestedBadge /> : <VerifiedBadge />}
                </button>
              </li>
            ))}
          </ul>

          <Panel title={selected ? selected.displayName : "Detail"}>
            {!selected ? (
              <p className="text-sm text-ink/60">Select a person or organization.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge>{selected.entityType}</Badge>
                  {selected.status === "proposed" ? <SuggestedBadge /> : <VerifiedBadge />}
                  {selected.origin === "ai" ? (
                    <Badge>Nyaya proposed</Badge>
                  ) : selected.origin === "manual" ? (
                    <Badge>Manual</Badge>
                  ) : null}
                </div>

                <div>
                  <p className="font-semibold">Roles</p>
                  {(selected.roles ?? []).length === 0 ? (
                    <p className="text-ink/55">No roles recorded.</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-ink/75">
                      {selected.roles!.map((r) => (
                        <li key={r.role} className="flex flex-wrap items-center gap-2">
                          <span>{r.role}</span>
                          {r.status === "proposed" ? <SuggestedBadge /> : <VerifiedBadge />}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <div>
                  <p className="font-semibold">Aliases</p>
                  {(selected.aliases ?? []).length === 0 ? (
                    <p className="text-ink/55">None</p>
                  ) : (
                    <p className="text-ink/75">
                      {selected.aliases!.map((a) => a.alias).join(", ")}
                    </p>
                  )}
                </div>

                {selected.description ? (
                  <p className="text-ink/75">{selected.description}</p>
                ) : null}

                <div>
                  <p className="font-semibold">Sources</p>
                  {(selected.sources ?? []).length === 0 ? (
                    <p className="text-ink/55">
                      {selected.origin === "ai"
                        ? "No sources (cannot approve an AI proposal without them)."
                        : "No source documents linked. Manual entries do not require a citation."}
                    </p>
                  ) : (
                    <Button type="button" variant="secondary" onClick={() => openSources(selected)}>
                      Inspect sources ({selected.sources!.length})
                    </Button>
                  )}
                </div>

                <div>
                  <p className="font-semibold">Graph neighborhood</p>
                  {!selected.graphNodeId ? (
                    <p className="text-ink/55">
                      A Graph node appears after this person or organization is verified.
                    </p>
                  ) : neighborhoodLoading ? (
                    <LoadingState label="Loading neighborhood…" />
                  ) : !neighborhood || (neighborhood.edges ?? []).length === 0 ? (
                    <p className="text-ink/55">
                      No verified relationships yet. Open Graph to inspect the node.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-ink/75">
                      {neighborhood.edges.map((edge) => {
                        const otherId =
                          edge.fromNodeId === neighborhood.center.id
                            ? edge.toNodeId
                            : edge.fromNodeId;
                        const other = neighborhood.neighbors.find((n) => n.id === otherId);
                        return (
                          <li key={edge.id}>
                            {edge.relationshipType}
                            {other ? ` → ${other.displayName}` : ""}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <Link
                    href={`/app/cases/${matterId}/graph`}
                    className="mt-2 inline-block text-xs font-semibold text-accent underline"
                  >
                    View in Graph →
                  </Link>
                </div>

                {editing ? (
                  <div className="space-y-2 rounded-lg border border-line p-3">
                    <p className="font-semibold">
                      {selected.status === "proposed" ? "Edit before approve" : "Edit"}
                    </p>
                    <label className="block text-xs text-ink/60">
                      Display name
                      <input
                        className="mt-1 w-full rounded border border-line px-3 py-2 text-sm text-ink"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                      />
                    </label>
                    <label className="block text-xs text-ink/60">
                      Type
                      <select
                        className="mt-1 w-full rounded border border-line px-3 py-2 text-sm text-ink"
                        value={editType}
                        onChange={(e) =>
                          setEditType(e.target.value === "organization" ? "organization" : "person")
                        }
                      >
                        <option value="person">Person</option>
                        <option value="organization">Organization</option>
                      </select>
                    </label>
                    <label className="block text-xs text-ink/60">
                      Description
                      <textarea
                        className="mt-1 w-full rounded border border-line px-3 py-2 text-sm text-ink"
                        rows={2}
                        value={editDescription}
                        onChange={(e) => setEditDescription(e.target.value)}
                      />
                    </label>
                    <label className="block text-xs text-ink/60">
                      Roles (comma-separated)
                      <input
                        className="mt-1 w-full rounded border border-line px-3 py-2 text-sm text-ink"
                        value={editRoles}
                        onChange={(e) => setEditRoles(e.target.value)}
                        placeholder="witness, opposing counsel"
                      />
                    </label>
                    <label className="block text-xs text-ink/60">
                      Aliases (comma-separated)
                      <input
                        className="mt-1 w-full rounded border border-line px-3 py-2 text-sm text-ink"
                        value={editAliases}
                        onChange={(e) => setEditAliases(e.target.value)}
                        placeholder="J. Lee"
                      />
                    </label>
                  </div>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}

                {selected.status === "proposed" ? (
                  <>
                    <textarea
                      className="w-full rounded border border-line px-3 py-2"
                      placeholder="Rejection reason (optional)"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" disabled={busy} onClick={() => review("approve")}>
                        Approve
                      </Button>
                      <Button
                        type="button"
                        disabled={busy || !editName.trim()}
                        variant="secondary"
                        onClick={() => review("edit_and_approve")}
                      >
                        Edit & approve
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        variant="ghost"
                        onClick={() => review("reject")}
                      >
                        Reject
                      </Button>
                    </div>
                  </>
                ) : editing ? (
                  <Button
                    type="button"
                    disabled={busy || !editName.trim()}
                    onClick={() => review("edit_and_approve")}
                  >
                    Save edits
                  </Button>
                ) : null}
              </div>
            )}
          </Panel>
        </div>
      )}

      <Panel title="Add person or organization">
        <form className="flex flex-col gap-3" onSubmit={createEntity}>
          <input
            className="rounded border border-line px-3 py-2"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Display name"
            required
            aria-label="Display name"
          />
          <select
            className="rounded border border-line px-3 py-2"
            value={createType}
            onChange={(e) =>
              setCreateType(e.target.value === "organization" ? "organization" : "person")
            }
            aria-label="Entity type"
          >
            <option value="person">Person</option>
            <option value="organization">Organization</option>
          </select>
          <input
            className="rounded border border-line px-3 py-2"
            value={createRoles}
            onChange={(e) => setCreateRoles(e.target.value)}
            placeholder="Roles (comma-separated)"
            aria-label="Roles"
          />
          <input
            className="rounded border border-line px-3 py-2"
            value={createAliases}
            onChange={(e) => setCreateAliases(e.target.value)}
            placeholder="Aliases (comma-separated)"
            aria-label="Aliases"
          />
          <p className="text-xs text-ink/55">
            Manual entries are recorded as <VerifiedBadge /> immediately. Nyaya proposals stay{" "}
            <SuggestedBadge /> until you approve them on this tab.
          </p>
          <Button type="submit" disabled={busy || !createName.trim()}>
            Add person or organization
          </Button>
        </form>
      </Panel>

      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
