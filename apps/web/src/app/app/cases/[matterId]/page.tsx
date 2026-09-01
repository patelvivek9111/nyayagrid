"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@nyayagrid/ui";
import {
  CompactSection,
  ErrorState,
  IntelligenceDialog,
  IntelligenceHeader,
  LoadingState,
  OverflowMenu,
  TrustStatus,
  VerifiedBadge,
} from "@/components/ux";
import { formatMatterCalendarDate } from "@/lib/matter-dates";
import { humanizeKey } from "@/lib/plain-labels";
import { totalPendingReviewCount } from "@/lib/review-queue";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";
import { activityKindLabel, taskPriorityLabel, taskStatusLabel } from "@/lib/workspace-ux";
import { useMatterChrome } from "@/components/use-matter-chrome";
import {
  compactJurisdictionHeaderLine,
  type UiJurisdictionContract,
} from "@/lib/case-jurisdiction";

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
  jurisdictionContext: UiJurisdictionContract | null;
  client: { displayName: string } | null;
  recentDocuments: DocumentRow[];
  recentNotes: NoteRow[];
  openTasks: TaskRow[];
  recentArtifacts: Array<{ id: string; question: string; evidenceState: string }>;
  recentDrafts: DraftRow[];
  verified: {
    recentEvents: TimelineEvent[];
    facts: Fact[];
    entities: Entity[];
    upcomingDeadlines: Deadline[];
  };
  reviewCounts: Parameters<typeof totalPendingReviewCount>[0];
  summary: { summary: string } | null;
  team: TeamMember[];
  responsibleLawyer: { id: string; displayName: string } | null;
  openQuestions: OpenQuestion[];
  recentActivity: Activity[];
};

export default function CaseHomePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const { canReview, openCaseDetails } = useMatterChrome();
  const [data, setData] = useState<CaseHomeData | null>(null);
  const [chats, setChats] = useState<Conversation[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflicting, setConflicting] = useState(0);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteContent, setNoteContent] = useState("");

  async function load() {
    const res = await fetch(`/api/v1/matters/${matterId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(userFacingLoadError("home", res.status));
    setData(json as CaseHomeData);
  }

  useEffect(() => {
    load().catch((err) =>
      setError(err instanceof Error ? err.message : userFacingLoadError("home")),
    );
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
      await res.json().catch(() => ({}));
      if (!res.ok) throw new Error("We couldn't refresh the matter summary. Try again.");
      await load();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We couldn't refresh the matter summary. Try again.",
      );
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
      if (!res.ok) throw new Error(json?.error?.message ?? "We couldn't save that note.");
      setNoteTitle("");
      setNoteContent("");
      setNoteOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't save that note.");
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
    recentDrafts,
    verified,
    reviewCounts,
    summary,
    team,
    responsibleLawyer,
    openQuestions,
    recentActivity,
  } = data;
  const suggested = totalPendingReviewCount(reviewCounts);
  const pendingDeadlines = reviewCounts?.proposedDeadlines ?? 0;
  const attentionItems = [
    suggested > 0
      ? {
          href: `/app/cases/${matterId}/review`,
          label: suggested === 1 ? "1 item needs review" : `${suggested} items need review`,
        }
      : null,
    conflicting > 0
      ? {
          href: `/app/cases/${matterId}/evidence`,
          label: conflicting === 1 ? "1 evidence conflict" : `${conflicting} evidence conflicts`,
        }
      : null,
    (openTasks ?? []).length > 0
      ? {
          href: `/app/cases/${matterId}/tasks`,
          label: openTasks.length === 1 ? "1 open task" : `${openTasks.length} open tasks`,
        }
      : null,
    pendingDeadlines > 0
      ? {
          href: `/app/cases/${matterId}/review`,
          label:
            pendingDeadlines === 1
              ? "1 deadline pending review"
              : `${pendingDeadlines} deadlines pending review`,
        }
      : null,
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  return (
    <div className="space-y-5">
      <IntelligenceHeader
        title="Home"
        description="What is happening in this matter, what needs attention, and what to do next."
        actions={
          <OverflowMenu label="More">
            <Button type="button" variant="ghost" onClick={openCaseDetails}>
              Case details
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  const res = await fetch(`/api/v1/matters/${matterId}/audit/export`);
                  if (!res.ok) {
                    const json = await res.json();
                    throw new Error(
                      json?.error?.message ?? "We couldn't download the activity log.",
                    );
                  }
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `nyayagrid-audit-${matterId.slice(0, 8)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch (err) {
                  setError(
                    err instanceof Error ? err.message : "We couldn't download the activity log.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Download activity log
            </Button>
          </OverflowMenu>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-white/80 px-4 py-3 text-sm text-ink/70">
        <span>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/45">Client</span>{" "}
          {client?.displayName ?? "Unknown client"}
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/45">Type</span>{" "}
          {humanizeKey(matter.practiceArea) || "Not recorded"}
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/45">Status</span>{" "}
          {humanizeKey(matter.status) || matter.status}
        </span>
        <span className="min-w-0 truncate">
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/45">Forum</span>{" "}
          {data.jurisdictionContext
            ? compactJurisdictionHeaderLine(data.jurisdictionContext)
            : matter.jurisdiction || "Not recorded"}
        </span>
        <span>
          <span className="text-xs font-semibold uppercase tracking-wide text-ink/45">Lawyer</span>{" "}
          {responsibleLawyer?.displayName ?? "Not assigned"}
        </span>
        <button
          type="button"
          className="font-semibold text-accent underline"
          onClick={openCaseDetails}
        >
          Case details
        </button>
      </div>
      {team.length > 0 ? (
        <p className="text-xs text-ink/50">
          Team: {team.map((member) => member.displayName).join(", ")}
        </p>
      ) : null}

      {(recentDocuments ?? []).length === 0 ? (
        <section className="rounded-xl border border-line bg-white/80 p-4">
          <h3 className="font-display text-lg text-ink">Start this Case</h3>
          <p className="mt-1 text-sm text-ink/70">
            Start by adding the documents for this Case. Nyaya reads those files for Ask and Review.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/app/cases/${matterId}/documents`}>
              <Button type="button">Upload documents</Button>
            </Link>
            <Link href={`/app/cases/${matterId}/chats`}>
              <Button type="button" variant="secondary">
                Ask about this Case
              </Button>
            </Link>
          </div>
        </section>
      ) : chats.length === 0 && suggested === 0 ? (
        <section className="rounded-xl border border-line bg-white/80 p-4">
          <h3 className="font-display text-lg text-ink">Next on this Case</h3>
          <p className="mt-1 text-sm text-ink/70">
            Documents are in the Case. Ask Nyaya about this Case, or wait for suggested items on
            Review after processing finishes.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={`/app/cases/${matterId}/chats`}>
              <Button type="button">Ask about this Case</Button>
            </Link>
            <Link
              href={`/app/cases/${matterId}/review`}
              className="self-center text-sm font-semibold text-accent underline"
            >
              Open Review
            </Link>
          </div>
        </section>
      ) : null}

      {attentionItems.length > 0 ? (
        <section className="rounded-xl border border-amber-700/20 bg-amber-50/40 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-900/70">
            Needs attention
          </p>
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {attentionItems.map((item) => (
              <li key={item.label}>
                <Link href={item.href} className="font-semibold text-accent underline">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
          {suggested > 0 ? (
            <p className="mt-2 text-xs text-ink/60">
              {canReview
                ? "They stay suggested until you inspect the source and decide — they are not established facts."
                : "They stay suggested until a team member with review access inspects the source and decides."}{" "}
              <Link
                href={`/app/cases/${matterId}/review`}
                className="font-semibold text-accent underline"
              >
                {suggested === 1
                  ? "1 item waiting for review"
                  : `${suggested} items waiting for review`}
              </Link>
            </p>
          ) : null}
        </section>
      ) : null}

      {summary ? (
        <section className="rounded-xl border border-line bg-white/80 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className="font-display text-lg text-ink">Matter summary</h3>
            <TrustStatus kind="suggested" />
            <span className="text-xs text-ink/50">Not attorney-authored</span>
          </div>
          <p className="whitespace-pre-wrap text-sm">{summary.summary}</p>
          <Button
            className="mt-3"
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={regenerateSummary}
          >
            {busy ? "Updating…" : "Refresh summary"}
          </Button>
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <CompactSection title="Key facts">
          {(verified?.facts ?? []).length === 0 ? (
            <p className="text-sm text-ink/55">No verified facts yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {verified.facts.slice(0, 6).map((fact) => (
                <li key={fact.id} className="flex items-start justify-between gap-2">
                  <span>
                    <span className="font-semibold">{fact.label}</span>
                    <span className="mt-0.5 block text-ink/70">{fact.value}</span>
                  </span>
                  <VerifiedBadge />
                </li>
              ))}
            </ul>
          )}
        </CompactSection>

        <CompactSection
          title="Upcoming dates"
          href={`/app/cases/${matterId}/timeline`}
          linkLabel="Open Timeline"
        >
          {(verified?.upcomingDeadlines ?? []).length === 0 ? (
            <p className="text-sm text-ink/55">No verified deadlines.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {verified.upcomingDeadlines.slice(0, 4).map((deadline) => (
                <li key={deadline.id}>
                  <Link
                    href={`/app/cases/${matterId}/tasks?deadlineId=${deadline.id}`}
                    className="font-semibold text-accent underline"
                  >
                    {deadline.title}
                  </Link>
                  <p className="text-xs text-ink/55">
                    {deadline.dueAt
                      ? formatMatterCalendarDate(deadline.dueAt, {
                          timezoneLabel: deadline.timezoneLabel ?? deadline.timezone,
                        })
                      : "Date unknown"}{" "}
                    · {deadline.dateKind === "inferred" ? "inferred" : "stated in source"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CompactSection>
      </div>

      {(openQuestions ?? []).length > 0 ? (
        <CompactSection
          title="Open questions"
          href={`/app/cases/${matterId}/memory`}
          linkLabel="Open Memory"
        >
          <ul className="space-y-2 text-sm">
            {openQuestions.map((question) => (
              <li key={question.id}>
                <Link
                  href={`/app/cases/${matterId}/memory?memoryId=${question.id}`}
                  className="font-semibold text-accent underline"
                >
                  {question.title}
                </Link>
              </li>
            ))}
          </ul>
        </CompactSection>
      ) : (
        <p className="text-sm text-ink/55">
          No open questions recorded.{" "}
          <Link
            href={`/app/cases/${matterId}/memory`}
            className="font-semibold text-accent underline"
          >
            Open Memory
          </Link>
        </p>
      )}

      <CompactSection title="Recent activity">
        {(recentActivity ?? []).length === 0 ? (
          <p className="text-sm text-ink/55">No recent Case activity yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentActivity.slice(0, 6).map((item) => (
              <li key={`${item.kind}-${item.id}`} className="flex justify-between gap-3">
                <span>
                  <span className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                    {activityKindLabel(item.kind)}
                  </span>
                  <span className="mt-0.5 block font-semibold">{item.title}</span>
                </span>
                <span className="shrink-0 text-xs text-ink/50">
                  {new Date(item.at).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CompactSection>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <CompactSection
          title="People"
          href={`/app/cases/${matterId}/people`}
          linkLabel="Open People"
        >
          {(verified?.entities ?? []).length === 0 ? (
            <p className="text-sm text-ink/55">No verified people yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {verified.entities.slice(0, 4).map((entity) => (
                <li key={entity.id} className="font-semibold">
                  {entity.displayName}
                </li>
              ))}
            </ul>
          )}
        </CompactSection>
        <CompactSection
          title="Documents"
          href={`/app/cases/${matterId}/documents`}
          linkLabel="Open Documents"
        >
          {(recentDocuments ?? []).length === 0 ? (
            <p className="text-sm text-ink/55">No documents yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {recentDocuments.slice(0, 4).map((doc) => (
                <li key={doc.id} className="truncate font-semibold">
                  {doc.title}
                </li>
              ))}
            </ul>
          )}
        </CompactSection>
        <CompactSection title="Tasks" href={`/app/cases/${matterId}/tasks`} linkLabel="Open Tasks">
          {(openTasks ?? []).length === 0 ? (
            <p className="text-sm text-ink/55">No open tasks.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {openTasks.slice(0, 4).map((task) => (
                <li key={task.id}>
                  <Link
                    href={`/app/cases/${matterId}/tasks?taskId=${task.id}`}
                    className="font-semibold"
                  >
                    {task.title}
                  </Link>
                  <p className="text-xs text-ink/55">
                    {taskStatusLabel(task.status)}
                    {task.priority ? ` · ${taskPriorityLabel(task.priority)}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CompactSection>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <CompactSection
          title="Research"
          href={`/app/cases/${matterId}/research`}
          linkLabel="Open Research"
        >
          <p className="text-sm text-ink/60">Source-grounded research for this Case.</p>
        </CompactSection>
        <CompactSection title="Drafts" href={`/app/cases/${matterId}/draft`} linkLabel="Open Draft">
          {(recentDrafts ?? []).length === 0 ? (
            <p className="text-sm text-ink/55">No drafts yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {recentDrafts.slice(0, 3).map((draft) => (
                <li key={draft.id} className="font-semibold">
                  {draft.title}
                </li>
              ))}
            </ul>
          )}
        </CompactSection>
      </div>

      <CompactSection title="Notes">
        <div className="mb-2">
          <Button type="button" variant="secondary" onClick={() => setNoteOpen(true)}>
            + Add note
          </Button>
        </div>
        {(recentNotes ?? []).length === 0 ? (
          <p className="text-sm text-ink/55">No notes yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {recentNotes.slice(0, 4).map((note) => (
              <li key={note.id}>
                <span className="font-semibold">{note.title}</span>
                <p className="line-clamp-2 text-xs text-ink/60">{note.content}</p>
              </li>
            ))}
          </ul>
        )}
      </CompactSection>

      <CompactSection
        title="Recent chats"
        href={`/app/cases/${matterId}/chats`}
        linkLabel="Open Chats"
      >
        {chats.length === 0 ? (
          <p className="text-sm text-ink/55">No Case chats yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {chats.slice(0, 4).map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/app/cases/${matterId}/chats/${chat.id}`}
                  className="font-semibold text-accent underline"
                >
                  {chat.title || "Untitled chat"}
                </Link>
                {chat.preview ? (
                  <p className="truncate text-xs text-ink/50">{chat.preview}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CompactSection>

      <IntelligenceDialog
        open={noteOpen}
        title="Add note"
        description="Working notes stay on this Case. Durable context belongs in Memory."
        onClose={() => setNoteOpen(false)}
      >
        <form className="flex flex-col gap-3" onSubmit={saveNote}>
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
            rows={4}
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            required
          />
          <Button disabled={busy} type="submit">
            Save note
          </Button>
        </form>
      </IntelligenceDialog>
      {error ? <ErrorState message={error} /> : null}
    </div>
  );
}
