"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import {
  ProfessorSources,
  type ProfessorSourceRef,
} from "@/components/professor/professor-sources";
import { loadProfessorSettings } from "@/lib/professor-settings";
import { NO_STUDENT_SOURCES_ANSWER } from "@/lib/professor-copy";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type StudentCase = {
  id: string;
  title: string;
  citation: string | null;
  court: string | null;
  decisionDate: string | null;
  processingState: string;
  processingError: string | null;
  courseLabel: string | null;
};

type CasePassage = {
  chunkId: string;
  chunkIndex: number;
  content: string;
  pageStart: number | null;
  opinionPart: "majority" | "concurrence" | "dissent" | null;
};

type BriefSection = { text: string; chunkIds: string[] } | null;

type CaseBriefContent = {
  caseName: string;
  court: string | null;
  year: string | null;
  proceduralPosture: BriefSection;
  parties: BriefSection;
  materialFacts: BriefSection;
  issue: BriefSection;
  rule: BriefSection;
  holding: BriefSection;
  reasoning: BriefSection;
  judgment: BriefSection;
  concurrence: BriefSection;
  dissent: BriefSection;
  importance: BriefSection;
  openQuestions: string[];
  limitations: string[];
};

type StudentNote = {
  id: string;
  kind: "note" | "brief_challenge";
  sectionKey: string | null;
  title: string;
  content: string;
};

type StudentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  explanationLevel?: string | null;
  sources?: ProfessorSourceRef[];
  socraticFollowUp?: string | null;
};

const BRIEF_SECTIONS: Array<{ key: keyof CaseBriefContent; label: string }> = [
  { key: "proceduralPosture", label: "Procedural posture" },
  { key: "parties", label: "Parties" },
  { key: "materialFacts", label: "Material facts" },
  { key: "issue", label: "Issue" },
  { key: "rule", label: "Rule" },
  { key: "holding", label: "Holding" },
  { key: "reasoning", label: "Reasoning" },
  { key: "judgment", label: "Judgment" },
  { key: "concurrence", label: "Concurrence" },
  { key: "dissent", label: "Dissent" },
  { key: "importance", label: "Why it matters" },
];

export default function ProfessorCaseDetailPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;

  const [studentCase, setStudentCase] = useState<StudentCase | null>(null);
  const [passages, setPassages] = useState<CasePassage[]>([]);
  const [brief, setBrief] = useState<CaseBriefContent | null>(null);
  const [briefId, setBriefId] = useState<string | null>(null);
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<StudentMessageRow[]>([]);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const passageByChunkId = new Map(passages.map((p) => [p.chunkId, p]));

  async function refreshCase() {
    const res = await fetch(`/api/v1/professor/cases/${caseId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load case");
    setStudentCase(data.case);
    setPassages(data.passages ?? []);
    setBrief(data.brief?.brief ?? null);
    setBriefId(data.brief?.id ?? null);
    setNotes(data.notes ?? []);
  }

  async function refreshConversation() {
    const res = await fetch(`/api/v1/professor/cases/${caseId}/conversation`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load conversation");
    setConversationId(data.conversation.id);
    setMessages(data.messages ?? []);
  }

  useEffect(() => {
    if (!caseId) return;
    Promise.all([refreshCase(), refreshConversation()])
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load case"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function generateBrief() {
    if (brief && !window.confirm("Regenerate this brief from the current case text? The opinion itself is not overwritten.")) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/professor/cases/${caseId}/brief`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to generate brief");
      setBrief(data.brief);
      setBriefId(data.record?.id ?? briefId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate brief");
    } finally {
      setBusy(false);
    }
  }

  async function saveBrief() {
    if (!brief) return;
    setBusy(true);
    setSavedMessage("");
    try {
      const res = await fetch("/api/v1/professor/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "case_brief",
          title: `Brief: ${studentCase?.title ?? "case"}`,
          content: brief.holding?.text ?? brief.issue?.text ?? "Saved case brief",
          ref: { caseId, briefId },
          courseLabel: studentCase?.courseLabel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to save brief");
      setSavedMessage("Brief saved to your library.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save brief");
    } finally {
      setBusy(false);
    }
  }

  async function challengeSection(sectionKey: string) {
    const note = window.prompt("What about this section does not match the passage?");
    if (!note?.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/professor/cases/${caseId}/challenges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionKey, note: note.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to record challenge");
      setNotes((current) => [data.note, ...current]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record challenge");
    } finally {
      setBusy(false);
    }
  }

  async function askAboutCase(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || !conversationId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/professor/conversations/${conversationId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          caseId,
          explanationLevel: loadProfessorSettings().explanationLevel,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to get an answer");
      const firstCaseChunk = (data.sources as ProfessorSourceRef[] | undefined)?.find(
        (source) => source.provenance === "UPLOADED_CASE" && source.chunkId,
      );
      if (firstCaseChunk?.chunkId) setActiveChunkId(firstCaseChunk.chunkId);
      setQuestion("");
      await refreshConversation();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ask about this case");
    } finally {
      setBusy(false);
    }
  }

  const activePassage = activeChunkId ? passageByChunkId.get(activeChunkId) : null;
  const challengesBySection = new Map<string, StudentNote[]>();
  for (const note of notes) {
    if (note.kind === "brief_challenge" && note.sectionKey) {
      const list = challengesBySection.get(note.sectionKey) ?? [];
      list.push(note);
      challengesBySection.set(note.sectionKey, list);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Nyaya Professor · Case room"
        title={loading ? "Loading case…" : (studentCase?.title ?? "Case not found")}
        description={
          studentCase
            ? [studentCase.citation, studentCase.court, studentCase.decisionDate, studentCase.courseLabel]
                .filter(Boolean)
                .join(" · ") || "No additional metadata provided."
            : undefined
        }
      />
      <div className="mb-4">
        <StudyAidNotice />
      </div>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {savedMessage ? <p className="mb-4 text-sm text-accent">{savedMessage}</p> : null}

      {studentCase && studentCase.processingState !== "ready" ? (
        <p className="mb-4 text-sm text-ink/70">
          {studentCase.processingState === "failed"
            ? `Ingest failed: ${studentCase.processingError ?? "Could not process this opinion."}`
            : "This opinion is still being processed. Ask and brief will be available when it is ready."}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Case brief">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink/70">
                Generated from your uploaded text only. Compare it against the opinion before
                relying on it.
              </p>
              <div className="flex flex-wrap gap-2">
                {brief ? (
                  <Button onClick={saveBrief} disabled={busy} variant="secondary">
                    Save brief
                  </Button>
                ) : null}
                <Button onClick={generateBrief} disabled={busy} variant="secondary">
                  {busy ? "Working…" : brief ? "Regenerate brief" : "Generate brief"}
                </Button>
              </div>
            </div>
            {!brief ? (
              <p className="text-sm text-ink/60">No brief generated yet.</p>
            ) : (
              <div className="space-y-3">
                {BRIEF_SECTIONS.map(({ key, label }) => {
                  const section = brief[key] as BriefSection;
                  if (!section) return null;
                  const challenges = challengesBySection.get(String(key)) ?? [];
                  return (
                    <div key={key} className="rounded border border-line px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                        {label}
                      </p>
                      <p className="mt-1 text-sm text-ink/90">{section.text}</p>
                      {section.chunkIds.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {section.chunkIds.map((chunkId) => (
                            <button
                              key={chunkId}
                              type="button"
                              onClick={() => setActiveChunkId(chunkId)}
                              className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent hover:bg-accent-soft/70"
                            >
                              View source
                              {passageByChunkId.get(chunkId)?.opinionPart
                                ? ` · ${passageByChunkId.get(chunkId)?.opinionPart}`
                                : ""}
                              {passageByChunkId.get(chunkId)?.pageStart
                                ? ` (p.${passageByChunkId.get(chunkId)?.pageStart})`
                                : ""}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      <button
                        type="button"
                        className="mt-2 text-xs text-ink/50 underline hover:text-ink/80"
                        onClick={() => challengeSection(String(key))}
                        disabled={busy}
                      >
                        This does not match the passage
                      </button>
                      {challenges.map((challenge) => (
                        <p key={challenge.id} className="mt-1 text-xs text-[var(--ng-danger)]">
                          Flagged: {challenge.content}
                        </p>
                      ))}
                    </div>
                  );
                })}
                {brief.limitations.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5 text-xs text-ink/60">
                    {brief.limitations.map((limitation, i) => (
                      <li key={i}>{limitation}</li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </Panel>

          <Panel title="Ask about this case">
            <div className="mb-3 max-h-[22rem] space-y-3 overflow-y-auto">
              {messages.length === 0 ? (
                <p className="text-sm text-ink/60">Ask a follow-up. The thread stays on this case.</p>
              ) : (
                messages.map((message) => (
                  <div
                    key={message.id}
                    className={`rounded-lg border px-3 py-2 text-sm ${
                      message.role === "user"
                        ? "border-accent/30 bg-accent-soft/30"
                        : "border-line bg-white"
                    }`}
                  >
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/50">
                      {message.role === "user" ? "You" : "Professor"}
                      {message.explanationLevel ? ` · ${message.explanationLevel}` : ""}
                    </p>
                    <p className="whitespace-pre-wrap text-ink/90">{message.content}</p>
                    {message.content === NO_STUDENT_SOURCES_ANSWER ? (
                      <p className="mt-1 text-xs text-ink/50">No surviving sources for this answer.</p>
                    ) : null}
                    {message.sources ? (
                      <ProfessorSources sources={message.sources} onOpenChunk={setActiveChunkId} />
                    ) : null}
                    {message.socraticFollowUp ? (
                      <button
                        type="button"
                        className="mt-2 w-full rounded border border-accent/30 bg-accent-soft/40 px-2 py-1.5 text-left text-xs text-ink/80"
                        onClick={() => setQuestion(message.socraticFollowUp ?? "")}
                      >
                        <span className="font-semibold">Think about this: </span>
                        {message.socraticFollowUp}
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
            <form className="flex gap-2" onSubmit={askAboutCase}>
              <input
                className="flex-1 rounded border border-line px-3 py-2 text-sm"
                placeholder="e.g. What test does the court apply?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <Button type="submit" disabled={busy || !question.trim() || !conversationId}>
                Ask
              </Button>
            </form>
          </Panel>
        </div>

        <Panel title="Source viewer" className="lg:sticky lg:top-4 lg:self-start">
          {!activePassage ? (
            <p className="text-sm text-ink/70">
              Click a citation to highlight the underlying passage here. Opinion-part labels come
              from the uploaded text, not from the model.
            </p>
          ) : (
            <div className="text-sm">
              <div className="mb-2 flex items-center gap-2">
                {activePassage.opinionPart ? <Badge>{activePassage.opinionPart}</Badge> : null}
                {activePassage.pageStart ? (
                  <span className="text-xs text-ink/60">p.{activePassage.pageStart}</span>
                ) : null}
              </div>
              <p className="whitespace-pre-wrap text-ink/90">{activePassage.content}</p>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
