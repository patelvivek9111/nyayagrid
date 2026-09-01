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
  isVerifiedStatus,
  memoryGroupId,
  memoryGroupLabel,
  sourceCountLabel,
  trustStatusFromRecord,
  userFacingLoadError,
} from "@/lib/case-intelligence-ux";

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

type MemoryFilter = "active" | "suggested" | "history";

function groupActive(items: MemoryItem[]) {
  const groups = new Map<string, MemoryItem[]>();
  for (const item of items) {
    const id = memoryGroupId(item.memoryType);
    const list = groups.get(id) ?? [];
    list.push(item);
    groups.set(id, list);
  }
  const order = ["confirmed_facts", "strategy", "instructions", "preferences", "other"];
  return order
    .filter((id) => (groups.get(id) ?? []).length > 0)
    .map((id) => ({ id, label: memoryGroupLabel(id), items: groups.get(id) ?? [] }));
}

export default function CaseMemoryPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [selected, setSelected] = useState<MemoryItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<MemoryFilter>("active");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [hint, setHint] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [memoryType, setMemoryType] = useState<(typeof MEMORY_TYPES)[number]>("verified_context");
  const [importance, setImportance] = useState("normal");
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [editType, setEditType] = useState<(typeof MEMORY_TYPES)[number]>("verified_context");
  const [editImportance, setEditImportance] = useState("normal");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  async function load(keepId?: string | null) {
    const res = await fetch(`/api/v1/matters/${matterId}/memory`);
    const json = await res.json();
    if (!res.ok) throw new Error(userFacingLoadError("memory", res.status));
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
      .catch((err) => setError(err instanceof Error ? err.message : userFacingLoadError("memory")))
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
    () => memories.filter((m) => isVerifiedStatus(m.status) && !m.supersededBy),
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
  const visible = filter === "active" ? active : filter === "suggested" ? proposed : historical;
  const grouped = filter === "active" ? groupActive(active) : null;

  async function createManual(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content, memoryType, importance }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error("We couldn't save that memory. Try again.");
      setTitle("");
      setContent("");
      setAddOpen(false);
      await load(json.memory?.id ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that memory. Try again.");
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
      if (!res.ok) throw new Error("We couldn't suggest memory. Try again.");
      setFilter("suggested");
      await load(json.proposals?.[0]?.id ?? selected?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't suggest memory. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function review(
    action: "approve" | "edit_and_approve" | "reject" | "archive",
    target = selected,
  ) {
    if (!target) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/memory/${target.id}/review`, {
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
      if (!res.ok) throw new Error("We couldn't update that memory. Try again.");
      setEditOpen(false);
      if (action === "approve" || action === "edit_and_approve") setFilter("active");
      await load(action === "reject" || action === "archive" ? null : target.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update that memory. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveUpdatedMemory() {
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
      if (!res.ok) throw new Error("We couldn't save the updated memory. Try again.");
      setEditOpen(false);
      await load(json.memory?.id ?? null);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We couldn't save the updated memory. Try again.",
      );
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
        documentId: s.documentId,
      })),
    );
    setDrawerOpen(true);
  }

  if (loading) return <LoadingState label="Loading memory…" />;

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        title="Memory"
        description="What Nyaya should remember about this case. Suggestions are not confirmed until you say so."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="w-44 rounded border border-line px-3 py-1.5 text-sm"
              placeholder="Optional hint"
              aria-label="Memory proposal hint"
              value={hint}
              onChange={(e) => setHint(e.target.value)}
            />
            <Button type="button" variant="secondary" disabled={busy} onClick={propose}>
              Suggest from case
            </Button>
            <Button type="button" onClick={() => setAddOpen(true)}>
              + Add memory
            </Button>
          </div>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <FilterChipBar
        value={filter}
        onChange={(id) => setFilter(id as MemoryFilter)}
        options={[
          { id: "active", label: "Active", count: active.length },
          { id: "suggested", label: "Suggested by Nyaya", count: proposed.length },
          { id: "history", label: "Memory history", count: historical.length },
        ]}
      />
      {filter === "suggested" ? (
        <p className="text-xs text-ink/55">
          Suggestions stay unconfirmed until you accept them. Review remains the approval gate.
        </p>
      ) : null}

      <div className={selected ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" : undefined}>
        <div>
          {visible.length === 0 ? (
            <EmptyState
              title={
                filter === "active"
                  ? "No active case memories yet."
                  : filter === "suggested"
                    ? "No suggested memory yet."
                    : "No memory history yet."
              }
              description={
                filter === "active"
                  ? "Save confirmed facts, strategy, and instructions Nyaya should keep in mind."
                  : filter === "suggested"
                    ? "Nyaya may suggest durable context, but nothing is saved without your approval."
                    : "Previous versions and archived items will appear here."
              }
            />
          ) : grouped ? (
            <div className="space-y-5">
              {grouped.map((group) => (
                <section key={group.id}>
                  <h3 className="mb-2 font-display text-lg text-ink">{group.label}</h3>
                  <ul className="space-y-2">
                    {group.items.map((memory) => (
                      <MemoryCard
                        key={memory.id}
                        memory={memory}
                        selected={selected?.id === memory.id}
                        onSelect={setSelected}
                        busy={busy}
                        reviewHref={`/app/cases/${matterId}/review`}
                        onAccept={() => void review("approve", memory)}
                        onDismiss={() => void review("reject", memory)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <ul aria-label="Proposed memories" className="space-y-2">
              {visible.map((memory) => (
                <MemoryCard
                  key={memory.id}
                  memory={memory}
                  selected={selected?.id === memory.id}
                  onSelect={setSelected}
                  busy={busy}
                  reviewHref={`/app/cases/${matterId}/review`}
                  onAccept={() => void review("approve", memory)}
                  onDismiss={() => void review("reject", memory)}
                />
              ))}
            </ul>
          )}
        </div>

        <IntelligenceInspector
          open={Boolean(selected)}
          title={selected?.title ?? "Memory"}
          subtitle={selected ? humanizeKey(selected.memoryType) : undefined}
          status={
            selected ? (
              <TrustStatus
                kind={trustStatusFromRecord({ status: selected.status, badge: selected.badge })}
              />
            ) : undefined
          }
          onClose={() => setSelected(null)}
          actions={
            selected ? (
              <>
                <Button type="button" variant="secondary" onClick={() => openSources(selected)}>
                  {sourceCountLabel(selected.sources.length)}
                </Button>
                {selected.status === "proposed" ? (
                  <>
                    <Button type="button" disabled={busy} onClick={() => review("approve")}>
                      Accept
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      variant="ghost"
                      onClick={() => review("reject")}
                    >
                      Dismiss
                    </Button>
                    <Link
                      href={`/app/cases/${matterId}/review`}
                      className="inline-flex items-center text-sm font-semibold text-accent underline"
                    >
                      Open Review
                    </Link>
                  </>
                ) : isVerifiedStatus(selected.status) && !selected.supersededBy ? (
                  <>
                    <Button type="button" variant="secondary" onClick={() => setEditOpen(true)}>
                      Edit
                    </Button>
                    <Button
                      type="button"
                      disabled={busy}
                      variant="ghost"
                      onClick={() => review("archive")}
                    >
                      Archive
                    </Button>
                  </>
                ) : null}
              </>
            ) : null
          }
        >
          {selected ? (
            <>
              <p className="text-ink/80">{selected.content}</p>
              {selected.rationale ? (
                <p className="text-xs text-ink/55">{selected.rationale}</p>
              ) : null}
              {(selected.relatedPeople.length > 0 || selected.relatedEvents.length > 0) && (
                <RelatedList heading="Related">
                  <div className="flex flex-col gap-1">
                    {selected.relatedPeople.map((person) => (
                      <Link
                        key={person.id}
                        href={`/app/cases/${matterId}/people?entityId=${person.id}`}
                        className="font-semibold text-accent underline"
                      >
                        {person.displayName}
                      </Link>
                    ))}
                    {selected.relatedEvents.map((event) => (
                      <Link
                        key={event.id}
                        href={`/app/cases/${matterId}/timeline?eventId=${event.id}`}
                        className="font-semibold text-accent underline"
                      >
                        {event.title}
                      </Link>
                    ))}
                  </div>
                </RelatedList>
              )}
            </>
          ) : null}
        </IntelligenceInspector>
      </div>

      <IntelligenceDialog
        open={addOpen}
        title="Add memory"
        description="Manual entries are recorded as verified immediately."
        onClose={() => setAddOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={createManual}>
          <input
            className="rounded border border-line px-3 py-2 text-sm"
            placeholder="Title"
            aria-label="New memory title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <textarea
            className="rounded border border-line px-3 py-2 text-sm"
            placeholder="What should Nyaya remember?"
            aria-label="New memory content"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            required
            rows={4}
          />
          <select
            className="rounded border border-line px-3 py-2 text-sm"
            aria-label="Memory type"
            value={memoryType}
            onChange={(e) => setMemoryType(e.target.value as (typeof MEMORY_TYPES)[number])}
          >
            {MEMORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanizeKey(type)}
              </option>
            ))}
          </select>
          <select
            className="rounded border border-line px-3 py-2 text-sm"
            aria-label="Priority"
            value={importance}
            onChange={(e) => setImportance(e.target.value)}
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
          <Button disabled={busy} type="submit">
            Save memory
          </Button>
        </form>
      </IntelligenceDialog>

      <IntelligenceDialog
        open={editOpen}
        title="Edit memory"
        description="Editing preserves the previous version in history."
        onClose={() => setEditOpen(false)}
      >
        <div className="flex flex-col gap-3">
          <input
            className="rounded border border-line px-3 py-2 text-sm"
            aria-label="Edit memory title"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
          />
          <textarea
            className="rounded border border-line px-3 py-2 text-sm"
            aria-label="Edit memory content"
            rows={4}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
          />
          <select
            className="rounded border border-line px-3 py-2 text-sm"
            aria-label="Edit memory type"
            value={editType}
            onChange={(e) => setEditType(e.target.value as (typeof MEMORY_TYPES)[number])}
          >
            {MEMORY_TYPES.map((type) => (
              <option key={type} value={type}>
                {humanizeKey(type)}
              </option>
            ))}
          </select>
          {selected?.status === "proposed" ? (
            <Button
              type="button"
              disabled={busy || !editTitle.trim() || !editContent.trim()}
              onClick={() => review("edit_and_approve")}
            >
              Save and accept
            </Button>
          ) : (
            <Button type="button" disabled={busy} onClick={saveUpdatedMemory}>
              Save updated memory
            </Button>
          )}
        </div>
      </IntelligenceDialog>
      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}

function MemoryCard({
  memory,
  selected,
  onSelect,
  busy,
  reviewHref,
  onAccept,
  onDismiss,
}: {
  memory: MemoryItem;
  selected: boolean;
  onSelect: (memory: MemoryItem) => void;
  busy: boolean;
  reviewHref: string;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const suggested = memory.status === "proposed" || memory.badge === "suggested";
  return (
    <li
      className={`rounded-lg border px-4 py-3 ${
        selected
          ? "border-accent bg-accent-soft/40"
          : suggested
            ? "border-amber-700/20 bg-amber-50/40"
            : "border-line bg-white"
      }`}
    >
      <button type="button" className="w-full text-left" onClick={() => onSelect(memory)}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{memory.title}</span>
          <TrustStatus
            kind={trustStatusFromRecord({ status: memory.status, badge: memory.badge })}
          />
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-ink/70">{memory.content}</p>
        {memory.sources[0]?.documentTitle ? (
          <p className="mt-1 text-xs text-ink/50">Source: {memory.sources[0].documentTitle}</p>
        ) : null}
      </button>
      {suggested ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" disabled={busy} onClick={onAccept}>
            Accept
          </Button>
          <Button type="button" variant="ghost" disabled={busy} onClick={onDismiss}>
            Dismiss
          </Button>
          <Link
            href={reviewHref}
            className="inline-flex items-center text-sm font-semibold text-accent underline"
          >
            Review
          </Link>
        </div>
      ) : null}
    </li>
  );
}
