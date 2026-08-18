"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button, Panel } from "@nyayagrid/ui";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SuggestedBadge,
  VerifiedBadge,
  WorkRunCard,
} from "@/components/ux";

type AgentRun = {
  id: string;
  goal: string;
  status: string;
  intent: string | null;
  createdAt: string;
};

type Draft = {
  id: string;
  title: string;
  status?: string;
  aiGenerated?: boolean;
  updatedAt?: string;
};

type Task = { id: string; title: string; status: string; priority?: string };
type Deadline = {
  id: string;
  title: string;
  status: string;
  dueAt: string | null;
  dateKind: string;
  timezoneLabel: string;
};
type Memo = { id: string; issue: string | null; createdAt: string; sessionId: string | null };
type Finding = { id: string; title?: string; status?: string; findingType?: string };

export default function CaseWorkPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/v1/matters/${matterId}/agents?limit=20`).then((r) => r.json()),
      fetch(`/api/v1/matters/${matterId}/drafts`).then((r) => r.json()),
      fetch(`/api/v1/matters/${matterId}/tasks`).then((r) => r.json()),
      fetch(`/api/v1/matters/${matterId}/deadlines`).then((r) => r.json()),
      fetch(`/api/v1/matters/${matterId}/research/sessions`).then((r) => r.json()),
      fetch(`/api/v1/matters/${matterId}/analysis/findings`).then((r) => r.json()),
    ])
      .then(([agents, draftsJson, tasksJson, deadlinesJson, researchJson, findingsJson]) => {
        if (agents.error) throw new Error(agents.error.message);
        setRuns(agents.runs ?? []);
        setDrafts(draftsJson.drafts ?? []);
        setTasks(tasksJson.tasks ?? []);
        setDeadlines(deadlinesJson.deadlines ?? []);
        setMemos(researchJson.memos ?? []);
        setFindings(findingsJson.findings ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load work"))
      .finally(() => setLoading(false));
  }, [matterId]);

  const needsApproval = useMemo(() => runs.filter((r) => r.status === "awaiting_approval"), [runs]);
  const running = useMemo(
    () => runs.filter((r) => ["planned", "running", "awaiting_approval"].includes(r.status)),
    [runs],
  );
  const completed = useMemo(
    () => runs.filter((r) => r.status === "completed" || r.status === "failed"),
    [runs],
  );
  const openTasks = useMemo(
    () => tasks.filter((t) => t.status === "open" || t.status === "in_progress"),
    [tasks],
  );
  const draftsNeedingReview = useMemo(
    () => drafts.filter((d) => d.aiGenerated || d.status === "draft" || d.status === "in_review"),
    [drafts],
  );
  const proposedDeadlines = useMemo(
    () => deadlines.filter((d) => d.status === "proposed"),
    [deadlines],
  );

  if (loading) return <LoadingState label="Loading work…" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl text-ink">Work</h2>
          <p className="text-sm text-ink/60">
            Tasks, drafts, and items waiting for your OK.
          </p>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Work destinations">
          <Link href={`/app/cases/${matterId}/nyaya`}>
            <Button type="button">Nyaya</Button>
          </Link>
          <Link href={`/app/cases/${matterId}/draft`}>
            <Button type="button" variant="secondary">
              Draft
            </Button>
          </Link>
          <Link href={`/app/cases/${matterId}/research`}>
            <Button type="button" variant="secondary">
              Research
            </Button>
          </Link>
          <Link href={`/app/cases/${matterId}/analysis`}>
            <Button type="button" variant="secondary">
              Analysis
            </Button>
          </Link>
          <Link href={`/app/cases/${matterId}/review`}>
            <Button type="button" variant="secondary">
              Review
            </Button>
          </Link>
        </nav>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Panel title="Approvals">
          <p className="text-2xl font-semibold">{needsApproval.length}</p>
          <p className="text-xs text-ink/55">Waiting for your OK</p>
        </Panel>
        <Panel title="Open tasks">
          <p className="text-2xl font-semibold">{openTasks.length}</p>
          <p className="text-xs text-ink/55">Open or in progress</p>
        </Panel>
        <Panel title="Drafts to review">
          <p className="text-2xl font-semibold">{draftsNeedingReview.length}</p>
          <p className="text-xs text-ink/55">AI-generated or still draft</p>
        </Panel>
        <Panel title="Analysis findings">
          <p className="text-2xl font-semibold">{findings.length}</p>
          <Link
            href={`/app/cases/${matterId}/analysis`}
            className="text-xs font-semibold text-accent underline"
          >
            Open Analysis
          </Link>
        </Panel>
      </div>

      <Panel title="Needs Approval">
        {needsApproval.length === 0 ? (
          <p className="text-sm text-ink/60">No pending approvals.</p>
        ) : (
          <div className="space-y-2">
            {needsApproval.map((r) => (
              <WorkRunCard
                key={r.id}
                title={r.goal}
                status="awaiting approval"
                href={`/app/cases/${matterId}/nyaya?runId=${r.id}`}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Running">
        {running.length === 0 ? (
          <p className="text-sm text-ink/60">No active runs.</p>
        ) : (
          <div className="space-y-2">
            {running.map((r) => (
              <WorkRunCard
                key={r.id}
                title={r.goal}
                status={r.status}
                progress={r.intent ?? undefined}
                href={`/app/cases/${matterId}/nyaya?runId=${r.id}`}
              />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Open tasks">
          {openTasks.length === 0 ? (
            <p className="text-sm text-ink/60">No open tasks.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {openTasks.slice(0, 8).map((t) => (
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
        </Panel>
        <Panel title="Deadlines">
          {deadlines.length === 0 ? (
            <p className="text-sm text-ink/60">No sourced deadlines yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {deadlines.slice(0, 8).map((d) => (
                <li key={d.id}>
                  <Link
                    href={`/app/cases/${matterId}/tasks?deadlineId=${d.id}`}
                    className="font-semibold text-accent underline"
                  >
                    {d.title}
                  </Link>
                  <p className="text-xs text-ink/55">
                    {d.dueAt ? new Date(d.dueAt).toLocaleString() : "Date unknown"} · {d.dateKind} ·{" "}
                    {d.timezoneLabel}{" "}
                    {d.status === "proposed" ? <SuggestedBadge /> : <VerifiedBadge />}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {proposedDeadlines.length > 0 ? (
            <p className="mt-2 text-xs text-ink/55">
              {proposedDeadlines.length} suggested deadline
              {proposedDeadlines.length === 1 ? "" : "s"} awaiting review.
            </p>
          ) : null}
        </Panel>
      </div>

      <Panel title="Completed runs">
        {completed.length === 0 ? (
          <EmptyState
            title="No completed runs"
            description="Complex goals appear here after Nyaya finishes a task."
          />
        ) : (
          <div className="space-y-2">
            {completed.slice(0, 10).map((r) => (
              <WorkRunCard
                key={r.id}
                title={r.goal}
                status={r.status}
                href={`/app/cases/${matterId}/nyaya?runId=${r.id}`}
              />
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Saved work">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold">Research memos</h3>
            {memos.length === 0 ? (
              <p className="mt-2 text-sm text-ink/60">No research memos saved yet.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {memos.map((m) => (
                  <li key={m.id}>
                    <Link
                      href={`/app/cases/${matterId}/research`}
                      className="font-semibold text-accent underline"
                    >
                      {m.issue || "Research memo"}
                    </Link>
                    <span className="ml-2 text-xs text-ink/50">
                      {new Date(m.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold">Drafts</h3>
            {drafts.length === 0 ? (
              <p className="mt-2 text-sm text-ink/60">No drafts yet.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {drafts.slice(0, 8).map((d) => (
                  <li key={d.id} className="flex justify-between gap-2">
                    <Link
                      href={`/app/cases/${matterId}/draft`}
                      className="font-semibold text-accent underline"
                    >
                      {d.title}
                    </Link>
                    <span className="text-xs text-ink/50">
                      {d.status ?? "draft"}
                      {d.aiGenerated ? " · AI" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </Panel>
    </div>
  );
}
