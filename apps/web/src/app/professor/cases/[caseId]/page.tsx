"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { StudentShell } from "@/components/shell";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type StudentCase = {
  id: string;
  title: string;
  citation: string | null;
  court: string | null;
  decisionDate: string | null;
  processingState: string;
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
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const passageByChunkId = new Map(passages.map((p) => [p.chunkId, p]));

  async function refresh() {
    const res = await fetch(`/api/v1/professor/cases/${caseId}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load case");
    setStudentCase(data.case);
    setPassages(data.passages ?? []);
    setBrief(data.brief?.brief ?? null);
  }

  useEffect(() => {
    if (!caseId) return;
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed to load case"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function generateBrief() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/professor/cases/${caseId}/brief`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to generate brief");
      setBrief(data.brief);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate brief");
    } finally {
      setBusy(false);
    }
  }

  async function askAboutCase(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const conversationRes = await fetch("/api/v1/professor/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: `About ${studentCase?.title ?? "this case"}` }),
      });
      const conversationData = await conversationRes.json();
      if (!conversationRes.ok) {
        throw new Error(conversationData?.error?.message ?? "Failed to start conversation");
      }
      const res = await fetch(
        `/api/v1/professor/conversations/${conversationData.conversation.id}/ask`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, caseId }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to get an answer");
      setAnswer(data.answer?.answer ?? null);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ask about this case");
    } finally {
      setBusy(false);
    }
  }

  const activePassage = activeChunkId ? passageByChunkId.get(activeChunkId) : null;

  return (
    <StudentShell>
      <PageHeader
        eyebrow="Nyaya Professor · Case"
        title={studentCase?.title ?? "Loading case…"}
        description={
          studentCase
            ? [studentCase.citation, studentCase.court, studentCase.decisionDate]
                .filter(Boolean)
                .join(" · ") || "No additional metadata provided."
            : undefined
        }
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel title="Case brief">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm text-ink/70">
                Generated from your uploaded text only. Compare it against the opinion before
                relying on it.
              </p>
              <Button onClick={generateBrief} disabled={busy} variant="secondary">
                {busy ? "Working…" : brief ? "Regenerate brief" : "Generate brief"}
              </Button>
            </div>
            {!brief ? (
              <p className="text-sm text-ink/60">No brief generated yet.</p>
            ) : (
              <div className="space-y-3">
                {BRIEF_SECTIONS.map(({ key, label }) => {
                  const section = brief[key] as BriefSection;
                  if (!section) return null;
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
                              onClick={() => setActiveChunkId(chunkId)}
                              className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent hover:bg-accent-soft/70"
                            >
                              View source
                              {passageByChunkId.get(chunkId)?.pageStart
                                ? ` (p.${passageByChunkId.get(chunkId)?.pageStart})`
                                : ""}
                            </button>
                          ))}
                        </div>
                      ) : null}
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
            <form className="flex gap-2" onSubmit={askAboutCase}>
              <input
                className="flex-1 rounded border border-line px-3 py-2 text-sm"
                placeholder="e.g. What test does the court apply?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <Button type="submit" disabled={busy || !question.trim()}>
                Ask
              </Button>
            </form>
            {answer ? (
              <p className="mt-3 whitespace-pre-wrap rounded border border-line bg-white px-3 py-2 text-sm">
                {answer}
              </p>
            ) : null}
          </Panel>
        </div>

        <Panel title="Source viewer" className="lg:sticky lg:top-4 lg:self-start">
          {!activePassage ? (
            <p className="text-sm text-ink/70">
              Click &ldquo;View source&rdquo; next to a brief section to see the underlying passage
              here.
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
    </StudentShell>
  );
}
