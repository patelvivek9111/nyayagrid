"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@nyayagrid/ui";
import {
  EmptyState,
  ErrorState,
  IntelligenceDialog,
  IntelligenceHeader,
  IntelligenceInspector,
  FilterChipBar,
  LoadingState,
  RelatedList,
  SourceDrawer,
  TrustStatus,
  type SourceDrawerItem,
} from "@/components/ux";
import { humanizeKey } from "@/lib/plain-labels";
import {
  askNyayaHref,
  filterTimelineEvents,
  formatTimelineDateLine,
  formatTimelineDateCertainty,
  groupTimelineEventsByDate,
  isDisputedTimelineEvent,
  sourceCountLabel,
  trustStatusFromRecord,
  userFacingLoadError,
  type TimelineEventLike,
  type TimelineFilter,
} from "@/lib/case-intelligence-ux";

const EVENT_TYPE_OPTIONS = [
  { value: "manual_note", label: "Note" },
  { value: "communication", label: "Communication" },
  { value: "deadline", label: "Deadline" },
  { value: "meeting", label: "Meeting" },
  { value: "testimony", label: "Testimony" },
];

export default function MatterTimelinePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [relatedFindingFilter, setRelatedFindingFilter] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEventLike[]>([]);
  const [proposed, setProposed] = useState<TimelineEventLike[]>([]);
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<TimelineEventLike | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState("");
  const [manualType, setManualType] = useState("manual_note");
  const [manualDate, setManualDate] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  useEffect(() => {
    setRelatedFindingFilter(new URLSearchParams(window.location.search).get("relatedFinding"));
  }, []);

  async function load() {
    const [timelineRes, proposedRes] = await Promise.all([
      fetch(`/api/v1/matters/${matterId}/timeline`),
      fetch(`/api/v1/matters/${matterId}/timeline?status=proposed`),
    ]);
    const timelineJson = await timelineRes.json();
    const proposedJson = await proposedRes.json();
    if (!timelineRes.ok) throw new Error(userFacingLoadError("timeline", timelineRes.status));
    setEvents(timelineJson.events ?? []);
    if (proposedRes.ok) setProposed(proposedJson.events ?? []);
  }

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) =>
        setError(err instanceof Error ? err.message : userFacingLoadError("timeline")),
      )
      .finally(() => setLoading(false));
  }, [matterId]);

  useEffect(() => {
    const eventId = new URLSearchParams(window.location.search).get("eventId");
    if (!eventId) return;
    const match = events.find((e) => e.id === eventId) ?? proposed.find((e) => e.id === eventId);
    if (!match) return;
    if (proposed.some((e) => e.id === match.id)) setFilter("suggested");
    setSelected(match);
  }, [events, proposed]);

  useEffect(() => {
    if (!relatedFindingFilter) return;
    const match =
      events.find((e) => (e.relatedFindingIds ?? []).includes(relatedFindingFilter)) ??
      proposed.find((e) => (e.relatedFindingIds ?? []).includes(relatedFindingFilter));
    if (match) {
      if (proposed.some((e) => e.id === match.id)) setFilter("suggested");
      setSelected(match);
    }
  }, [relatedFindingFilter, events, proposed]);

  const visible = useMemo(() => {
    let list = filterTimelineEvents(events, proposed, filter);
    if (relatedFindingFilter) {
      list = list.filter((e) => (e.relatedFindingIds ?? []).includes(relatedFindingFilter));
    }
    return list;
  }, [events, proposed, filter, relatedFindingFilter]);

  const grouped = useMemo(() => groupTimelineEventsByDate(visible), [visible]);
  const selectedIsSuggested = selected ? proposed.some((e) => e.id === selected.id) : false;

  async function createManual(e: FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch(`/api/v1/matters/${matterId}/timeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: manualTitle,
        eventType: manualType,
        eventDate: manualDate ? `${manualDate}T00:00:00.000Z` : null,
        datePrecision: manualDate ? "exact" : "unknown",
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error?.message ?? "We couldn't add that event. Try again.");
      return;
    }
    setManualTitle("");
    setManualDate("");
    setAddOpen(false);
    await load();
  }

  async function reviewEvent(eventId: string, action: "approve" | "reject") {
    const res = await fetch(`/api/v1/matters/${matterId}/timeline/${eventId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        rejectionReason: action === "reject" ? rejectReason.trim() || null : null,
      }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json?.error?.message ?? "We couldn't complete that review. Try again.");
      return;
    }
    setSelected(null);
    await load();
  }

  function openSources(event: TimelineEventLike) {
    setDrawerItems(
      (event.sources ?? []).map((s: any, i: number) => ({
        id: s.id ?? `src-${i}`,
        title: s.documentTitle ?? "Source",
        classLabel: "Matter Evidence",
        quote: s.quote ?? s.excerpt ?? s.supportingText,
        documentId: s.documentId,
      })),
    );
    setDrawerOpen(true);
  }

  if (loading) return <LoadingState label="Loading timeline…" />;

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        title="Timeline"
        description="What happened, in order. Suggested events stay separate until you verify them. Nyaya does not collapse conflicting accounts into one date."
        actions={
          <Button type="button" onClick={() => setAddOpen(true)}>
            + Add event
          </Button>
        }
      />
      {error ? <ErrorState message={error} onRetry={() => load().catch(() => undefined)} /> : null}
      {relatedFindingFilter ? (
        <p className="text-xs text-ink/60">
          Showing events linked to a conflict.{" "}
          <Link
            href={`/app/cases/${matterId}/timeline`}
            className="font-semibold text-accent underline"
          >
            Clear filter
          </Link>
        </p>
      ) : null}
      <FilterChipBar
        value={filter}
        onChange={(id) => setFilter(id as TimelineFilter)}
        options={[
          { id: "all", label: "All", count: events.length },
          { id: "communications", label: "Communications" },
          { id: "deadlines", label: "Deadlines" },
          { id: "disputed", label: "Disputed" },
          { id: "suggested", label: "Suggested", count: proposed.length },
        ]}
      />
      <p className="text-xs text-ink/55">
        Conflicting document accounts stay dual-sided on{" "}
        <Link
          href={`/app/cases/${matterId}/evidence`}
          className="font-semibold text-accent underline"
        >
          Evidence
        </Link>
        . Nyaya does not collapse them into one timeline.
      </p>

      <div className={selected ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" : undefined}>
        <div>
          {visible.length === 0 && filter !== "suggested" && events.length === 0 ? (
            <EmptyState
              title="No verified events yet."
              description="Your verified timeline will appear here as events are confirmed."
              action={
                proposed.length > 0 ? (
                  <Button type="button" variant="secondary" onClick={() => setFilter("suggested")}>
                    Review suggestions ({proposed.length})
                  </Button>
                ) : (
                  <Link
                    href={`/app/cases/${matterId}/review`}
                    className="text-sm font-semibold text-accent underline"
                  >
                    Open Review
                  </Link>
                )
              }
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title={
                filter === "suggested"
                  ? "No timeline suggestions pending review."
                  : "No events match this filter."
              }
              description={
                filter === "suggested"
                  ? "Nyaya can suggest chronology after documents are processed. Suggestions stay unconfirmed until you verify them."
                  : "Try another filter, or add an event."
              }
            />
          ) : (
            <ol className="relative space-y-6 border-l border-accent/30 pl-5">
              {grouped.map((group) => (
                <li key={group.key}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink/45">
                    {group.label}
                  </p>
                  <ul className="space-y-2">
                    {group.events.map((event) => {
                      const suggested = proposed.some((p) => p.id === event.id);
                      const disputed = isDisputedTimelineEvent(event);
                      const sources = (event.sources ?? []).length;
                      return (
                        <li key={event.id}>
                          <button
                            type="button"
                            className={`w-full rounded-lg border px-3 py-2.5 text-left ${
                              selected?.id === event.id
                                ? "border-accent bg-accent-soft/40"
                                : suggested
                                  ? "border-amber-700/20 bg-amber-50/40"
                                  : "border-line bg-white hover:bg-accent-soft/20"
                            }`}
                            onClick={() => setSelected(event)}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold text-ink">{event.title}</span>
                              <TrustStatus
                                kind={trustStatusFromRecord({
                                  status: suggested ? "proposed" : (event.status ?? "approved"),
                                  disputed,
                                })}
                              />
                            </div>
                            {event.description ? (
                              <p className="mt-1 line-clamp-2 text-sm text-ink/70">
                                {event.description}
                              </p>
                            ) : null}
                            <p className="mt-1 text-xs text-ink/55">
                              {humanizeKey(event.eventType)}
                              {sources ? ` · ${sources} source${sources === 1 ? "" : "s"}` : ""}
                            </p>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>

        <IntelligenceInspector
          open={Boolean(selected)}
          title={selected?.title ?? "Event"}
          subtitle={selected ? formatTimelineDateLine(selected) : undefined}
          status={
            selected ? (
              <TrustStatus
                kind={trustStatusFromRecord({
                  status: selectedIsSuggested ? "proposed" : (selected.status ?? "approved"),
                  disputed: isDisputedTimelineEvent(selected),
                })}
              />
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
                  href={askNyayaHref(matterId)}
                  className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
                >
                  Ask Nyaya about this
                </Link>
              </>
            ) : null
          }
        >
          {selected ? (
            <>
              <p className="text-ink/80">{selected.description || "No additional description."}</p>
              <RelatedList heading="Date certainty">
                <p>{formatTimelineDateCertainty(selected)}</p>
              </RelatedList>
              {isDisputedTimelineEvent(selected) ? (
                <p className="text-xs text-ink/60">
                  Linked conflict stays dual-sided on Evidence. This event is not an auto-resolved
                  account.
                </p>
              ) : null}
              {selectedIsSuggested ? (
                <div className="space-y-2">
                  <label className="block text-xs text-ink/60">
                    Rejection reason
                    <input
                      className="mt-1 w-full rounded border border-line px-3 py-2 text-sm text-ink"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => reviewEvent(selected.id, "approve")}>
                      Verify
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => reviewEvent(selected.id, "reject")}
                    >
                      Dismiss
                    </Button>
                    <Link
                      href={`/app/cases/${matterId}/review`}
                      className="self-center text-xs font-semibold text-accent underline"
                    >
                      Open Review
                    </Link>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </IntelligenceInspector>
      </div>

      <IntelligenceDialog
        open={addOpen}
        title="Add event"
        description="Manual events are recorded as verified immediately."
        onClose={() => setAddOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={createManual}>
          <input
            className="rounded border border-line px-3 py-2 text-sm"
            value={manualTitle}
            onChange={(e) => setManualTitle(e.target.value)}
            placeholder="What happened?"
            required
            aria-label="Event title"
          />
          <select
            className="rounded border border-line px-3 py-2 text-sm"
            value={manualType}
            onChange={(e) => setManualType(e.target.value)}
            aria-label="Event type"
          >
            {EVENT_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <input
            type="date"
            className="rounded border border-line px-3 py-2 text-sm"
            value={manualDate}
            onChange={(e) => setManualDate(e.target.value)}
            aria-label="Event date"
          />
          <Button type="submit">Save event</Button>
        </form>
      </IntelligenceDialog>
      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
