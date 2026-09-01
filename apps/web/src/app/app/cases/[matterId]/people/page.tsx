"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@nyayagrid/ui";
import { humanizeKey } from "@/lib/plain-labels";
import {
  EmptyState,
  ErrorState,
  FilterChipBar,
  IntelligenceDialog,
  IntelligenceHeader,
  IntelligenceInspector,
  LoadingState,
  RelatedList,
  SourceDrawer,
  TrustStatus,
  type SourceDrawerItem,
} from "@/components/ux";
import {
  peopleKindFilter,
  sourceCountLabel,
  trustStatusFromRecord,
  userFacingLoadError,
} from "@/lib/case-intelligence-ux";

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

type Filter = "all" | "people" | "organizations" | "parties" | "witnesses";

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
  const [query, setQuery] = useState("");
  const [addOpen, setAddOpen] = useState(false);
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
    if (!res.ok) throw new Error(userFacingLoadError("people", res.status));
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
      .catch((err) => setError(err instanceof Error ? err.message : userFacingLoadError("people")))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  useEffect(() => {
    if (!selected) {
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
        if (!res.ok) throw new Error(userFacingLoadError("graph", res.status));
        setNeighborhood(json);
      })
      .catch(() => setNeighborhood(null))
      .finally(() => setNeighborhoodLoading(false));
  }, [selected?.id, selected?.graphNodeId, selected?.status, matterId]);

  const roleFiltersAvailable = useMemo(() => {
    const roles = entities.flatMap((e) => (e.roles ?? []).map((r) => r.role.toLowerCase()));
    return {
      parties: roles.some((r) => r.includes("party")),
      witnesses: roles.some((r) => r.includes("witness")),
    };
  }, [entities]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entities.filter((e) => {
      if (!peopleKindFilter(e.entityType, e.roles, filter)) return false;
      if (!q) return true;
      return (
        e.displayName.toLowerCase().includes(q) ||
        (e.roles ?? []).some((r) => r.role.toLowerCase().includes(q))
      );
    });
  }, [entities, filter, query]);

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
      if (!res.ok) throw new Error("We couldn't update that person. Try again.");
      setEditing(false);
      await load(action === "reject" ? null : selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update that person. Try again.");
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
      if (!res.ok)
        throw new Error(json?.error?.message ?? "We couldn't analyze documents. Try again.");
      await load(selected?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't analyze documents. Try again.");
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
      if (!res.ok) throw new Error("We couldn't add that person. Try again.");
      setCreateName("");
      setCreateRoles("");
      setCreateAliases("");
      setAddOpen(false);
      const next = await load(json.entity?.id ?? null);
      const created = next.find((ent) => ent.id === json.entity?.id);
      if (created) setSelected(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't add that person. Try again.");
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
        documentId: s.documentId,
      })),
    );
    setDrawerOpen(true);
  }

  if (loading) return <LoadingState label="Loading people…" />;
  if (error && entities.length === 0) return <ErrorState message={error} />;

  const filterOptions = [
    { id: "all", label: "All", count: entities.length },
    { id: "people", label: "People" },
    { id: "organizations", label: "Organizations" },
    ...(roleFiltersAvailable.parties ? [{ id: "parties", label: "Parties" }] : []),
    ...(roleFiltersAvailable.witnesses ? [{ id: "witnesses", label: "Witnesses" }] : []),
  ];

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        title="People"
        description="Who is involved in this case, and why they matter."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" disabled={busy} onClick={analyzeDocuments}>
              {busy ? "Working…" : "Analyze documents"}
            </Button>
            <Button type="button" onClick={() => setAddOpen(true)}>
              + Add person
            </Button>
          </div>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <FilterChipBar
        value={filter}
        onChange={(id) => setFilter(id as Filter)}
        options={filterOptions}
        search={query}
        searchPlaceholder="Search the roster"
        searchLabel="Search people and organizations"
        onSearchChange={setQuery}
      />

      {entities.length === 0 ? (
        <EmptyState
          title="No people or organizations identified yet."
          description="Nyaya can propose names from uploaded documents, or you can add someone to the roster."
          action={
            <Button type="button" variant="secondary" onClick={() => setAddOpen(true)}>
              Add person
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No matching people."
          description="Try another filter or clear the search."
        />
      ) : (
        <div className={selected ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" : undefined}>
          <ul aria-label="People and organizations" className="grid gap-2 sm:grid-cols-2">
            {visible.map((e) => {
              const role = e.roles?.[0]?.role;
              const docs = new Set((e.sources ?? []).map((s) => s.documentId)).size;
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-4 py-3 text-left ${
                      selected?.id === e.id
                        ? "border-accent bg-accent-soft/40"
                        : e.status === "proposed"
                          ? "border-amber-700/20 bg-amber-50/40"
                          : "border-line bg-white hover:bg-accent-soft/20"
                    }`}
                    onClick={() => setSelected(e)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm">{e.displayName}</span>
                      <TrustStatus kind={trustStatusFromRecord({ status: e.status })} />
                    </div>
                    <p className="mt-1 text-xs text-ink/55">
                      {humanizeKey(e.entityType)}
                      {role ? ` · ${humanizeKey(role)}` : ""}
                    </p>
                    <p className="mt-1 text-xs text-ink/50">
                      {docs === 1 ? "1 document" : `${docs} documents`}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
          <IntelligenceInspector
            open={Boolean(selected)}
            title={selected?.displayName ?? "Person"}
            subtitle={selected ? humanizeKey(selected.entityType) : undefined}
            status={
              selected ? (
                <TrustStatus kind={trustStatusFromRecord({ status: selected.status })} />
              ) : undefined
            }
            onClose={() => setSelected(null)}
            actions={
              selected ? (
                <>
                  <Button type="button" variant="secondary" onClick={() => openSources(selected)}>
                    {sourceCountLabel((selected.sources ?? []).length)}
                  </Button>
                  <Link
                    href={`/app/cases/${matterId}/evidence`}
                    className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
                  >
                    View evidence
                  </Link>
                  <Link
                    href={`/app/cases/${matterId}/timeline`}
                    className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
                  >
                    View timeline
                  </Link>
                  {selected.graphNodeId ? (
                    <Link
                      href={`/app/cases/${matterId}/graph?nodeId=${selected.graphNodeId}`}
                      className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
                    >
                      Open graph
                    </Link>
                  ) : null}
                </>
              ) : null
            }
          >
            {selected ? (
              <>
                <RelatedList heading="Role" empty="No role recorded.">
                  {(selected.roles ?? []).length > 0 ? (
                    <ul>
                      {selected.roles!.map((r) => (
                        <li key={r.role}>{humanizeKey(r.role)}</li>
                      ))}
                    </ul>
                  ) : null}
                </RelatedList>
                {(selected.aliases ?? []).length > 0 ? (
                  <RelatedList heading="Also known as">
                    <p>{selected.aliases!.map((a) => a.alias).join(", ")}</p>
                  </RelatedList>
                ) : null}
                {selected.description ? (
                  <p className="text-ink/80">{selected.description}</p>
                ) : null}
                <RelatedList heading="Connections" empty="No verified connections yet.">
                  {neighborhoodLoading ? <p>Loading connections…</p> : null}
                  {neighborhood && neighborhood.edges.length > 0 ? (
                    <ul>
                      {neighborhood.edges.map((edge) => {
                        const otherId =
                          edge.fromNodeId === neighborhood.center.id
                            ? edge.toNodeId
                            : edge.fromNodeId;
                        const other = neighborhood.neighbors.find((n) => n.id === otherId);
                        return (
                          <li key={edge.id}>
                            {humanizeKey(edge.relationshipType)}
                            {other ? ` · ${other.displayName}` : ""}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </RelatedList>
                {editing ? (
                  <div className="space-y-2 rounded-lg border border-line p-3">
                    <input
                      className="w-full rounded border border-line px-3 py-2 text-sm"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      aria-label="Name"
                    />
                    <select
                      className="w-full rounded border border-line px-3 py-2 text-sm"
                      value={editType}
                      onChange={(e) =>
                        setEditType(e.target.value === "organization" ? "organization" : "person")
                      }
                      aria-label="Type"
                    >
                      <option value="person">Person</option>
                      <option value="organization">Organization</option>
                    </select>
                    <textarea
                      className="w-full rounded border border-line px-3 py-2 text-sm"
                      rows={2}
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      aria-label="Notes"
                    />
                    <input
                      className="w-full rounded border border-line px-3 py-2 text-sm"
                      value={editRoles}
                      onChange={(e) => setEditRoles(e.target.value)}
                      placeholder="Roles, separated by commas"
                      aria-label="Roles"
                    />
                  </div>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
                {selected.status === "proposed" ? (
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" disabled={busy} onClick={() => review("approve")}>
                      Accept
                    </Button>
                    <Button
                      type="button"
                      disabled={busy || !editName.trim()}
                      variant="secondary"
                      onClick={() => review("edit_and_approve")}
                    >
                      Save and accept
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      variant="ghost"
                      onClick={() => review("reject")}
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : editing ? (
                  <Button
                    type="button"
                    disabled={busy || !editName.trim()}
                    onClick={() => review("edit_and_approve")}
                  >
                    Save
                  </Button>
                ) : null}
              </>
            ) : null}
          </IntelligenceInspector>
        </div>
      )}

      <IntelligenceDialog
        open={addOpen}
        title="Add to roster"
        description="Manual entries are recorded as verified immediately."
        onClose={() => setAddOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={createEntity}>
          <input
            className="rounded border border-line px-3 py-2 text-sm"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            placeholder="Name"
            required
            aria-label="Name"
          />
          <select
            className="rounded border border-line px-3 py-2 text-sm"
            value={createType}
            onChange={(e) =>
              setCreateType(e.target.value === "organization" ? "organization" : "person")
            }
            aria-label="Type"
          >
            <option value="person">Person</option>
            <option value="organization">Organization</option>
          </select>
          <input
            className="rounded border border-line px-3 py-2 text-sm"
            value={createRoles}
            onChange={(e) => setCreateRoles(e.target.value)}
            placeholder="Role (optional)"
            aria-label="Role"
          />
          <input
            className="rounded border border-line px-3 py-2 text-sm"
            value={createAliases}
            onChange={(e) => setCreateAliases(e.target.value)}
            placeholder="Also known as (optional)"
            aria-label="Aliases"
          />
          <Button type="submit" disabled={busy || !createName.trim()}>
            Save
          </Button>
        </form>
      </IntelligenceDialog>
      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
