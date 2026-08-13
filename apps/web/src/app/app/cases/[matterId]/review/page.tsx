"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Panel } from "@nyayagrid/ui";

type ReviewItem =
  | { kind: "event"; item: any }
  | { kind: "fact"; item: any }
  | { kind: "entity"; item: any }
  | { kind: "deadline"; item: any };

export default function MatterReviewPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    const res = await fetch(`/api/v1/matters/${matterId}/intelligence/review`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load review queue");
    setData(json);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [matterId]);

  async function extract() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/intelligence/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Extraction failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  }

  function selectItem(kind: ReviewItem["kind"], item: any) {
    setSelected({ kind, item });
    setEditTitle(item.title ?? item.displayName ?? item.label ?? "");
    setRejectReason("");
  }

  async function review(action: "approve" | "edit_and_approve" | "reject") {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      let url = "";
      let body: Record<string, unknown> = { action, rejectionReason: rejectReason || null };
      if (selected.kind === "event") {
        url = `/api/v1/matters/${matterId}/timeline/${selected.item.id}/review`;
        if (action === "edit_and_approve") {
          body.edits = { title: editTitle };
        }
      } else if (selected.kind === "fact") {
        url = `/api/v1/matters/${matterId}/facts/${selected.item.id}/review`;
        if (action === "edit_and_approve") {
          body.edits = { label: editTitle };
        }
      } else if (selected.kind === "entity") {
        url = `/api/v1/matters/${matterId}/entities/${selected.item.id}/review`;
        if (action === "edit_and_approve") {
          body.edits = { displayName: editTitle };
        }
      } else {
        url = `/api/v1/matters/${matterId}/deadlines/${selected.item.id}/review`;
        if (action === "edit_and_approve") {
          body.edits = { title: editTitle };
        }
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Review failed");
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function mergeIntoSelected(mergeEntityId: string) {
    if (!selected || selected.kind !== "entity") return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/entities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keepEntityId: selected.item.id,
          mergeEntityId,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Merge failed");
      setSelected(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data && !error) {
    return <p>Loading…</p>;
  }

  const counts = data?.counts ?? {};

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge>{counts.proposedEvents ?? 0} proposed events</Badge>
        <Badge>{counts.proposedFacts ?? 0} proposed facts</Badge>
        <Badge>{counts.proposedEntities ?? 0} proposed entities</Badge>
        <Badge>{counts.proposedDeadlines ?? 0} proposed deadlines</Badge>
        <Button disabled={busy} onClick={extract}>
          {busy ? "Working…" : "Run extraction"}
        </Button>
      </div>
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4">
          <Panel title="Timeline events">
            {(data?.events ?? []).length === 0 ? (
              <p className="text-sm text-ink/70">No proposed timeline events.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.events.map((event: any) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      className="text-left font-semibold hover:text-accent"
                      onClick={() => selectItem("event", event)}
                    >
                      {event.title}
                    </button>
                    <div className="text-ink/60">
                      {event.eventType} · {event.confidence} · {(event.sources ?? []).length}{" "}
                      sources
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Facts">
            {(data?.facts ?? []).length === 0 ? (
              <p className="text-sm text-ink/70">No proposed facts.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.facts.map((fact: any) => (
                  <li key={fact.id}>
                    <button
                      type="button"
                      className="text-left font-semibold hover:text-accent"
                      onClick={() => selectItem("fact", fact)}
                    >
                      {fact.label}: {fact.value}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="People & organizations">
            {(data?.entities ?? []).length === 0 ? (
              <p className="text-sm text-ink/70">No proposed entities.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.entities.map((entity: any) => (
                  <li key={entity.id}>
                    <button
                      type="button"
                      className="text-left font-semibold hover:text-accent"
                      onClick={() => selectItem("entity", entity)}
                    >
                      {entity.displayName}
                    </button>
                    <div className="text-ink/60">
                      {entity.entityType}
                      {(entity.roles ?? []).length
                        ? ` · ${(entity.roles as any[]).map((r: any) => r.role).join(", ")}`
                        : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Deadline candidates">
            {(data?.deadlines ?? []).length === 0 ? (
              <p className="text-sm text-ink/70">No proposed deadlines.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.deadlines.map((deadline: any) => (
                  <li key={deadline.id}>
                    <button
                      type="button"
                      className="text-left font-semibold hover:text-accent"
                      onClick={() => selectItem("deadline", deadline)}
                    >
                      {deadline.title}
                    </button>
                    <div className="text-ink/60">
                      {deadline.dateKind}
                      {deadline.dueAt ? ` · ${new Date(deadline.dueAt).toLocaleDateString()}` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Inspect & decide">
          {!selected ? (
            <p className="text-sm text-ink/70">
              Select a proposed item. Approve, edit then approve, or reject with a reason. There is
              no blind Approve All.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="font-semibold capitalize">{selected.kind}</div>
              <input
                className="w-full rounded border border-line px-3 py-2"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
              <p className="text-ink/80 whitespace-pre-wrap">
                {selected.item.description ||
                  selected.item.value ||
                  selected.item.uncertaintyNotes ||
                  ""}
              </p>
              <div>
                <div className="mb-1 font-semibold">Evidence</div>
                {(selected.item.sources ?? []).length === 0 ? (
                  <p className="text-ink/70">
                    No sources (cannot approve AI proposals without them).
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {selected.item.sources.map((source: any) => (
                      <li key={source.id} className="rounded border border-line p-2">
                        <div className="text-xs text-ink/60">
                          chunk {source.chunkId.slice(0, 8)}…
                          {source.page != null ? ` · page ${source.page}` : ""}
                        </div>
                        <p>{source.supportingText}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {selected.kind === "entity" ? (
                <div>
                  <div className="mb-1 font-semibold">Merge another proposed entity into this</div>
                  <div className="flex flex-wrap gap-2">
                    {(data?.entities ?? [])
                      .filter((e: any) => e.id !== selected.item.id)
                      .map((e: any) => (
                        <Button
                          key={e.id}
                          variant="secondary"
                          disabled={busy}
                          onClick={() => mergeIntoSelected(e.id)}
                        >
                          Merge {e.displayName}
                        </Button>
                      ))}
                  </div>
                </div>
              ) : null}
              <textarea
                className="w-full rounded border border-line px-3 py-2"
                placeholder="Rejection reason (optional)"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy} onClick={() => review("approve")}>
                  Approve
                </Button>
                <Button
                  disabled={busy}
                  variant="secondary"
                  onClick={() => review("edit_and_approve")}
                >
                  Edit & approve
                </Button>
                <Button disabled={busy} variant="ghost" onClick={() => review("reject")}>
                  Reject
                </Button>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
