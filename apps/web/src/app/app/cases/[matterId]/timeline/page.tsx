"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Panel } from "@nyayagrid/ui";
import {
  ConflictingEvidenceBadge,
  SuggestedBadge,
  VerifiedBadge,
  EmptyState,
  SourceDrawer,
  type SourceDrawerItem,
} from "@/components/ux";
import { formatMatterCalendarDate } from "@/lib/matter-dates";

export default function MatterTimelinePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [relatedFindingFilter, setRelatedFindingFilter] = useState<string | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [proposed, setProposed] = useState<any[]>([]);
  const [view, setView] = useState<"verified" | "suggested">("verified");
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
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
    if (!timelineRes.ok) throw new Error(timelineJson?.error?.message ?? "Failed to load timeline");
    setEvents(timelineJson.events ?? []);
    if (proposedRes.ok) {
      setProposed(proposedJson.events ?? []);
    }
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [matterId]);

  useEffect(() => {
    const eventId = new URLSearchParams(window.location.search).get("eventId");
    if (!eventId) return;
    const match = events.find((e) => e.id === eventId) ?? proposed.find((e) => e.id === eventId);
    if (!match) return;
    if (proposed.some((e) => e.id === match.id)) setView("suggested");
    else setView("verified");
    setSelected(match);
  }, [events, proposed]);

  useEffect(() => {
    if (!relatedFindingFilter) return;
    const match =
      events.find((e) => (e.relatedFindingIds ?? []).includes(relatedFindingFilter)) ??
      proposed.find((e) => (e.relatedFindingIds ?? []).includes(relatedFindingFilter));
    if (match) {
      if (proposed.some((e) => e.id === match.id)) setView("suggested");
      else setView("verified");
      setSelected(match);
    }
  }, [relatedFindingFilter, events, proposed]);

  const filtered = useMemo(() => {
    let list = typeFilter ? events.filter((e) => e.eventType === typeFilter) : events;
    if (relatedFindingFilter) {
      list = list.filter((e) => (e.relatedFindingIds ?? []).includes(relatedFindingFilter));
    }
    return list;
  }, [events, typeFilter, relatedFindingFilter]);

  const filteredProposed = useMemo(() => {
    if (!relatedFindingFilter) return proposed;
    return proposed.filter((e) => (e.relatedFindingIds ?? []).includes(relatedFindingFilter));
  }, [proposed, relatedFindingFilter]);

  const eventTypes = useMemo(() => [...new Set(events.map((e) => e.eventType))].sort(), [events]);

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
      setError(json?.error?.message ?? "Failed to create event");
      return;
    }
    setManualTitle("");
    setManualDate("");
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
      setError(json?.error?.message ?? "Review failed");
      return;
    }
    await load();
  }

  return (
    <>
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <p className="mb-4 rounded-lg border border-line bg-white px-4 py-3 text-sm text-ink/70">
        Suggested events stay <SuggestedBadge /> until you verify them. Nyaya extracts proposed
        chronology on{" "}
        <Link href={`/app/cases/${matterId}/review`} className="font-semibold text-accent underline">
          Review
        </Link>
        ; verify them here after they appear as Suggestions. Conflicting document accounts are
        reviewed as dual-sided findings on{" "}
        <Link
          href={`/app/cases/${matterId}/evidence`}
          className="font-semibold text-accent underline"
        >
          Evidence
        </Link>
        — Nyaya does not collapse them into one timeline “truth,” even when both sides link here.
      </p>
      {relatedFindingFilter ? (
        <p className="mb-3 text-xs text-ink/60">
          Filtered to events related to a contradiction finding.{" "}
          <Link href={`/app/cases/${matterId}/timeline`} className="text-accent underline">
            Clear filter
          </Link>
        </p>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
            view === "verified" ? "border-accent bg-accent-soft/50" : "border-line bg-white"
          }`}
          onClick={() => setView("verified")}
        >
          Verified
        </button>
        <button
          type="button"
          className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
            view === "suggested" ? "border-accent bg-accent-soft/50" : "border-line bg-white"
          }`}
          onClick={() => setView("suggested")}
        >
          Suggestions ({filteredProposed.length})
        </button>
      </div>

      {view === "verified" ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <label className="text-sm">
              Event type{" "}
              <select
                className="ml-2 rounded border border-line bg-white px-2 py-1"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All</option>
                {eventTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            <Badge>{filtered.length} verified events</Badge>
          </div>
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Panel title="Chronology">
              {filtered.length === 0 ? (
                <EmptyState
                  title="No verified events yet"
                  description="Nyaya can analyze uploaded documents for timeline suggestions."
                />
              ) : (
                <ol className="space-y-4">
                  {filtered.map((event) => (
                    <li key={event.id} className="border-l-2 border-accent/40 pl-4">
                      <button
                        className="text-left"
                        onClick={() => setSelected(event)}
                        type="button"
                      >
                        <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-ink/60">
                          <span>
                            {event.eventDate
                              ? formatMatterCalendarDate(event.eventDate)
                              : "Date unknown"}{" "}
                            · {event.datePrecision}
                            {event.origin ? ` · source: ${event.origin}` : ""}
                          </span>
                          <VerifiedBadge />
                          {(event.relatedFindingIds ?? []).length > 0 ? (
                            <ConflictingEvidenceBadge>Linked conflict</ConflictingEvidenceBadge>
                          ) : null}
                        </div>
                        <div className="font-semibold">{event.title}</div>
                        <div className="text-sm text-ink/70">{event.eventType}</div>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            <Panel title="Event detail">
              {!selected ? (
                <p className="text-sm text-ink/70">Select an event.</p>
              ) : (
                <div className="space-y-2 text-sm">
                  <VerifiedBadge />
                  <p className="font-semibold">{selected.title}</p>
                  <p className="text-ink/70">{selected.description || "No description"}</p>
                  {(selected.relatedFindingIds ?? []).length > 0 ? (
                    <p className="text-xs text-ink/60">
                      Related contradiction finding(s) stay dual-sided on{" "}
                      <Link
                        href={`/app/cases/${matterId}/evidence`}
                        className="font-semibold text-accent underline"
                      >
                        Evidence
                      </Link>
                      . This event is not an auto-resolved “truth.”
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setDrawerItems(
                        (selected.sources ?? []).map((s: any, i: number) => ({
                          id: s.id ?? `src-${i}`,
                          title: s.documentTitle ?? "Source",
                          classLabel: "Matter Evidence",
                        quote: s.quote ?? s.excerpt ?? s.supportingText,
                        documentId: s.documentId,
                      })),
                      );
                      setDrawerOpen(true);
                    }}
                  >
                    Inspect sources
                  </Button>
                </div>
              )}
            </Panel>
          </div>
          <div className="mt-4">
            <Panel title="Add manual event">
              <form className="flex flex-col gap-3" onSubmit={createManual}>
                <input
                  className="rounded border border-line px-3 py-2"
                  value={manualTitle}
                  onChange={(e) => setManualTitle(e.target.value)}
                  placeholder="Event title"
                  required
                />
                <input
                  className="rounded border border-line px-3 py-2"
                  value={manualType}
                  onChange={(e) => setManualType(e.target.value)}
                />
                <input
                  type="date"
                  className="rounded border border-line px-3 py-2"
                  value={manualDate}
                  onChange={(e) => setManualDate(e.target.value)}
                />
                <Button type="submit">Add event</Button>
              </form>
            </Panel>
          </div>
        </>
      ) : (
        <Panel title="Suggestions">
          {filteredProposed.length === 0 ? (
            <p className="text-sm text-ink/60">No timeline suggestions pending review.</p>
          ) : (
            <ul className="space-y-3">
              {filteredProposed.map((event) => (
                <li
                  key={event.id}
                  className="rounded-lg border border-amber-700/20 bg-amber-50/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SuggestedBadge />
                    {(event.relatedFindingIds ?? []).length > 0 ? (
                      <ConflictingEvidenceBadge>Linked conflict</ConflictingEvidenceBadge>
                    ) : null}
                    <span className="text-sm font-semibold">{event.title}</span>
                  </div>
                  <p className="mt-1 text-xs text-ink/60">
                    {event.eventDate
                      ? formatMatterCalendarDate(event.eventDate)
                      : "Date unknown"}{" "}
                    · {event.datePrecision}
                    {event.origin ? ` · source: ${event.origin}` : ""}
                  </p>
                  {(event.relatedFindingIds ?? []).length > 0 ? (
                    <p className="mt-1 text-xs text-ink/55">
                      Linked to Evidence conflict(s) — sides remain separate until human review.
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" onClick={() => reviewEvent(event.id, "approve")}>
                      Verify
                    </Button>
                    <label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs text-ink/60">
                      Rejection reason
                      <input
                        className="rounded border border-line px-2 py-1 text-sm text-ink"
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="Required when rejecting, like Review facts"
                      />
                    </label>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => reviewEvent(event.id, "reject")}
                    >
                      Reject
                    </Button>
                    <Link
                      href={`/app/cases/${matterId}/evidence`}
                      className="self-center text-xs font-semibold text-accent underline"
                    >
                      View on Evidence
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      )}
      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </>
  );
}
