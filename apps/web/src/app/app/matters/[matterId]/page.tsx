"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { MatterShell } from "@/components/shell";
import { Panel, Badge, Button } from "@nyayagrid/ui";

type AgentRunSummary = {
  id: string;
  goal: string;
  status: string;
  intent: string | null;
  createdAt: string;
};

export default function MatterOverviewPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentRuns, setAgentRuns] = useState<AgentRunSummary[]>([]);

  async function load() {
    const res = await fetch(`/api/v1/matters/${matterId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load matter");
    setData(json);
  }

  useEffect(() => {
    load().catch((err) => setError(err.message));
    fetch(`/api/v1/matters/${matterId}/agents?limit=5`)
      .then(async (res) => {
        const json = await res.json();
        if (res.ok) setAgentRuns(json.runs ?? []);
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

  if (error && !data) {
    return (
      <MatterShell matterId={matterId} title="Matter">
        <p className="text-sm text-[var(--ng-danger)]">{error}</p>
      </MatterShell>
    );
  }
  if (!data) {
    return (
      <MatterShell matterId={matterId} title="Matter">
        <p>Loading…</p>
      </MatterShell>
    );
  }

  const {
    matter,
    client,
    recentDocuments,
    recentNotes,
    openTasks,
    verified,
    reviewCounts,
    summary,
  } = data;

  return (
    <MatterShell matterId={matterId} title={`${matter.matterNumber} — ${matter.title}`}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge>{matter.status}</Badge>
        {matter.practiceArea ? <Badge>{matter.practiceArea}</Badge> : null}
        {matter.jurisdiction ? <Badge>{matter.jurisdiction}</Badge> : null}
        {(reviewCounts?.proposedEvents ?? 0) +
          (reviewCounts?.proposedFacts ?? 0) +
          (reviewCounts?.proposedEntities ?? 0) +
          (reviewCounts?.proposedDeadlines ?? 0) >
        0 ? (
          <Link
            href={`/app/matters/${matterId}/review`}
            className="text-sm font-semibold text-accent underline"
          >
            {reviewCounts.proposedEvents} proposed events · {reviewCounts.proposedFacts} facts ·{" "}
            {reviewCounts.proposedEntities} entities · {reviewCounts.proposedDeadlines} deadlines
          </Link>
        ) : null}
      </div>
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Matter summary">
          {summary ? (
            <>
              <p className="mb-2 text-xs uppercase tracking-wide text-ink/60">
                AI-generated · {summary.provider}/{summary.model} · not attorney-authored
              </p>
              <p className="text-sm whitespace-pre-wrap">{summary.summary}</p>
            </>
          ) : (
            <p className="text-sm text-ink/70">
              No summary yet. Generate one from verified intelligence only.
            </p>
          )}
          <div className="mt-3">
            <Button disabled={busy} onClick={regenerateSummary}>
              {busy ? "Generating…" : "Regenerate summary"}
            </Button>
          </div>
        </Panel>
        <Panel title="Overview">
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-semibold">Client</dt>
              <dd>{client?.displayName ?? "Unknown"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Reference</dt>
              <dd>{matter.matterNumber}</dd>
            </div>
            <div>
              <dt className="font-semibold">Description</dt>
              <dd>{matter.description || "—"}</dd>
            </div>
            <div>
              <dt className="font-semibold">Court</dt>
              <dd>{matter.court || "—"}</dd>
            </div>
          </dl>
        </Panel>
        <Panel title="Key people / organizations">
          {(verified?.entities ?? []).length === 0 ? (
            <p className="text-sm text-ink/70">No verified entities yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {verified.entities.map((entity: any) => (
                <li key={entity.id}>
                  <span className="font-semibold">{entity.displayName}</span> · {entity.entityType}
                  {(entity.roles ?? []).length > 0
                    ? ` · ${(entity.roles as any[]).map((r: any) => r.role).join(", ")}`
                    : ""}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent timeline events">
          {(verified?.recentEvents ?? []).length === 0 ? (
            <p className="text-sm text-ink/70">No verified timeline events yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {verified.recentEvents.map((event: any) => (
                <li key={event.id}>
                  <div className="font-semibold">{event.title}</div>
                  <div className="text-ink/70">
                    {event.eventDate
                      ? new Date(event.eventDate).toLocaleDateString()
                      : "Date unknown"}{" "}
                    · {event.eventType} · {event.datePrecision}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Verified facts">
          {(verified?.facts ?? []).length === 0 ? (
            <p className="text-sm text-ink/70">No verified facts yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {verified.facts.map((fact: any) => (
                <li key={fact.id}>
                  <span className="font-semibold">{fact.label}:</span> {fact.value}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Upcoming verified deadlines">
          {(verified?.upcomingDeadlines ?? []).length === 0 ? (
            <p className="text-sm text-ink/70">No verified deadlines yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {verified.upcomingDeadlines.map((deadline: any) => (
                <li key={deadline.id}>
                  <div className="font-semibold">{deadline.title}</div>
                  <div className="text-ink/70">
                    {deadline.dueAt
                      ? new Date(deadline.dueAt).toLocaleDateString()
                      : "Date unknown"}{" "}
                    · {deadline.dateKind}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Recent documents">
          {(recentDocuments ?? []).length === 0 ? (
            <p className="text-sm text-ink/70">No uploads yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recentDocuments.map((doc: any) => (
                <li key={doc.id}>
                  {doc.title} · <span className="text-ink/60">{doc.processingState}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Saved Nyaya answers">
          {(recentNotes ?? []).filter((n: any) => n.origin === "nyaya").length === 0 ? (
            <p className="text-sm text-ink/70">No saved answers yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(recentNotes ?? [])
                .filter((n: any) => n.origin === "nyaya")
                .map((note: any) => (
                  <li key={note.id}>
                    <div className="font-semibold">{note.title}</div>
                    <div className="text-ink/70">{note.content.slice(0, 160)}</div>
                  </li>
                ))}
            </ul>
          )}
        </Panel>
        <Panel title="Open tasks">
          {(openTasks ?? []).length === 0 ? (
            <p className="text-sm text-ink/70">No open tasks.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {openTasks.map((task: any) => (
                <li key={task.id}>
                  {task.title} · {task.priority}
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Agent runs">
          {agentRuns.length === 0 ? (
            <p className="text-sm text-ink/70">
              No Nyaya agent runs yet.{" "}
              <Link href={`/app/matters/${matterId}/nyaya`} className="text-accent underline">
                Run a task
              </Link>
              .
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {agentRuns.map((run) => (
                <li key={run.id}>
                  <Link href={`/app/matters/${matterId}/nyaya`} className="hover:underline">
                    <span className="line-clamp-1 font-semibold">{run.goal}</span>
                  </Link>
                  <div className="text-ink/70">
                    {run.status} · {run.intent ?? "unclassified"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </MatterShell>
  );
}
