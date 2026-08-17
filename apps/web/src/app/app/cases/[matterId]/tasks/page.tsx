"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Panel } from "@nyayagrid/ui";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  SourceDrawer,
  SuggestedBadge,
  VerifiedBadge,
  type SourceDrawerItem,
} from "@/components/ux";

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  dueAt?: string | null;
};

type DeadlineSource = {
  id: string;
  documentId: string;
  chunkId: string;
  page: number | null;
  supportingText: string;
  documentTitle: string;
};

type Deadline = {
  id: string;
  title: string;
  description: string | null;
  dueAt: string | null;
  datePrecision: string;
  dateKind: "explicit" | "inferred";
  timezoneLabel: string;
  status: string;
  origin: string | null;
  uncertaintyNotes: string | null;
  sources: DeadlineSource[];
};

const PRIORITIES = ["low", "medium", "high", "urgent"] as const;

function isVerified(status: string) {
  return status === "approved" || status === "edited_and_approved";
}

function statusActions(status: string): Array<{ label: string; next: string }> {
  if (status === "open") {
    return [
      { label: "Start", next: "in_progress" },
      { label: "Mark complete", next: "completed" },
      { label: "Cancel", next: "cancelled" },
    ];
  }
  if (status === "in_progress") {
    return [
      { label: "Mark complete", next: "completed" },
      { label: "Cancel", next: "cancelled" },
      { label: "Reopen", next: "open" },
    ];
  }
  if (status === "completed" || status === "cancelled") {
    return [{ label: "Reopen", next: "open" }];
  }
  return [];
}

function formatWhen(iso: string | null, timezoneLabel: string) {
  if (!iso) return `Date unknown · ${timezoneLabel}`;
  return `${new Date(iso).toLocaleString()} · ${timezoneLabel}`;
}

export default function CaseTasksPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deadlines, setDeadlines] = useState<Deadline[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedDeadline, setSelectedDeadline] = useState<Deadline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("medium");
  const [dueAt, setDueAt] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  async function load(keepTaskId?: string | null, keepDeadlineId?: string | null) {
    const [tasksRes, deadlinesRes] = await Promise.all([
      fetch(`/api/v1/matters/${matterId}/tasks`),
      fetch(`/api/v1/matters/${matterId}/deadlines`),
    ]);
    const tasksJson = await tasksRes.json();
    const deadlinesJson = await deadlinesRes.json();
    if (!tasksRes.ok) throw new Error(tasksJson?.error?.message ?? "Failed to load tasks");
    if (!deadlinesRes.ok)
      throw new Error(deadlinesJson?.error?.message ?? "Failed to load deadlines");
    const nextTasks: Task[] = tasksJson.tasks ?? [];
    const nextDeadlines: Deadline[] = deadlinesJson.deadlines ?? [];
    setTasks(nextTasks);
    setDeadlines(nextDeadlines);
    const taskId = keepTaskId ?? selectedTask?.id;
    const deadlineId = keepDeadlineId ?? selectedDeadline?.id;
    setSelectedTask(taskId ? (nextTasks.find((t) => t.id === taskId) ?? null) : null);
    setSelectedDeadline(
      deadlineId ? (nextDeadlines.find((d) => d.id === deadlineId) ?? null) : null,
    );
    return { nextTasks, nextDeadlines };
  }

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const taskId = search.get("taskId");
    const deadlineId = search.get("deadlineId");
    setLoading(true);
    load(taskId, deadlineId)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  const proposedDeadlines = useMemo(
    () => deadlines.filter((d) => d.status === "proposed"),
    [deadlines],
  );
  const verifiedDeadlines = useMemo(
    () => deadlines.filter((d) => isVerified(d.status)),
    [deadlines],
  );

  async function createTask(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          priority,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");
      setTitle("");
      setDescription("");
      setPriority("medium");
      setDueAt("");
      await load(json.task?.id ?? null, selectedDeadline?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function patchTask(taskId: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      await load(taskId, selectedDeadline?.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewDeadline(deadlineId: string, action: "approve" | "reject") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/deadlines/${deadlineId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Deadline review failed");
      await load(selectedTask?.id, action === "reject" ? null : deadlineId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deadline review failed");
    } finally {
      setBusy(false);
    }
  }

  function openSources(deadline: Deadline) {
    setDrawerItems(
      deadline.sources.map((s) => ({
        id: s.id,
        title: s.documentTitle,
        classLabel: "Matter Evidence",
        subtitle: s.page != null ? `Page ${s.page}` : undefined,
        quote: s.supportingText,
        chunkId: s.chunkId,
        documentId: s.documentId,
      })),
    );
    setDrawerOpen(true);
  }

  if (loading) return <LoadingState label="Loading tasks…" />;
  if (error && tasks.length === 0 && deadlines.length === 0) return <ErrorState message={error} />;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-ink">Tasks & Deadlines</h2>
        <p className="text-sm text-ink/60">
          Attorney work items plus Nyaya-proposed deadlines. Deadlines always show timezone and
          whether the date was explicit in the source or inferred.
        </p>
      </div>
      {error ? <ErrorState message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Tasks">
          {tasks.length === 0 ? (
            <EmptyState
              title="No tasks yet"
              description="Create a task with a priority and description, then move it through status."
            />
          ) : (
            <ul aria-label="Case tasks" className="space-y-2">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      selectedTask?.id === task.id
                        ? "border-accent bg-accent-soft/40"
                        : "border-line bg-white hover:bg-accent-soft/20"
                    }`}
                    onClick={() => setSelectedTask(task)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{task.title}</span>
                      <Badge>{task.status}</Badge>
                      <Badge>{task.priority}</Badge>
                    </div>
                    {task.description ? (
                      <p className="mt-1 line-clamp-2 text-xs text-ink/60">{task.description}</p>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={selectedTask ? selectedTask.title : "Task detail"}>
          {!selectedTask ? (
            <p className="text-sm text-ink/60">Select a task.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge>{selectedTask.status}</Badge>
                <Badge>{selectedTask.priority}</Badge>
              </div>
              <p className="text-ink/75">{selectedTask.description || "No description."}</p>
              {selectedTask.dueAt ? (
                <p className="text-xs text-ink/55">
                  Due {new Date(selectedTask.dueAt).toLocaleString()}
                </p>
              ) : null}
              <label className="block text-xs text-ink/60">
                Priority
                <select
                  className="mt-1 w-full rounded border border-line px-3 py-2 text-sm text-ink"
                  aria-label="Task priority"
                  value={selectedTask.priority}
                  disabled={busy}
                  onChange={(e) =>
                    patchTask(selectedTask.id, {
                      priority: e.target.value,
                    })
                  }
                >
                  {PRIORITIES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                {statusActions(selectedTask.status).map((action) => (
                  <Button
                    key={action.next}
                    type="button"
                    disabled={busy}
                    variant={action.next === "cancelled" ? "ghost" : "secondary"}
                    onClick={() => patchTask(selectedTask.id, { status: action.next })}
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Add task">
        <form className="flex flex-col gap-3" onSubmit={createTask}>
          <input
            className="rounded border border-line px-3 py-2"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title"
            required
            aria-label="Task title"
          />
          <textarea
            className="rounded border border-line px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            aria-label="Task description"
            rows={3}
          />
          <label className="text-sm">
            Priority{" "}
            <select
              className="ml-2 rounded border border-line px-2 py-1"
              value={priority}
              onChange={(e) => setPriority(e.target.value as (typeof PRIORITIES)[number])}
              aria-label="New task priority"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <input
            type="datetime-local"
            className="rounded border border-line px-3 py-2"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            aria-label="Due at"
          />
          <Button type="submit" disabled={busy || !title.trim()}>
            Create task
          </Button>
        </form>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={`Verified deadlines (${verifiedDeadlines.length})`}>
          {verifiedDeadlines.length === 0 ? (
            <EmptyState
              title="No verified deadlines"
              description="Approve a suggested deadline after checking its source and date kind."
            />
          ) : (
            <ul aria-label="Verified deadlines" className="space-y-2">
              {verifiedDeadlines.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      selectedDeadline?.id === d.id
                        ? "border-accent bg-accent-soft/40"
                        : "border-line bg-white"
                    }`}
                    onClick={() => setSelectedDeadline(d)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{d.title}</span>
                      <VerifiedBadge />
                      <Badge>{d.dateKind}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink/55">
                      {formatWhen(d.dueAt, d.timezoneLabel)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={`Suggested deadlines (${proposedDeadlines.length})`}>
          {proposedDeadlines.length === 0 ? (
            <p className="text-sm text-ink/60">No deadline suggestions pending review.</p>
          ) : (
            <ul aria-label="Suggested deadlines" className="space-y-2">
              {proposedDeadlines.map((d) => (
                <li key={d.id}>
                  <button
                    type="button"
                    className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                      selectedDeadline?.id === d.id
                        ? "border-amber-700/40 bg-amber-50/60"
                        : "border-amber-700/20 bg-amber-50/40"
                    }`}
                    onClick={() => setSelectedDeadline(d)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{d.title}</span>
                      <SuggestedBadge />
                      <Badge>{d.dateKind}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-ink/55">
                      {formatWhen(d.dueAt, d.timezoneLabel)}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <Panel title={selectedDeadline ? selectedDeadline.title : "Deadline detail"}>
        {!selectedDeadline ? (
          <p className="text-sm text-ink/60">Select a deadline to inspect sources and review.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {selectedDeadline.status === "proposed" ? <SuggestedBadge /> : <VerifiedBadge />}
              <Badge>{selectedDeadline.dateKind}</Badge>
              <Badge>{selectedDeadline.datePrecision}</Badge>
            </div>
            <p>{formatWhen(selectedDeadline.dueAt, selectedDeadline.timezoneLabel)}</p>
            {selectedDeadline.description ? (
              <p className="text-ink/75">{selectedDeadline.description}</p>
            ) : null}
            {selectedDeadline.uncertaintyNotes ? (
              <p className="text-xs text-ink/55">{selectedDeadline.uncertaintyNotes}</p>
            ) : null}
            <p className="text-xs text-ink/55">
              {selectedDeadline.sources.length} source
              {selectedDeadline.sources.length === 1 ? "" : "s"} · date is{" "}
              {selectedDeadline.dateKind === "inferred" ? "inferred" : "explicit in the source"} ·{" "}
              {selectedDeadline.timezoneLabel}
            </p>
            <Button type="button" variant="secondary" onClick={() => openSources(selectedDeadline)}>
              Inspect sources
            </Button>
            {selectedDeadline.status === "proposed" ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() => reviewDeadline(selectedDeadline.id, "approve")}
                >
                  Approve
                </Button>
                <Button
                  type="button"
                  disabled={busy}
                  variant="ghost"
                  onClick={() => reviewDeadline(selectedDeadline.id, "reject")}
                >
                  Reject
                </Button>
              </div>
            ) : null}
            <Link
              href={`/app/cases/${matterId}/review`}
              className="inline-block text-xs font-semibold text-accent underline"
            >
              Open full review queue
            </Link>
          </div>
        )}
      </Panel>

      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
