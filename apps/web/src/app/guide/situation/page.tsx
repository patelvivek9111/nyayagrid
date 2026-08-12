"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PublicShell } from "@/components/shell";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type SituationRow = {
  id: string;
  title: string;
  jurisdiction: string | null;
  issueCategory: string | null;
  desiredOutcome: string | null;
};

type SituationEvent = {
  id: string;
  title: string;
  description: string | null;
  eventDate: string | null;
  sourceLabel: string;
};

type DocumentRow = { id: string; title: string };

export default function GuideSituationPage() {
  const [situations, setSituations] = useState<SituationRow[]>([]);
  const [situationId, setSituationId] = useState<string>("");
  const [events, setEvents] = useState<SituationEvent[]>([]);
  const [linkedDocuments, setLinkedDocuments] = useState<DocumentRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);

  const [title, setTitle] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [issueCategory, setIssueCategory] = useState("");
  const [desiredOutcome, setDesiredOutcome] = useState("");

  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [eventDescription, setEventDescription] = useState("");
  const [linkDocumentId, setLinkDocumentId] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refreshSituations() {
    const res = await fetch("/api/v1/guide/situations");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load situations");
    setSituations(data.situations ?? []);
  }

  async function refreshDocuments() {
    const res = await fetch("/api/v1/guide/documents");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load documents");
    setDocuments(data.documents ?? []);
  }

  async function loadSituation(id: string) {
    const res = await fetch(`/api/v1/guide/situations/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load situation");
    setEvents(data.events ?? []);
    setLinkedDocuments(data.documents ?? []);
  }

  useEffect(() => {
    Promise.all([refreshSituations(), refreshDocuments()]).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load"),
    );
  }, []);

  useEffect(() => {
    if (!situationId) {
      setEvents([]);
      setLinkedDocuments([]);
      return;
    }
    loadSituation(situationId).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load situation"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situationId]);

  async function createSituation(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/guide/situations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          jurisdiction: jurisdiction || undefined,
          issueCategory: issueCategory || undefined,
          desiredOutcome: desiredOutcome || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to create situation");
      setTitle("");
      setJurisdiction("");
      setIssueCategory("");
      setDesiredOutcome("");
      await refreshSituations();
      setSituationId(data.situation.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create situation");
    } finally {
      setBusy(false);
    }
  }

  async function addEvent(event: FormEvent) {
    event.preventDefault();
    if (!situationId || !eventTitle.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/guide/situations/${situationId}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: eventTitle,
          description: eventDescription || undefined,
          eventDate: eventDate || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to add event");
      setEventTitle("");
      setEventDate("");
      setEventDescription("");
      await loadSituation(situationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add event");
    } finally {
      setBusy(false);
    }
  }

  async function linkDocumentToSituation() {
    if (!situationId || !linkDocumentId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/guide/situations/${situationId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentId: linkDocumentId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to link document");
      setLinkDocumentId("");
      await loadSituation(situationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to link document");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Nyaya Guide"
        title="Organize your situation"
        description="Build a timeline of what happened, in your own words, and link the documents you have. This never invents an event — every entry here is something you told us."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="mb-4">
        <label className="text-sm font-semibold text-ink/80">
          Situation
          <select
            className="ml-2 rounded border border-line px-2 py-1.5 text-sm"
            value={situationId}
            onChange={(e) => setSituationId(e.target.value)}
          >
            <option value="">Select a situation</option>
            {situations.map((situation) => (
              <option key={situation.id} value={situation.id}>
                {situation.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Create a new situation">
          <form className="flex flex-col gap-3" onSubmit={createSituation}>
            <input
              className="rounded border border-line px-3 py-2 text-sm"
              placeholder="Title (e.g. Lease dispute with landlord)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <input
              className="rounded border border-line px-3 py-2 text-sm"
              placeholder="Jurisdiction (optional)"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
            />
            <input
              className="rounded border border-line px-3 py-2 text-sm"
              placeholder="Issue category (optional, e.g. landlord-tenant)"
              value={issueCategory}
              onChange={(e) => setIssueCategory(e.target.value)}
            />
            <textarea
              className="rounded border border-line px-3 py-2 text-sm"
              placeholder="Desired outcome (optional)"
              value={desiredOutcome}
              onChange={(e) => setDesiredOutcome(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Create situation
            </Button>
          </form>
        </Panel>

        <Panel title="Link a document">
          {!situationId ? (
            <p className="text-sm text-ink/70">Select a situation first.</p>
          ) : (
            <div className="flex flex-col gap-3">
              <select
                className="rounded border border-line px-3 py-2 text-sm"
                value={linkDocumentId}
                onChange={(e) => setLinkDocumentId(e.target.value)}
              >
                <option value="">Select a document</option>
                {documents.map((document) => (
                  <option key={document.id} value={document.id}>
                    {document.title}
                  </option>
                ))}
              </select>
              <Button
                onClick={linkDocumentToSituation}
                disabled={busy || !linkDocumentId}
                variant="secondary"
              >
                Link document
              </Button>
              {linkedDocuments.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {linkedDocuments.map((document) => (
                    <li key={document.id}>
                      <Badge>{document.title}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink/70">No documents linked yet.</p>
              )}
            </div>
          )}
        </Panel>

        <Panel title="Add a timeline event" className="lg:col-span-2">
          {!situationId ? (
            <p className="text-sm text-ink/70">Select a situation first.</p>
          ) : (
            <form className="grid gap-3 md:grid-cols-4" onSubmit={addEvent}>
              <input
                className="rounded border border-line px-3 py-2 text-sm md:col-span-2"
                placeholder="What happened?"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                required
              />
              <input
                type="date"
                className="rounded border border-line px-3 py-2 text-sm"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
              />
              <Button type="submit" disabled={busy}>
                Add event
              </Button>
              <textarea
                className="rounded border border-line px-3 py-2 text-sm md:col-span-4"
                placeholder="Details (optional)"
                value={eventDescription}
                onChange={(e) => setEventDescription(e.target.value)}
              />
            </form>
          )}
        </Panel>

        <Panel title="Timeline" className="lg:col-span-2">
          {events.length === 0 ? (
            <p className="text-sm text-ink/70">No events yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {events.map((event) => (
                <li key={event.id} className="rounded border border-line px-3 py-2">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-ink">{event.title}</p>
                    <div className="flex items-center gap-2 text-xs text-ink/60">
                      <span>{event.eventDate ?? "date unknown"}</span>
                      <Badge>{event.sourceLabel.replace(/_/g, " ")}</Badge>
                    </div>
                  </div>
                  {event.description ? (
                    <p className="mt-1 text-ink/70">{event.description}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PublicShell>
  );
}
