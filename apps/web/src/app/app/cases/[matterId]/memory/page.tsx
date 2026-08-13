"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Panel } from "@nyayagrid/ui";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SourceDrawer,
  SuggestedBadge,
  VerifiedBadge,
  type SourceDrawerItem,
} from "@/components/ux";

type MemorySource = {
  id: string;
  documentId: string;
  chunkId: string;
  page: number | null;
  supportingText: string;
  documentTitle: string;
};

type MemoryItem = {
  id: string;
  memoryType: string;
  title: string;
  content: string;
  status: string;
  origin: string | null;
  importance: string;
  confidence: string | null;
  sourceType: string | null;
  rationale: string | null;
  supersededBy: string | null;
  badge: "verified" | "suggested" | "historical";
  sources: MemorySource[];
  relatedPeople: Array<{ id: string; displayName: string }>;
  relatedEvents: Array<{ id: string; title: string }>;
};

const MEMORY_TYPES = [
  "verified_context",
  "strategic_note",
  "entity_resolution",
  "document_significance",
  "factual_caveat",
  "user_instruction",
  "matter_preference",
  "procedural_context",
  "other",
] as const;

function isVerified(status: string) {
  return status === "approved" || status === "edited_and_approved";
}

function groupByType(items: MemoryItem[]) {
  const groups = new Map<string, MemoryItem[]>();
  for (const item of items) {
    const list = groups.get(item.memoryType) ?? [];
    list.push(item);
    groups.set(item.memoryType, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export default function CaseMemoryPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [selected, setSelected] = useState<MemoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [memoryType, setMemoryType] = useState<(typeof MEMORY_TYPES)[number]>("verified_context");
  const [importance, setImportance] = useState("normal");
  const [supersedeId, setSupersedeId] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editType, setEditType] = useState<(typeof MEMORY_TYPES)[number]>("verified_context");
  const [editImportance, setEditImportance] = useState("normal");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  async function load(keepId?: string | null) {
    const res = await fetch(`/api/v1/matters/${matterId}/memory`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load memory");
    const next: MemoryItem[] = json.memories ?? [];
    setMemories(next);
    const id = keepId ?? selected?.id;
    setSelected(id ? (next.find((m) => m.id === id) ?? null) : null);
    return next;
  }

  useEffect(() => {
    const memoryId = new URLSearchParams(window.location.search).get("memoryId");
    setLoading(true);
    load(memoryId)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load memory"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  useEffect(() => {
    if (!selected) return;
    setEditTitle(selected.title);
    setEditContent(selected.content);
    setEditType(
      MEMORY_TYPES.includes(selected.memoryType as (typeof MEMORY_TYPES)[number])
        ? (selected.memoryType as (typeof MEMORY_TYPES)[number])
        : "other",
    );
    setEditImportance(selected.importance);
  }, [selected]);

  const active = useMemo(
    () => memories.filter((m) => isVerified(m.status) && !m.supersededBy),
    [memories],
  );
  const proposed = useMemo(() => memories.filter((m) => m.status === "proposed"), [memories]);
  const historical = useMemo(
    () =>
      memories.filter(
        (m) => m.status === "superseded" || m.status === "archived" || m.status === "rejected",
      ),
    [memories],
  );

  async function createManual(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          memoryType,
          importance,
          supersedesId: supersedeId || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");
      setTitle("");
      setContent("");
      setSupersedeId("");
      await load(json.memory?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function propose() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "propose", hint }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Propose failed");
      await load(json.proposals?.[0]?.id ?? selected?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Propose failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(action: "approve" | "edit_and_approve" | "reject" | "archive") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory/${selected.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "edit_and_approve"
            ? {
                action,
                edits: {
                  title: editTitle.trim(),
                  content: editContent.trim(),
                  memoryType: editType,
                  importance: editImportance,
                },
              }
            : { action },
        ),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Review failed");
      await load(action === "reject" || action === "archive" ? null : selected.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function supersedeSelected() {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldMemoryId: selected.id,
          title: editTitle.trim() || selected.title,
          content: editContent.trim() || selected.content,
          memoryType: editType,
          importance: editImportance,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Supersede failed");
      await load(json.memory?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Supersede failed");
    } finally {
      setBusy(false);
    }
  }

  function openSources(memory: MemoryItem) {
    setDrawerItems(
      memory.sources.map((s) => ({
        id: s.id,
        title: s.documentTitle,
        classLabel: "Matter Evidence",
        subtitle: s.page != null ? `Page ${s.page}` : undefined,
        quote: s.supportingText,
        chunkId: s.chunkId,
      })),
    );
    setDrawerOpen(true);
  }

  if (loading) return <LoadingState label="Loading memory…" />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-ink">Nyaya Memory</h2>
        <p className="text-sm text-ink/60">
          Durable Case context. Nyaya proposals stay suggestions until you approve them — nothing is
          auto-verified.
        </p>
      </div>
      {error ? <ErrorState message={error} /> : null}
      <div className="flex flex-wrap gap-2">
        <Badge>{active.length} active</Badge>
        <Badge>{proposed.length} suggested</Badge>
        <Badge>{historical.length} superseded / archived</Badge>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Active Memory">
          {active.length === 0 ? (
            <EmptyState
              title="No active memory"
              description="Save durable Case context here when something should remain available to Nyaya."
            />
          ) : (
            <div className="space-y-4">
              {groupByType(active).map(([type, items]) => (
                <div key={type}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">
                    {type}
                  </p>
                  <ul className="space-y-2">
                    {items.map((memory) => (
                      <li key={memory.id}>
                        <button
                          type="button"
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                            selected?.id === memory.id
                              ? "border-accent bg-accent-soft/40"
                              : "border-line bg-white hover:bg-accent-soft/20"
                          }`}
                          onClick={() => setSelected(memory)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{memory.title}</span>
                            <VerifiedBadge />
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-ink/60">{memory.content}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Proposed memories">
          <div className="mb-3 flex gap-2">
            <input
              className="flex-1 rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Optional hint for proposal"
              aria-label="Memory proposal hint"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
            />
            <Button disabled={busy} onClick={propose}>
              Propose
            </Button>
          </div>
          {proposed.length === 0 ? (
            <p className="text-sm text-ink/70">
              No proposals. Nyaya may suggest durable context, but nothing is saved without
              approval.
            </p>
          ) : (
            <div className="space-y-4">
              {groupByType(proposed).map(([type, items]) => (
                <div key={type}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/55">
                    {type}
                  </p>
                  <ul aria-label="Proposed memories" className="space-y-2">
                    {items.map((memory) => (
                      <li key={memory.id}>
                        <button
                          type="button"
                          className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                            selected?.id === memory.id
                              ? "border-amber-700/40 bg-amber-50/60"
                              : "border-amber-700/20 bg-amber-50/40"
                          }`}
                          onClick={() => setSelected(memory)}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{memory.title}</span>
                            <SuggestedBadge />
                          </div>
                          <p className="mt-1 line-clamp-2 text-xs text-ink/60">{memory.content}</p>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Panel title={selected ? selected.title : "Memory detail"}>
        {!selected ? (
          <p className="text-sm text-ink/60">Select a memory to inspect sources and review.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              {selected.badge === "verified" ? <VerifiedBadge /> : null}
              {selected.badge === "suggested" ? <SuggestedBadge /> : null}
              <Badge>{selected.memoryType}</Badge>
              <Badge>{selected.importance}</Badge>
              <Badge>{selected.origin ?? "unknown"}</Badge>
            </div>
            <p className="text-ink/80">{selected.content}</p>
            {selected.rationale ? (
              <p className="text-xs text-ink/55">Rationale: {selected.rationale}</p>
            ) : null}

            <div>
              <p className="font-semibold">Provenance</p>
              {selected.sources.length === 0 ? (
                <p className="text-ink/55">
                  No document chunks cited. Review the rationale before approving — Nyaya does not
                  auto-verify Memory.
                </p>
              ) : (
                <Button type="button" variant="secondary" onClick={() => openSources(selected)}>
                  Inspect sources ({selected.sources.length})
                </Button>
              )}
            </div>

            {(selected.relatedPeople.length > 0 || selected.relatedEvents.length > 0) && (
              <div className="flex flex-wrap gap-3 text-xs">
                {selected.relatedPeople.map((person) => (
                  <Link
                    key={person.id}
                    href={`/app/cases/${matterId}/people?entityId=${person.id}`}
                    className="font-semibold text-accent underline"
                  >
                    People: {person.displayName}
                  </Link>
                ))}
                {selected.relatedEvents.map((event) => (
                  <Link
                    key={event.id}
                    href={`/app/cases/${matterId}/timeline?eventId=${event.id}`}
                    className="font-semibold text-accent underline"
                  >
                    Timeline: {event.title}
                  </Link>
                ))}
              </div>
            )}

            <div className="space-y-2 rounded-lg border border-line p-3">
              <p className="font-semibold">
                {selected.status === "proposed" ? "Edit before approve" : "Supersede / edit"}
              </p>
              <input
                className="w-full rounded border border-line px-2 py-1.5"
                aria-label="Edit memory title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
              <textarea
                className="w-full rounded border border-line px-2 py-1.5"
                aria-label="Edit memory content"
                rows={4}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  className="rounded border border-line px-2 py-1.5"
                  aria-label="Edit memory type"
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as (typeof MEMORY_TYPES)[number])}
                >
                  {MEMORY_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded border border-line px-2 py-1.5"
                  aria-label="Edit memory importance"
                  value={editImportance}
                  onChange={(e) => setEditImportance(e.target.value)}
                >
                  <option value="low">low</option>
                  <option value="normal">normal</option>
                  <option value="high">high</option>
                  <option value="critical">critical</option>
                </select>
              </div>
            </div>

            {selected.status === "proposed" ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy} onClick={() => review("approve")}>
                  Approve
                </Button>
                <Button
                  type="button"
                  disabled={busy || !editTitle.trim() || !editContent.trim()}
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
            ) : isVerified(selected.status) && !selected.supersededBy ? (
              <div className="flex flex-wrap gap-2">
                <Button type="button" disabled={busy} onClick={supersedeSelected}>
                  Supersede with edited copy
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  variant="ghost"
                  onClick={() => review("archive")}
                >
                  Archive
                </Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>

      <Panel title="Create / supersede memory">
        <form className="space-y-2" onSubmit={createManual}>
          <input
            className="w-full rounded border border-line px-2 py-1.5 text-sm"
            placeholder="Title"
            aria-label="New memory title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <textarea
            className="w-full rounded border border-line px-2 py-1.5 text-sm"
            placeholder="Content"
            aria-label="New memory content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={4}
          />
          <select
            className="w-full rounded border border-line px-2 py-1.5 text-sm"
            aria-label="New memory type"
            value={memoryType}
            onChange={(e) => setMemoryType(e.target.value as (typeof MEMORY_TYPES)[number])}
          >
            {MEMORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
          <select
            className="w-full rounded border border-line px-2 py-1.5 text-sm"
            aria-label="New memory importance"
            value={importance}
            onChange={(e) => setImportance(e.target.value)}
          >
            <option value="low">low</option>
            <option value="normal">normal</option>
            <option value="high">high</option>
            <option value="critical">critical</option>
          </select>
          <select
            className="w-full rounded border border-line px-2 py-1.5 text-sm"
            aria-label="Supersede existing memory"
            value={supersedeId}
            onChange={(e) => setSupersedeId(e.target.value)}
          >
            <option value="">Do not supersede</option>
            {active.map((memory) => (
              <option key={memory.id} value={memory.id}>
                Supersede: {memory.title}
              </option>
            ))}
          </select>
          <p className="text-xs text-ink/55">
            Manual entries are recorded as <VerifiedBadge /> immediately. Nyaya proposals stay{" "}
            <SuggestedBadge /> until you approve them on this tab.
          </p>
          <Button disabled={busy} type="submit">
            Save approved memory
          </Button>
        </form>
      </Panel>

      <Panel title="Historical / superseded">
        {historical.length === 0 ? (
          <p className="text-sm text-ink/70">No superseded or archived memories.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {historical.map((memory) => (
              <li key={memory.id}>
                <button type="button" className="text-left" onClick={() => setSelected(memory)}>
                  <span className="font-semibold">{memory.title}</span> · {memory.status}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
