"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { MatterShell } from "@/components/shell";
import { Badge, Button, Panel } from "@nyayagrid/ui";

export default function MatterTimelinePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [events, setEvents] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<any | null>(null);
  const [manualTitle, setManualTitle] = useState("");
  const [manualType, setManualType] = useState("manual_note");
  const [manualDate, setManualDate] = useState("");

  async function load() {
    const res = await fetch(`/api/v1/matters/${matterId}/timeline`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load timeline");
    setEvents(json.events ?? []);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [matterId]);

  const filtered = useMemo(() => {
    if (!typeFilter) return events;
    return events.filter((e) => e.eventType === typeFilter);
  }, [events, typeFilter]);

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
        eventDate: manualDate ? new Date(manualDate).toISOString() : null,
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

  return (
    <MatterShell matterId={matterId} title="Nyaya Timeline">
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}
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
            <p className="text-sm text-ink/70">
              No approved or manually created timeline events yet. Review proposed intelligence
              first.
            </p>
          ) : (
            <ol className="space-y-4">
              {filtered.map((event) => (
                <li key={event.id} className="border-l-2 border-accent/40 pl-4">
                  <button className="text-left" onClick={() => setSelected(event)} type="button">
                    <div className="text-xs uppercase tracking-wide text-ink/60">
                      {event.eventDate
                        ? new Date(event.eventDate).toLocaleDateString()
                        : "Date unknown"}{" "}
                      · {event.datePrecision} · {event.origin}
                    </div>
                    <div className="font-semibold">{event.title}</div>
                    <div className="text-sm text-ink/70">
                      {event.eventType}
                      {(event.actors ?? []).length > 0
                        ? ` · ${(event.actors as string[]).join(", ")}`
                        : ""}
                      {` · ${(event.sources ?? []).length} source(s)`}
                    </div>
                    {event.description ? (
                      <p className="mt-1 text-sm text-ink/80">{event.description}</p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Source inspection">
            {!selected ? (
              <p className="text-sm text-ink/70">Select an event to inspect supporting evidence.</p>
            ) : (
              <div className="space-y-3 text-sm">
                <div>
                  <div className="font-semibold">{selected.title}</div>
                  <div className="text-ink/70">What: {selected.description || selected.title}</div>
                  <div className="text-ink/70">
                    When:{" "}
                    {selected.eventDate ? new Date(selected.eventDate).toLocaleString() : "unknown"}{" "}
                    ({selected.datePrecision})
                  </div>
                  <div className="text-ink/70">
                    Who: {(selected.actors ?? []).join(", ") || "—"}
                  </div>
                </div>
                {(selected.sources ?? []).length === 0 ? (
                  <p className="text-ink/70">
                    {selected.origin === "manual"
                      ? "Manual event with no linked sources."
                      : "No sources attached."}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {selected.sources.map((source: any) => (
                      <li key={source.id} className="rounded border border-line p-2">
                        <div className="text-xs text-ink/60">
                          chunk {source.chunkId.slice(0, 8)}…
                          {source.page != null ? ` · page ${source.page}` : ""}
                        </div>
                        <p className="mt-1">{source.supportingText}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Panel>

          <Panel title="Add manual event">
            <form className="space-y-3" onSubmit={createManual}>
              <input
                className="w-full rounded border border-line px-3 py-2 text-sm"
                placeholder="Title"
                value={manualTitle}
                onChange={(e) => setManualTitle(e.target.value)}
                required
              />
              <input
                className="w-full rounded border border-line px-3 py-2 text-sm"
                placeholder="Event type"
                value={manualType}
                onChange={(e) => setManualType(e.target.value)}
                required
              />
              <input
                className="w-full rounded border border-line px-3 py-2 text-sm"
                type="date"
                value={manualDate}
                onChange={(e) => setManualDate(e.target.value)}
              />
              <Button type="submit">Create approved event</Button>
            </form>
          </Panel>
        </div>
      </div>
    </MatterShell>
  );
}
