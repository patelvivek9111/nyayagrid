"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Button } from "@nyayagrid/ui";
import Link from "next/link";
import {
  EmptyState,
  ErrorState,
  FilterChipBar,
  IntelligenceHeader,
  IntelligenceInspector,
  LoadingState,
  OverflowMenu,
  TrustStatus,
} from "@/components/ux";
import { useMatterChrome } from "@/components/use-matter-chrome";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";
import { humanizeKey } from "@/lib/plain-labels";
import {
  filterReviewQueue,
  flattenReviewQueue,
  isAnalysisReviewKind,
  reviewCategoryCounts,
  type ReviewQueueCategory,
} from "@/lib/workspace-ux";

type ReviewItem =
  | { kind: "event"; item: any }
  | { kind: "fact"; item: any }
  | { kind: "entity"; item: any }
  | { kind: "deadline"; item: any }
  | { kind: "graph"; item: any }
  | { kind: "contractItem"; item: any }
  | { kind: "finding"; item: any }
  | { kind: "redline"; item: any }
  | { kind: "memory"; item: any };

function isAnalysisKind(kind: ReviewItem["kind"]): boolean {
  return isAnalysisReviewKind(kind);
}

function proposedMemoryTypeLabel(memoryType: string): string {
  if (memoryType === "verified_context") return "Proposed context";
  return humanizeKey(memoryType);
}

function memoryOriginLabel(item: { origin?: string | null; sources?: unknown[] }): string {
  if (item.origin === "manual") return "Manually added — awaiting review";
  if (item.origin === "ai" && (item.sources?.length ?? 0) > 0) return "Suggested by Nyaya";
  if (item.origin === "ai") return "Suggested by Nyaya";
  return "Suggested Memory";
}

function memoryEmptySourceMessage(item: { origin?: string | null }): string {
  if (item.origin === "manual") return "Manually added. No document source attached.";
  return "No document source attached.";
}

function findingBucket(finding: { runType?: string; findingType?: string }): string {
  if (finding.runType === "deposition") return "deposition";
  if (finding.runType === "discovery") return "discovery";
  if (
    finding.runType === "contradiction" ||
    finding.findingType === "contradiction" ||
    finding.findingType === "tension"
  ) {
    return "contradiction";
  }
  return "other";
}

function ProvenanceList({
  sources,
  emptyMessage,
}: {
  sources: Array<{
    id: string;
    documentTitle?: string | null;
    page?: number | null;
    supportingText?: string | null;
    segmentRef?: string | null;
    side?: string | null;
  }>;
  emptyMessage: string;
}) {
  if (!sources.length) {
    return <p className="text-ink/70">{emptyMessage}</p>;
  }
  return (
    <ul className="space-y-2">
      {sources.map((source) => (
        <li key={source.id} className="rounded border border-line p-2">
          <div className="text-xs text-ink/60">
            {source.documentTitle ?? "Case document"}
            {source.page != null ? ` · page ${source.page}` : ""}
            {source.side ? ` · ${source.side}` : ""}
            {source.segmentRef ? ` · ${source.segmentRef}` : ""}
          </div>
          {source.supportingText ? <p>{source.supportingText}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export default function MatterReviewPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const { canReview, canReviewAnalysis, refreshChrome } = useMatterChrome();
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ReviewItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [category, setCategory] = useState<ReviewQueueCategory>("all");

  async function load() {
    const res = await fetch(`/api/v1/matters/${matterId}/intelligence/review`);
    const json = await res.json();
    if (!res.ok) throw new Error(userFacingLoadError("review", res.status));
    setData(json);
    await refreshChrome();
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
      if (!res.ok) throw new Error("We couldn't refresh case intelligence. Try again.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We couldn't refresh case intelligence. Try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function selectItem(kind: ReviewItem["kind"], item: any) {
    setSelected({ kind, item });
    setEditTitle(item.title ?? item.displayName ?? item.label ?? item.relationshipType ?? "");
    setEditContent(item.content ?? "");
    setRejectReason("");
  }

  async function review(action: "approve" | "edit_and_approve" | "reject") {
    if (!selected || isAnalysisKind(selected.kind) || selected.kind === "memory") return;
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
      } else if (selected.kind === "graph") {
        url = `/api/v1/matters/${matterId}/graph/edges/${selected.item.id}/review`;
        if (action === "edit_and_approve") {
          body.edits = { label: editTitle || null };
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

  async function reviewMemory(action: "approve" | "edit_and_approve" | "reject") {
    if (!selected || selected.kind !== "memory") return;
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> =
        action === "edit_and_approve"
          ? {
              action,
              edits: {
                title: editTitle.trim(),
                content: editContent.trim(),
              },
            }
          : { action, rejectionReason: rejectReason || null };
      const res = await fetch(`/api/v1/matters/${matterId}/memory/${selected.item.id}/review`, {
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

  async function reviewAnalysis(action: "reviewed" | "dismissed" | "accepted" | "rejected") {
    if (!selected || !isAnalysisKind(selected.kind)) return;
    setBusy(true);
    setError("");
    try {
      let url = "";
      let body: Record<string, unknown> = {};
      if (selected.kind === "contractItem") {
        url = `/api/v1/matters/${matterId}/analysis/contracts/${selected.item.analysisId}/items/${selected.item.id}/review`;
        body = { action };
      } else if (selected.kind === "finding") {
        url = `/api/v1/matters/${matterId}/analysis/findings/${selected.item.id}/review`;
        body = { action };
      } else {
        url = `/api/v1/matters/${matterId}/analysis/redlines/${selected.item.id}/review`;
        body = { status: action };
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

  const queue = useMemo(() => flattenReviewQueue(data ?? {}), [data]);
  const countsByCategory = reviewCategoryCounts(queue);
  const visibleQueue = filterReviewQueue(queue, category);
  const selectedEntry = selected
    ? queue.find((entry) => entry.kind === selected.kind && entry.id === selected.item.id)
    : null;

  if (!data && !error) {
    return <LoadingState label="Loading review…" />;
  }

  const filterOptions = (
    [
      ["all", "All"],
      ["facts", "Facts"],
      ["deadlines", "Deadlines"],
      ["memory", "Memory"],
      ["analysis", "Analysis"],
      ["timeline", "Timeline"],
      ["people", "People"],
      ["graph", "Graph"],
    ] as const
  )
    .filter(([id]) => id === "all" || countsByCategory[id] > 0)
    .map(([id, label]) => ({
      id,
      label,
      count: countsByCategory[id],
    }));

  const inspectorOpen = Boolean(selected);

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        title="Review"
        description="Opening this page does not approve anything. Suggested items stay suggested until someone with review access inspects the source and decides."
        actions={
          canReview ? (
            <OverflowMenu label="More">
              <Button type="button" variant="ghost" disabled={busy} onClick={extract}>
                Refresh case intelligence
              </Button>
            </OverflowMenu>
          ) : null
        }
      />
      <p className="sr-only" title="Suggested relationships">
        Suggested relationships
      </p>
      <p className="sr-only" title="Nyaya Memory">
        Nyaya Memory
      </p>
      <p className="sr-only">Analysis waiting for review</p>
      <p className="text-sm font-semibold text-ink">
        {queue.length === 1 ? "1 item needs your review" : `${queue.length} items need your review`}
      </p>
      <FilterChipBar
        value={category}
        onChange={(id) => setCategory(id as ReviewQueueCategory)}
        options={filterOptions}
      />
      {error ? <ErrorState message={error} /> : null}

      {queue.length === 0 ? (
        <EmptyState
          title="No items waiting for review"
          description="When Nyaya extracts suggestions from case files, they will appear here until you inspect the source and decide."
        />
      ) : (
        <div
          className={inspectorOpen ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" : undefined}
        >
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-white">
            {visibleQueue.length === 0 ? (
              <li className="px-4 py-6 text-sm text-ink/55">No items in this category.</li>
            ) : (
              visibleQueue.map((entry) => {
                const active = selected?.kind === entry.kind && selected.item.id === entry.id;
                return (
                  <li key={`${entry.kind}-${entry.id}`}>
                    <button
                      type="button"
                      className={`w-full px-4 py-3 text-left ${active ? "bg-accent-soft/40" : "hover:bg-black/[0.02]"}`}
                      onClick={() => selectItem(entry.kind, entry.item)}
                    >
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                        {entry.category === "timeline"
                          ? "Timeline events"
                          : entry.category === "graph"
                            ? "Suggested relationships"
                            : entry.category === "memory"
                              ? "Nyaya Memory"
                              : entry.typeLabel}
                      </p>
                      <p className="font-semibold text-ink">{entry.title}</p>
                      <p className="mt-0.5 text-xs text-ink/55">{entry.subtitle}</p>
                    </button>
                  </li>
                );
              })
            )}
          </ul>

          <IntelligenceInspector
            open={inspectorOpen}
            title={
              selected?.kind === "graph"
                ? `${selected.item.fromName} → ${selected.item.toName}`
                : selected?.kind === "redline"
                  ? "Redline suggestion"
                  : String(
                      selected?.item.title ??
                        selected?.item.displayName ??
                        selected?.item.label ??
                        selectedEntry?.title ??
                        "Review item",
                    )
            }
            subtitle={selectedEntry?.typeLabel}
            status={<TrustStatus kind="suggested" />}
            onClose={() => setSelected(null)}
            actions={null}
          >
            {!selected ? null : selected.kind === "memory" ? (
              <div title="Nyaya Memory">
                <MemoryInspect
                  item={selected.item}
                  editTitle={editTitle}
                  editContent={editContent}
                  rejectReason={rejectReason}
                  busy={busy}
                  canReview={canReview}
                  onEditTitle={setEditTitle}
                  onEditContent={setEditContent}
                  onRejectReason={setRejectReason}
                  onReview={reviewMemory}
                />
              </div>
            ) : isAnalysisKind(selected.kind) ? (
              <AnalysisInspect
                selected={selected}
                busy={busy}
                canReviewAnalysis={canReviewAnalysis}
                onReview={reviewAnalysis}
              />
            ) : (
              <div className="space-y-3 text-sm">
                {selected.kind === "graph" ? (
                  <div>
                    <p className="font-semibold">
                      {selected.item.fromName} — {humanizeKey(selected.item.relationshipType)} →{" "}
                      {selected.item.toName}
                    </p>
                    <p className="mt-1 text-ink/60">
                      {selected.item.origin === "manual"
                        ? "Manually added relationship"
                        : "Suggested by Nyaya"}{" "}
                      · Suggested relationship
                    </p>
                    <p className="mt-1 text-xs text-ink/60">
                      Confirm only if the cited source supports this relationship.
                    </p>
                  </div>
                ) : selected.kind === "deadline" ? (
                  <div>
                    <p className="font-semibold">{selected.item.title}</p>
                    <p className="text-ink/60">
                      {selected.item.dueAt
                        ? new Date(selected.item.dueAt).toLocaleDateString()
                        : "Date unknown"}{" "}
                      · {selected.item.dateKind === "inferred" ? "Inferred from" : "Stated in"}{" "}
                      source
                    </p>
                  </div>
                ) : selected.kind === "fact" ? (
                  <div>
                    <p className="font-semibold">
                      {selected.item.label}: {selected.item.value}
                    </p>
                    <p className="text-ink/60">Suggested fact</p>
                  </div>
                ) : (
                  <div className="font-semibold">{selectedEntry?.title}</div>
                )}
                <input
                  className="w-full rounded border border-line px-3 py-2"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  aria-label={selected.kind === "graph" ? "Relationship label" : "Edit title"}
                />
                {selected.kind !== "graph" ? (
                  <p className="whitespace-pre-wrap text-ink/80">
                    {selected.item.description ||
                      selected.item.value ||
                      selected.item.uncertaintyNotes ||
                      ""}
                  </p>
                ) : null}
                <div>
                  <div className="mb-1 font-semibold">Source</div>
                  {(selected.item.sources ?? []).length === 0 ? (
                    <p className="text-ink/70">
                      {selected.kind === "graph" && selected.item.origin === "manual"
                        ? "Manually added relationship. No document support is stored."
                        : selected.kind === "graph"
                          ? "No document source is stored. An AI relationship cannot be confirmed without provenance."
                          : "No sources (cannot approve AI proposals without them)."}
                    </p>
                  ) : (
                    <ul className="space-y-2">
                      {selected.item.sources.map((source: any) => (
                        <li key={source.id} className="rounded border border-line p-2">
                          <div className="text-xs text-ink/60">
                            {source.documentTitle ?? "Case document"}
                            {source.page != null ? ` · page ${source.page}` : ""}
                          </div>
                          <p>{source.supportingText}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {canReview && selected.kind === "entity" ? (
                  <div>
                    <div className="mb-1 font-semibold">
                      Merge another proposed entity into this
                    </div>
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
                {canReview ? (
                  <textarea
                    className="w-full rounded border border-line px-3 py-2"
                    placeholder="Rejection reason (optional)"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                ) : null}
                {canReview ? (
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy} onClick={() => review("approve")}>
                      Confirm
                    </Button>
                    <Button
                      disabled={busy}
                      variant="secondary"
                      onClick={() => review("edit_and_approve")}
                    >
                      Edit
                    </Button>
                    <Button disabled={busy} variant="ghost" onClick={() => review("reject")}>
                      Dismiss
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-ink/60">
                    {
                      "You can inspect sources. Approving or rejecting these suggestions requires review access."
                    }
                  </p>
                )}
              </div>
            )}
          </IntelligenceInspector>
        </div>
      )}
    </div>
  );
}

function AnalysisInspect({
  selected,
  busy,
  canReviewAnalysis,
  onReview,
}: {
  selected: ReviewItem;
  busy: boolean;
  canReviewAnalysis: boolean;
  onReview: (action: "reviewed" | "dismissed" | "accepted" | "rejected") => void;
}) {
  const { matterId } = useParams<{ matterId: string }>();
  const item = selected.item;
  const sources = item.sources ?? [];
  const sideA = sources.find((s: { side?: string }) => s.side === "A");
  const sideB = sources.find((s: { side?: string }) => s.side === "B");
  const contradiction = findingBucket(item) === "contradiction";

  return (
    <div className="space-y-3 text-sm">
      {selected.kind === "contractItem" ? (
        <>
          <p className="font-semibold">{item.title}</p>
          <p className="text-ink/60">
            Analysis finding awaiting review · Nyaya analysis · {humanizeKey(item.category)}
          </p>
          {item.documentTitle ? <p className="text-xs text-ink/60">{item.documentTitle}</p> : null}
          {item.originalText ? (
            <div>
              <div className="mb-1 font-semibold">Original text</div>
              <p className="whitespace-pre-wrap">{item.originalText}</p>
            </div>
          ) : null}
          {item.explanation ? (
            <div>
              <div className="mb-1 font-semibold">Nyaya explanation</div>
              <p className="whitespace-pre-wrap">{item.explanation}</p>
            </div>
          ) : null}
          <div>
            <div className="mb-1 font-semibold">Source</div>
            <ProvenanceList sources={sources} emptyMessage="Source support unavailable" />
          </div>
        </>
      ) : null}

      {selected.kind === "finding" ? (
        <>
          <p className="font-semibold">{item.title}</p>
          {contradiction ? (
            <>
              <p className="text-ink/60">Evidence conflict · Suggested by Nyaya</p>
              <p className="text-xs text-ink/60">
                Nyaya does not choose which account is true. Possible inconsistency in the cited
                sources. This is not a finding that a statement is false.
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-line bg-black/[0.02] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                    Side A
                  </p>
                  <p className="mt-1 font-semibold">{sideA?.documentTitle ?? "Source A"}</p>
                  <p className="mt-1 text-xs text-ink/70">
                    {sideA?.supportingText ?? "No Side A summary stored."}
                  </p>
                </div>
                <div className="rounded-lg border border-line bg-black/[0.02] p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                    Side B
                  </p>
                  <p className="mt-1 font-semibold">{sideB?.documentTitle ?? "Source B"}</p>
                  <p className="mt-1 text-xs text-ink/70">
                    {sideB?.supportingText ?? "No Side B summary stored."}
                  </p>
                </div>
              </div>
              <Link
                href={`/app/cases/${matterId}/evidence`}
                className="inline-block font-semibold text-accent underline"
              >
                Review evidence
              </Link>
            </>
          ) : (
            <>
              <p className="text-ink/60">
                Suggested finding · Nyaya analysis · {humanizeKey(item.findingType)}
                {item.runType ? ` · ${humanizeKey(item.runType)}` : ""}
              </p>
              {item.findingType === "tension" ? (
                <p className="text-xs text-ink/60">
                  Possible inconsistency in the cited sources. This is not a finding that a
                  statement is false.
                </p>
              ) : null}
              {item.explanation ? <p className="whitespace-pre-wrap">{item.explanation}</p> : null}
              <div>
                <div className="mb-1 font-semibold">Source testimony</div>
                <ProvenanceList sources={sources} emptyMessage="Source support unavailable" />
              </div>
            </>
          )}
        </>
      ) : null}

      {selected.kind === "redline" ? (
        <>
          <p className="font-semibold">Redline suggestion</p>
          <p className="text-ink/60">Analysis finding awaiting review · Nyaya analysis</p>
          {item.documentTitle ? <p className="text-xs text-ink/60">{item.documentTitle}</p> : null}
          <div>
            <div className="mb-1 font-semibold">Current clause</div>
            <p className="whitespace-pre-wrap">{item.currentClause}</p>
          </div>
          <div>
            <div className="mb-1 font-semibold">Proposed clause</div>
            <p className="whitespace-pre-wrap">{item.proposedClause}</p>
          </div>
          {item.reason ? <p className="text-ink/80">{item.reason}</p> : null}
          {!item.currentClause && !item.chunkId ? (
            <p className="text-ink/70">Source support unavailable</p>
          ) : null}
        </>
      ) : null}

      {canReviewAnalysis && selected.kind === "redline" ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => onReview("accepted")}>
            Accept
          </Button>
          <Button disabled={busy} variant="ghost" onClick={() => onReview("rejected")}>
            Reject
          </Button>
        </div>
      ) : null}

      {canReviewAnalysis && selected.kind !== "redline" ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => onReview("reviewed")}>
            Mark reviewed
          </Button>
          <Button disabled={busy} variant="ghost" onClick={() => onReview("dismissed")}>
            Dismiss
          </Button>
        </div>
      ) : null}

      {!canReviewAnalysis ? (
        <p className="text-sm text-ink/60">
          You can inspect this analysis finding. Mark reviewed and Dismiss require document edit
          access.
        </p>
      ) : null}
    </div>
  );
}

function MemoryInspect({
  item,
  editTitle,
  editContent,
  rejectReason,
  busy,
  canReview,
  onEditTitle,
  onEditContent,
  onRejectReason,
  onReview,
}: {
  item: any;
  editTitle: string;
  editContent: string;
  rejectReason: string;
  busy: boolean;
  canReview: boolean;
  onEditTitle: (value: string) => void;
  onEditContent: (value: string) => void;
  onRejectReason: (value: string) => void;
  onReview: (action: "approve" | "edit_and_approve" | "reject") => void;
}) {
  const sources = item.sources ?? [];
  const sourced = sources.length > 0;

  return (
    <div className="space-y-3 text-sm">
      <p className="font-semibold">{item.title}</p>
      <p className="text-ink/60">
        {memoryOriginLabel(item)} · {proposedMemoryTypeLabel(item.memoryType)} · Suggested Memory
      </p>
      {item.origin === "ai" && sourced ? (
        <p className="text-xs text-ink/60">Derived from Case sources</p>
      ) : null}
      <p className="text-xs text-ink/60">
        Approving adds this to Nyaya Memory for this Case. It remains a reviewed note, not a
        verified legal conclusion.
      </p>
      <p className="whitespace-pre-wrap text-ink/80">{item.content}</p>
      <div>
        <div className="mb-1 font-semibold">Source</div>
        <ProvenanceList sources={sources} emptyMessage={memoryEmptySourceMessage(item)} />
      </div>
      {canReview ? (
        <>
          <input
            className="w-full rounded border border-line px-3 py-2"
            value={editTitle}
            onChange={(e) => onEditTitle(e.target.value)}
            aria-label="Memory title"
          />
          <textarea
            className="w-full rounded border border-line px-3 py-2"
            value={editContent}
            onChange={(e) => onEditContent(e.target.value)}
            aria-label="Memory content"
            rows={4}
          />
          <textarea
            className="w-full rounded border border-line px-3 py-2"
            placeholder="Rejection reason (optional)"
            value={rejectReason}
            onChange={(e) => onRejectReason(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => onReview("approve")}>
              Approve
            </Button>
            <Button
              disabled={busy}
              variant="secondary"
              onClick={() => onReview("edit_and_approve")}
            >
              Edit & approve
            </Button>
            <Button disabled={busy} variant="ghost" onClick={() => onReview("reject")}>
              Reject
            </Button>
          </div>
        </>
      ) : (
        <p className="text-sm text-ink/60">
          You can inspect this Memory. Approving or rejecting requires review access.
        </p>
      )}
    </div>
  );
}
