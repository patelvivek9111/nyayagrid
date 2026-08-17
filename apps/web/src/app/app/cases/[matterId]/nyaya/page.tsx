"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Button, Panel, Badge } from "@nyayagrid/ui";
import { openMatterDocument } from "@/lib/document-open";

type Citation = {
  chunkId?: string;
  documentId: string;
  documentVersionId: string;
  page?: number;
  paragraph?: string;
  quote: string;
};

type AskResult = {
  conversationId: string;
  artifact: { id: string; evidenceState: string; provider: string; model: string };
  answer: {
    answer: string;
    sources: Citation[];
    evidenceState: string;
    unresolvedQuestions: string[];
  };
};

type AgentRunSummary = {
  id: string;
  goal: string;
  status: string;
  intent: string | null;
  createdAt: string;
  completedAt: string | null;
};

type AgentRunStep = {
  id: string;
  stepId: string;
  stepOrder: number;
  agentType: string;
  objective: string;
  status: string;
  approvalRequirement: string;
  outputSummary: string | null;
  errorMessage: string | null;
};

type AgentProvenanceEntry = { class: string; refs: string[]; note?: string };

type AgentArtifact = {
  id: string;
  artifactType: string;
  title: string | null;
  content: string | null;
  provenance: AgentProvenanceEntry[];
  generatedBy: string | null;
  createdAt: string;
};

type AgentApproval = {
  id: string;
  actionType: string;
  proposedData: Record<string, unknown>;
  rationale: string | null;
  riskLevel: string;
  status: string;
  createdAt: string;
};

type AgentRunDetail = {
  run: AgentRunSummary & {
    userFacingPlan: string | null;
    limitations: string[] | null;
    errorSummary: string | null;
  };
  steps: AgentRunStep[];
  artifacts: AgentArtifact[];
  approvals: AgentApproval[];
};

const ACTIVE_RUN_STATUSES = new Set(["planned", "running", "awaiting_approval"]);
const POLL_INTERVAL_MS = 4000;

function statusTone(status: string): string {
  if (status === "completed") return "text-emerald-700";
  if (status === "failed") return "text-[var(--ng-danger)]";
  if (status === "awaiting_approval") return "text-amber-700";
  return "text-ink/70";
}

export default function MatterNyayaPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [tab, setTab] = useState<"ask" | "task">("ask");
  const [message, setMessage] = useState("");

  // Ask Nyaya state
  const [question, setQuestion] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [history, setHistory] = useState<AskResult[]>([]);
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [sourceText, setSourceText] = useState("");
  const [sourceDocumentId, setSourceDocumentId] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  // Run Task state
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [runs, setRuns] = useState<AgentRunSummary[]>([]);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [currentRun, setCurrentRun] = useState<AgentRunDetail | null>(null);
  const [taskAnswer, setTaskAnswer] = useState<AskResult | null>(null);
  const [reviewBusyId, setReviewBusyId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const runId = new URLSearchParams(window.location.search).get("runId");
    if (runId) {
      setTab("task");
      setCurrentRunId(runId);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/agents?limit=20`);
      const data = await res.json();
      if (res.ok) setRuns(data.runs ?? []);
    } catch {
      // Best-effort refresh; surfaced errors come from the active actions instead.
    }
  }, [matterId]);

  const loadRunDetail = useCallback(
    async (runId: string) => {
      const res = await fetch(`/api/v1/matters/${matterId}/agents/${runId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load run");
      setCurrentRun(data);
      return data as AgentRunDetail;
    },
    [matterId],
  );

  useEffect(() => {
    if (tab === "task") loadRuns();
  }, [tab, loadRuns]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!currentRunId) return;
    const tick = () => {
      loadRunDetail(currentRunId).catch(() => undefined);
    };
    tick();
    pollRef.current = setInterval(() => {
      if (currentRun && !ACTIVE_RUN_STATUSES.has(currentRun.run.status)) return;
      tick();
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRunId, loadRunDetail]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    setAsking(true);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, conversationId, mode: "ask" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Ask failed");
      setConversationId(data.qa.conversationId);
      setHistory((prev) => [data.qa, ...prev]);
      setQuestion("");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Ask failed");
    } finally {
      setAsking(false);
    }
  }

  async function openCitation(chunkId?: string) {
    if (!chunkId) {
      setMessage("Citation missing chunkId");
      return;
    }
    const res = await fetch(`/api/v1/matters/${matterId}/citations/${chunkId}`);
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message ?? "Citation unavailable");
      return;
    }
    setSelectedSource(chunkId);
    setSourceText(
      `Page ${data.chunk.pageStart ?? "—"} · ${data.chunk.segmentRef ?? ""}\n\n${data.chunk.content}`,
    );
    setSourceDocumentId(data.document?.id ?? data.chunk?.documentId ?? null);
  }

  async function saveAnswer(artifactId: string) {
    const res = await fetch(`/api/v1/matters/${matterId}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artifactId }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message ?? "Save failed");
      return;
    }
    setMessage(`Saved note ${data.note.id}`);
  }

  async function createTaskFromAnswer(artifactId: string, answerText: string) {
    const res = await fetch(`/api/v1/matters/${matterId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Follow up on Nyaya answer",
        description: answerText.slice(0, 1000),
        sourceArtifactId: artifactId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setMessage(data?.error?.message ?? "Task create failed");
      return;
    }
    setMessage(`Created task ${data.task.id}`);
  }

  async function planAndRun(event: FormEvent) {
    event.preventDefault();
    setPlanning(true);
    setMessage("");
    setTaskAnswer(null);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goal, execute: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Run failed");
      if (data.mode === "qa") {
        setTaskAnswer(data.qa);
        setCurrentRunId(null);
        setCurrentRun(null);
        setMessage(
          "Nyaya answered this directly instead of starting a run, because it looks like a single question.",
        );
      } else {
        setGoal("");
        setCurrentRunId(data.run.run.id);
        setCurrentRun(data.run);
        await loadRuns();
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Run failed");
    } finally {
      setPlanning(false);
    }
  }

  async function resumeRun(runId: string) {
    setMessage("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/agents/${runId}/execute`, {
        method: "POST",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Resume failed");
      setCurrentRun(data);
      await loadRuns();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Resume failed");
    }
  }

  async function cancelRun(runId: string) {
    setMessage("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/agents/${runId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Cancel failed");
      await loadRunDetail(runId);
      await loadRuns();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Cancel failed");
    }
  }

  async function reviewApproval(
    approvalId: string,
    action: "approve" | "edit_and_approve" | "reject",
  ) {
    if (!currentRunId) return;
    setReviewBusyId(approvalId);
    setMessage("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/agents/approvals/${approvalId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: reviewNotes[approvalId] || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Review failed");
      await loadRunDetail(currentRunId);
      setMessage(
        data.executionNote
          ? data.executionNote
          : `Approval ${data.approval.status.replace(/_/g, " ")}.`,
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Review failed");
    } finally {
      setReviewBusyId(null);
    }
  }

  const pendingApprovals = (currentRun?.approvals ?? []).filter((a) => a.status === "pending");

  return (
    <>
      <div className="mb-4 flex gap-2">
        <Button variant={tab === "ask" ? "primary" : "secondary"} onClick={() => setTab("ask")}>
          Ask Nyaya
        </Button>
        <Button variant={tab === "task" ? "primary" : "secondary"} onClick={() => setTab("task")}>
          Run Task
        </Button>
      </div>
      {message ? <p className="mb-3 text-sm text-accent">{message}</p> : null}

      {tab === "ask" ? (
        <>
          <Panel title="Ask Nyaya">
            <p className="mb-3 text-sm text-ink/70">
              Matter-scoped document intelligence. Answers are draft work product and must cite
              retrieved sources.
            </p>
            <form className="flex flex-col gap-3" onSubmit={ask}>
              <textarea
                className="min-h-24 rounded border border-line px-3 py-2"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask a factual question about this matter's documents…"
                required
              />
              <Button type="submit" disabled={asking}>
                {asking ? "Retrieving…" : "Ask Nyaya"}
              </Button>
            </form>
          </Panel>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Panel title="Conversation">
              {history.length === 0 ? (
                <p className="text-sm text-ink/70">No questions yet.</p>
              ) : (
                <div className="space-y-4">
                  {history.map((item) => (
                    <article
                      key={item.artifact.id}
                      className="rounded border border-line p-3 text-sm"
                    >
                      <div className="mb-2 flex flex-wrap gap-2">
                        <Badge>{item.answer.evidenceState}</Badge>
                        <Badge>
                          {item.artifact.provider}/{item.artifact.model}
                        </Badge>
                      </div>
                      <p className="whitespace-pre-wrap">{item.answer.answer}</p>
                      <div className="mt-3 space-y-2">
                        <p className="font-semibold">Citations</p>
                        {item.answer.sources.length === 0 ? (
                          <p className="text-ink/60">No citations (insufficient evidence).</p>
                        ) : (
                          item.answer.sources.map((source, idx) => (
                            <button
                              key={`${item.artifact.id}-${idx}`}
                              type="button"
                              className="block w-full rounded bg-accent-soft/40 px-2 py-2 text-left hover:bg-accent-soft"
                              onClick={() => openCitation(source.chunkId)}
                            >
                              {source.page ? `p.${source.page} · ` : ""}
                              {source.quote.slice(0, 180)}
                            </button>
                          ))
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => saveAnswer(item.artifact.id)}
                        >
                          Save to matter
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => createTaskFromAnswer(item.artifact.id, item.answer.answer)}
                        >
                          Create task
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </Panel>
            <Panel title="Source inspector">
              {selectedSource ? (
                <div className="space-y-3">
                  <pre className="whitespace-pre-wrap text-sm text-ink/80">{sourceText}</pre>
                  {sourceDocumentId ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() =>
                          void openMatterDocument({
                            matterId,
                            documentId: sourceDocumentId,
                            disposition: "inline",
                          }).catch((err) =>
                            setMessage(
                              err instanceof Error ? err.message : "Could not open the original file",
                            ),
                          )
                        }
                      >
                        Open original
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          void openMatterDocument({
                            matterId,
                            documentId: sourceDocumentId,
                            disposition: "attachment",
                          }).catch((err) =>
                            setMessage(
                              err instanceof Error ? err.message : "Could not download the original file",
                            ),
                          )
                        }
                      >
                        Download
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-ink/70">
                  Select a citation to inspect the source passage and open the original file.
                </p>
              )}
            </Panel>
          </div>
        </>
      ) : (
        <>
          <Panel title="Run a Nyaya task">
            <p className="mb-3 text-sm text-ink/70">
              Describe a multi-step goal (research, drafting, contract review, deposition prep,
              evidence analysis…). Nyaya plans the steps, runs what it can, and pauses for your
              approval before anything high-risk is written.
            </p>
            <form className="flex flex-col gap-3" onSubmit={planAndRun}>
              <textarea
                className="min-h-24 rounded border border-line px-3 py-2"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="e.g. Research the notice requirements for this contract and draft a demand letter."
                required
              />
              <Button type="submit" disabled={planning}>
                {planning ? "Planning…" : "Plan & Run"}
              </Button>
            </form>
          </Panel>

          {taskAnswer ? (
            <Panel title="Direct answer" className="mt-4">
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge>{taskAnswer.answer.evidenceState}</Badge>
              </div>
              <p className="whitespace-pre-wrap text-sm">{taskAnswer.answer.answer}</p>
            </Panel>
          ) : null}

          <div className="mt-4 grid gap-4 lg:grid-cols-[280px_1fr]">
            <Panel title="Recent runs">
              {runs.length === 0 ? (
                <p className="text-sm text-ink/70">No agent runs yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {runs.map((run) => (
                    <li key={run.id}>
                      <button
                        type="button"
                        className={`block w-full rounded border px-2 py-2 text-left ${
                          currentRunId === run.id
                            ? "border-accent bg-accent-soft/50"
                            : "border-line bg-white"
                        }`}
                        onClick={() => {
                          setCurrentRunId(run.id);
                          setTaskAnswer(null);
                        }}
                      >
                        <div className="line-clamp-2 font-semibold">{run.goal}</div>
                        <div className={`text-xs ${statusTone(run.status)}`}>
                          {run.status} · {run.intent ?? "unclassified"}
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Run detail">
              {!currentRun ? (
                <p className="text-sm text-ink/70">Select a run, or plan a new one above.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge>{currentRun.run.status}</Badge>
                    {currentRun.run.intent ? <Badge>{currentRun.run.intent}</Badge> : null}
                    <div className="ml-auto flex gap-2">
                      {currentRun.run.status === "planned" ||
                      currentRun.run.status === "awaiting_approval" ? (
                        <Button variant="secondary" onClick={() => resumeRun(currentRun.run.id)}>
                          Resume run
                        </Button>
                      ) : null}
                      {ACTIVE_RUN_STATUSES.has(currentRun.run.status) ? (
                        <Button variant="ghost" onClick={() => cancelRun(currentRun.run.id)}>
                          Cancel
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  {currentRun.run.userFacingPlan ? (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">
                        Plan
                      </p>
                      <p className="whitespace-pre-wrap text-sm">{currentRun.run.userFacingPlan}</p>
                    </div>
                  ) : null}

                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">
                      Steps
                    </p>
                    <ul className="space-y-2 text-sm">
                      {currentRun.steps.map((step) => (
                        <li key={step.id} className="rounded border border-line p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-semibold">{step.objective}</span>
                            <span className={`text-xs ${statusTone(step.status)}`}>
                              {step.status}
                            </span>
                          </div>
                          <div className="text-xs text-ink/60">
                            {step.agentType} · approval: {step.approvalRequirement}
                          </div>
                          {step.outputSummary ? (
                            <p className="mt-1 text-ink/80">{step.outputSummary}</p>
                          ) : null}
                          {step.errorMessage ? (
                            <p className="mt-1 text-[var(--ng-danger)]">{step.errorMessage}</p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {(currentRun.run.limitations ?? []).length > 0 ? (
                    <div>
                      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">
                        Limitations / partial completion
                      </p>
                      <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">
                        {(currentRun.run.limitations ?? []).map((note, idx) => (
                          <li key={idx}>{note}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {currentRun.run.errorSummary ? (
                    <p className="text-sm text-[var(--ng-danger)]">{currentRun.run.errorSummary}</p>
                  ) : null}

                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">
                      Artifacts
                    </p>
                    {currentRun.artifacts.length === 0 ? (
                      <p className="text-sm text-ink/70">No artifacts produced yet.</p>
                    ) : (
                      <ul className="space-y-2 text-sm">
                        {currentRun.artifacts.map((artifact) => (
                          <li key={artifact.id} className="rounded border border-line p-2">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-semibold">
                                {artifact.title || artifact.artifactType}
                              </span>
                              <span className="text-xs text-ink/60">{artifact.generatedBy}</span>
                            </div>
                            {artifact.content ? (
                              <p className="mt-1 whitespace-pre-wrap text-ink/80">
                                {artifact.content.slice(0, 600)}
                              </p>
                            ) : null}
                            {artifact.provenance.length > 0 ? (
                              <div className="mt-1 flex flex-wrap gap-1">
                                {artifact.provenance.map((entry, idx) => (
                                  <Badge key={idx}>{entry.class}</Badge>
                                ))}
                              </div>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/60">
                      Pending approvals
                    </p>
                    {pendingApprovals.length === 0 ? (
                      <p className="text-sm text-ink/70">Nothing awaiting your review.</p>
                    ) : (
                      <ul className="space-y-3 text-sm">
                        {pendingApprovals.map((approval) => (
                          <li key={approval.id} className="rounded border border-line p-3">
                            <div className="mb-1 flex flex-wrap items-center gap-2">
                              <Badge>{approval.actionType}</Badge>
                              <Badge>{approval.riskLevel} risk</Badge>
                            </div>
                            {approval.rationale ? (
                              <p className="text-ink/80">{approval.rationale}</p>
                            ) : null}
                            <pre className="mt-2 max-h-40 overflow-auto rounded bg-accent-soft/30 p-2 text-xs">
                              {JSON.stringify(approval.proposedData, null, 2)}
                            </pre>
                            <input
                              className="mt-2 w-full rounded border border-line px-2 py-1.5 text-xs"
                              placeholder="Optional review note"
                              value={reviewNotes[approval.id] ?? ""}
                              onChange={(e) =>
                                setReviewNotes((prev) => ({
                                  ...prev,
                                  [approval.id]: e.target.value,
                                }))
                              }
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <Button
                                disabled={reviewBusyId === approval.id}
                                onClick={() => reviewApproval(approval.id, "approve")}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="secondary"
                                disabled={reviewBusyId === approval.id}
                                onClick={() => reviewApproval(approval.id, "edit_and_approve")}
                              >
                                Edit & approve
                              </Button>
                              <Button
                                variant="ghost"
                                disabled={reviewBusyId === approval.id}
                                onClick={() => reviewApproval(approval.id, "reject")}
                              >
                                Reject
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}
            </Panel>
          </div>
        </>
      )}
    </>
  );
}
