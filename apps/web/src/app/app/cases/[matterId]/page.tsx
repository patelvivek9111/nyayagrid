"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Panel, Badge, Button } from "@nyayagrid/ui";
import {
  EmptyState,
  ErrorState,
  IntelligenceStatus,
  LoadingState,
  ReviewSuggestionCard,
  SuggestedBadge,
  VerifiedBadge,
} from "@/components/ux";

type Fact = { id: string; label: string; value: string };
type Entity = { id: string; displayName: string; entityType: string };
type TimelineEvent = {
  id: string;
  title: string;
  eventDate: string | null;
  datePrecision: string | null;
};
type Deadline = {
  id: string;
  title: string;
  dueAt: string | null;
  dateKind: string | null;
  timezoneLabel?: string | null;
  timezone?: string | null;
};
type DocumentRow = { id: string; title: string; processingState: string };
type TaskRow = { id: string; title: string; status: string; priority?: string };
type NoteRow = { id: string; title: string; content: string; origin: string };
type DraftRow = { id: string; title: string; status: string; aiGenerated: boolean };
type OpenQuestion = {
  id: string;
  title: string;
  content: string;
  status: string;
  memoryType: string;
};
type TeamMember = { id: string; displayName: string; access: string };
type Activity = { id: string; kind: string; title: string; at: string };
type Artifact = {
  id: string;
  artifactType: string;
  question: string;
  evidenceState: string;
};
type Conversation = {
  id: string;
  title: string | null;
  updatedAt: string;
  preview?: string | null;
};

type CaseHomeData = {
  matter: {
    id: string;
    title: string;
    matterNumber: string;
    status: string;
    practiceArea: string | null;
    jurisdiction: string | null;
    court: string | null;
    description: string | null;
    openedAt: string;
  };
  client: { displayName: string } | null;
  recentDocuments: DocumentRow[];
  recentNotes: NoteRow[];
  openTasks: TaskRow[];
  recentArtifacts: Artifact[];
  recentDrafts: DraftRow[];
  verified: {
    recentEvents: TimelineEvent[];
    facts: Fact[];
    entities: Entity[];
    upcomingDeadlines: Deadline[];
  };
  reviewCounts: {
    proposedEvents?: number;
    proposedFacts?: number;
    proposedEntities?: number;
    proposedDeadlines?: number;
  };
  summary: { summary: string } | null;
  team: TeamMember[];
  responsibleLawyer: { id: string; displayName: string } | null;
  openQuestions: OpenQuestion[];
  recentActivity: Activity[];
};

export default function CaseHomePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [data, setData] = useState<CaseHomeData | null>(null);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflicting, setConflicting] = useState(0);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  async function load() {
    const res = await fetch(`/api/v1/matters/${matterId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load case");
    setData(json as CaseHomeData);
  }

  useEffect(() => {
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load case"));
    fetch(`/api/v1/matters/${matterId}/conversations?limit=8`)
      .then(async (res) => {
        const json = await res.json();
        if (res.ok) setChats(json.conversations ?? []);
      })
      .catch(() => undefined);
    fetch(`/api/v1/matters/${matterId}/analysis/findings?runType=contradiction`)
      .then(async (res) => {
        if (!res.ok) return;
        const json = await res.json();
        setConflicting((json.findings ?? []).length);
      })
      .catch(() => undefined);
  }, [matterId]);

  async function regenerateSummary() {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/summary`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Summary failed");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Summary failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveNote(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: noteTitle, content: noteContent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Save note failed");
      setNoteTitle("");
      setNoteContent("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save note failed");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorState message={error} />;
  if (!data) return <LoadingState label="Loading case…" />;

  const {
    matter,
    client,
    recentDocuments,
    recentNotes,
    openTasks,
    recentArtifacts,
    recentDrafts,
    verified,
    reviewCounts,
    summary,
    team,
    responsibleLawyer,
    openQuestions,
    recentActivity,
  } = data;
  const suggested =
    (reviewCounts?.proposedEvents ?? 0) +
    (reviewCounts?.proposedFacts ?? 0) +
    (reviewCounts?.proposedEntities ?? 0) +
    (reviewCounts?.proposedDeadlines ?? 0);
  const verifiedCount =
    (verified?.recentEvents?.length ?? 0) +
    (verified?.facts?.length ?? 0) +
    (verified?.entities?.length ?? 0) +
    (verified?.upcomingDeadlines?.length ?? 0);

  return (
    <div className="space-y-6">
      <Panel title="Case details">
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Client</dt>
            <dd>{client?.displayName ?? "Unknown client"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Status</dt>
            <dd>
              <Badge>{matter.status}</Badge>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Matter type
            </dt>
            <dd>{matter.practiceArea || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Jurisdiction
            </dt>
            <dd>{matter.jurisdiction || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Court</dt>
            <dd>{matter.court || "Not recorded"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">Judge</dt>
            <dd>Not recorded</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Responsible lawyer
            </dt>
            <dd>{responsibleLawyer?.displayName ?? "Not assigned"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-ink/50">
              Matter team
            </dt>
            <dd>
              {team.length === 0
                ? "No team members listed"
                : team.map((m) => `${m.displayName} (${m.access})`).join(", ")}
            </dd>
          </div>
        </dl>
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <IntelligenceStatus
          verified={verifiedCount}
          suggested={suggested}
          conflicting={conflicting || undefined}
        />
        {suggested > 0 ? (
          <ReviewSuggestionCard
            title={`Nyaya found ${suggested} new items`}
            counts={[
              reviewCounts.proposedEvents ? `${reviewCounts.proposedEvents} Timeline events` : "",
              reviewCounts.proposedEntities ? `${reviewCounts.proposedEntities} People` : "",
              reviewCounts.proposedFacts ? `${reviewCounts.proposedFacts} Facts` : "",
              reviewCounts.proposedDeadlines ? `${reviewCounts.proposedDeadlines} Deadlines` : "",
            ].filter(Boolean)}
            href={`/app/cases/${matterId}/review`}
          />
        ) : (
          <Panel title="Suggestions">
            <p className="text-sm text-ink/60">
              No pending suggestions. Upload documents to analyze.
            </p>
          </Panel>
        )}
      </div>

      <Panel title="AI insights">
        {summary ? (
          <>
            <p className="mb-2 text-xs uppercase tracking-wide text-ink/55">
              AI-generated · not attorney-authored
            </p>
            <p className="whitespace-pre-wrap text-sm">{summary.summary}</p>
          </>
        ) : (
          <p className="text-sm text-ink/60">
            No summary yet. Generate from verified intelligence only.
          </p>
        )}
        <div className="mt-3">
          <Button disabled={busy} onClick={regenerateSummary}>
            {busy ? "Generating…" : "Regenerate summary"}
          </Button>
        </div>
        {(recentArtifacts ?? []).length > 0 ? (
          <ul className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
            {recentArtifacts.map((a) => (
              <li key={a.id}>
                <span className="font-semibold">{a.question.slice(0, 100)}</span>
                <span className="text-ink/50"> · {a.evidenceState}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Key facts">
          {(verified?.facts ?? []).length === 0 ? (
            <EmptyState
              title="No verified facts yet"
              description="Approve facts from Review after Nyaya extracts them from Case documents."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {verified.facts.slice(0, 8).map((fact) => (
                <li key={fact.id} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-semibold">{fact.label}:</span> {fact.value}
                  </span>
                  <VerifiedBadge />
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Open questions">
          {(openQuestions ?? []).length === 0 ? (
            <EmptyState
              title="No open questions recorded"
              description="Capture unresolved questions in Nyaya Memory. They stay suggestions until you approve them."
              action={
                <Link
                  href={`/app/cases/${matterId}/memory`}
                  className="text-sm font-semibold text-accent underline"
                >
                  Open Memory
                </Link>
              }
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {openQuestions.map((q) => (
                <li key={q.id}>
                  <Link
                    href={`/app/cases/${matterId}/memory?memoryId=${q.id}`}
                    className="font-semibold text-accent underline"
                  >
                    {q.title}
                  </Link>
                  <p className="text-xs text-ink/55">
                    {q.memoryType}
                    {q.status === "proposed" ? " · suggested" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="People & Organizations">
          {(verified?.entities ?? []).length === 0 ? (
            <p className="text-sm text-ink/60">No verified people yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2 text-sm">
              {verified.entities.slice(0, 8).map((ent) => (
                <li key={ent.id}>
                  <Link
                    href={`/app/cases/${matterId}/people?entityId=${ent.id}`}
                    className="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3 py-1"
                  >
                    <span className="font-semibold">{ent.displayName}</span>
                    <span className="text-ink/50">{ent.entityType}</span>
                    <VerifiedBadge />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/app/cases/${matterId}/people`}
            className="mt-3 inline-block text-xs font-semibold text-accent underline"
          >
            Open People
          </Link>
        </Panel>

        <Panel title="Timeline">
          {(verified?.recentEvents ?? []).length === 0 ? (
            <EmptyState
              title="No verified events yet"
              description="Nyaya can analyze uploaded documents for timeline suggestions."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {verified.recentEvents.slice(0, 5).map((ev) => (
                <li
                  key={ev.id}
                  className="flex items-start justify-between gap-2 border-b border-line pb-2"
                >
                  <div>
                    <Link
                      href={`/app/cases/${matterId}/timeline?eventId=${ev.id}`}
                      className="font-semibold text-accent underline"
                    >
                      {ev.title}
                    </Link>
                    <p className="text-xs text-ink/55">
                      {ev.eventDate
                        ? new Date(ev.eventDate).toLocaleDateString()
                        : ev.datePrecision === "unknown"
                          ? "Date unknown"
                          : "Approximate"}
                    </p>
                  </div>
                  <VerifiedBadge />
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/app/cases/${matterId}/timeline`}
            className="mt-3 inline-block text-xs font-semibold text-accent underline"
          >
            Open Timeline
          </Link>
        </Panel>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Documents">
          {(recentDocuments ?? []).length === 0 ? (
            <EmptyState
              title="No documents"
              description="Upload documents to let Nyaya understand this Case."
            />
          ) : (
            <ul className="space-y-2 text-sm">
              {recentDocuments.map((d) => (
                <li key={d.id} className="flex justify-between gap-2">
                  <Link
                    href={`/app/cases/${matterId}/documents`}
                    className="font-semibold text-accent underline"
                  >
                    {d.title}
                  </Link>
                  <Badge>{d.processingState}</Badge>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/app/cases/${matterId}/documents`}
            className="mt-3 inline-block text-xs font-semibold text-accent underline"
          >
            Open Documents
          </Link>
        </Panel>

        <Panel title="Open Tasks">
          {(openTasks ?? []).length === 0 ? (
            <p className="text-sm text-ink/60">No open tasks.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {openTasks.map((t) => (
                <li key={t.id} className="flex justify-between gap-2">
                  <Link
                    href={`/app/cases/${matterId}/tasks?taskId=${t.id}`}
                    className="font-semibold text-accent underline"
                  >
                    {t.title}
                  </Link>
                  <span className="text-xs text-ink/50">
                    {t.status}
                    {t.priority ? ` · ${t.priority}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/app/cases/${matterId}/tasks`}
            className="mt-3 inline-block text-xs font-semibold text-accent underline"
          >
            Open Tasks
          </Link>
        </Panel>
      </div>

      <Panel title="Upcoming Deadlines">
        {(verified?.upcomingDeadlines ?? []).length === 0 ? (
          <EmptyState
            title="No verified deadlines"
            description="Nyaya can propose dates from documents. Deadlines stay suggestions until you verify them, and they always show timezone and whether the date was explicit or inferred."
          />
        ) : (
          <ul className="space-y-2 text-sm">
            {verified.upcomingDeadlines.map((d) => (
              <li key={d.id} className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link
                    href={`/app/cases/${matterId}/tasks?deadlineId=${d.id}`}
                    className="font-semibold text-accent underline"
                  >
                    {d.title}
                  </Link>
                  <p className="text-xs text-ink/55">
                    {d.dueAt ? new Date(d.dueAt).toLocaleString() : "Date unknown"} ·{" "}
                    {d.dateKind === "inferred" ? "inferred" : "explicit"} ·{" "}
                    {d.timezoneLabel ?? d.timezone ?? "timezone unknown"}
                  </p>
                </div>
                <VerifiedBadge />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Research">
          <p className="text-sm text-ink/70">
            Source-grounded research lives on Nyaya Research. Open it from the work-surfaces bar or
            Work.
          </p>
          <Link
            href={`/app/cases/${matterId}/research`}
            className="mt-3 inline-block text-xs font-semibold text-accent underline"
          >
            Open Research
          </Link>
        </Panel>
        <Panel title="Drafts">
          {(recentDrafts ?? []).length === 0 ? (
            <p className="text-sm text-ink/60">No drafts yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentDrafts.map((d) => (
                <li key={d.id} className="flex justify-between gap-2">
                  <Link
                    href={`/app/cases/${matterId}/draft`}
                    className="font-semibold text-accent underline"
                  >
                    {d.title}
                  </Link>
                  <span className="text-xs text-ink/50">
                    {d.status}
                    {d.aiGenerated ? " · AI" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/app/cases/${matterId}/draft`}
            className="mt-3 inline-block text-xs font-semibold text-accent underline"
          >
            Open Draft
          </Link>
        </Panel>
      </div>

      <Panel title="Notes">
        <p className="mb-3 text-sm text-ink/70">
          There is no separate Notes tab yet. Record working notes here, save Nyaya answers from
          Chat, and keep durable Case context in{" "}
          <Link href={`/app/cases/${matterId}/memory`} className="font-semibold text-accent underline">
            Memory
          </Link>
          .
        </p>
        {(recentNotes ?? []).length === 0 ? (
          <p className="mb-3 text-sm text-ink/60">No notes yet.</p>
        ) : (
          <ul className="mb-3 space-y-2 text-sm">
            {recentNotes.map((n) => (
              <li key={n.id} className="rounded border border-line px-3 py-2">
                <span className="font-semibold">{n.title}</span>
                <span className="text-ink/50"> · {n.origin}</span>
                <p className="mt-1 line-clamp-2 text-xs text-ink/60">{n.content}</p>
              </li>
            ))}
          </ul>
        )}
        <form className="space-y-2" onSubmit={saveNote}>
          <input
            className="w-full rounded border border-line px-2 py-1.5 text-sm"
            placeholder="Note title"
            aria-label="Note title"
            value={noteTitle}
            onChange={(e) => setNoteTitle(e.target.value)}
            required
          />
          <textarea
            className="w-full rounded border border-line px-2 py-1.5 text-sm"
            placeholder="Working note"
            aria-label="Note content"
            rows={3}
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            required
          />
          <Button disabled={busy} type="submit">
            Save note
          </Button>
        </form>
      </Panel>

      <Panel title="Recent activity">
        {(recentActivity ?? []).length === 0 ? (
          <p className="text-sm text-ink/60">No recent Case activity yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentActivity.map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex justify-between gap-2">
                <span>
                  <span className="font-semibold">{item.title}</span>
                  <span className="text-ink/50"> · {item.kind}</span>
                </span>
                <span className="text-xs text-ink/50">
                  {new Date(item.at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Recent Chats">
        <div className="mb-3">
          <Link href={`/app/cases/${matterId}/chats`}>
            <Button type="button" variant="secondary">
              New Chat
            </Button>
          </Link>
        </div>
        {chats.length === 0 ? (
          <p className="text-sm text-ink/60">
            No Case chats yet. Start one to ask Nyaya about this Case.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded border border-line">
            {chats.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/cases/${matterId}/chats/${c.id}`}
                  className="block px-3 py-2 text-sm hover:bg-accent-soft/30"
                >
                  <span className="font-semibold">{c.title || "Untitled chat"}</span>
                  {c.preview ? (
                    <span className="mt-0.5 block truncate text-xs text-ink/50">{c.preview}</span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {suggested > 0 ? (
        <div className="flex items-center gap-2 text-sm">
          <SuggestedBadge />
          <span className="text-ink/70">
            Items awaiting human review remain suggestions until verified.
          </span>
        </div>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}
