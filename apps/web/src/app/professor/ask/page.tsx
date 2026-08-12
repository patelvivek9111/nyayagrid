"use client";

import { useEffect, useState, type FormEvent } from "react";
import { StudentShell } from "@/components/shell";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type ExplanationLevel = "simple" | "standard" | "advanced";

type ConversationRow = {
  id: string;
  title: string;
  explanationLevel: ExplanationLevel;
  updatedAt: string;
};

type CaseRow = { id: string; title: string; citation: string | null };

type SourceRef = {
  provenance: "UPLOADED_CASE" | "LEGAL_AUTHORITY" | "PROFESSOR_EXPLANATION";
  caseId?: string;
  chunkId?: string;
  authorityId?: string;
  page?: number | null;
  opinionPart?: string | null;
  quote?: string | null;
  note?: string;
};

type StudentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: SourceRef[];
  socraticFollowUp?: string | null;
  createdAt: string;
};

const LEVELS: { value: ExplanationLevel; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "standard", label: "Standard" },
  { value: "advanced", label: "Advanced" },
];

function sourceLabel(source: SourceRef): string {
  if (source.provenance === "UPLOADED_CASE") return "Your uploaded case";
  if (source.provenance === "LEGAL_AUTHORITY") return "Legal authority";
  return "Professor's explanation";
}

export default function AskProfessorPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<StudentMessageRow[]>([]);
  const [explanationLevel, setExplanationLevel] = useState<ExplanationLevel>("standard");
  const [caseId, setCaseId] = useState<string>("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadConversations() {
    const res = await fetch("/api/v1/professor/conversations");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load conversations");
    setConversations(data.conversations ?? []);
    return data.conversations ?? [];
  }

  async function loadCases() {
    const res = await fetch("/api/v1/professor/cases");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load cases");
    setCases(data.cases ?? []);
  }

  async function loadConversation(id: string) {
    const res = await fetch(`/api/v1/professor/conversations/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load conversation");
    setMessages(data.messages ?? []);
    setExplanationLevel(data.conversation?.explanationLevel ?? "standard");
  }

  useEffect(() => {
    const initialId = new URLSearchParams(window.location.search).get("conversationId") ?? "";
    Promise.all([loadConversations(), loadCases()])
      .then(() => {
        if (initialId) setConversationId(initialId);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      return;
    }
    loadConversation(conversationId).catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load conversation"),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    try {
      let activeId = conversationId;
      if (!activeId) {
        const created = await fetch("/api/v1/professor/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: question.slice(0, 120), explanationLevel }),
        });
        const createdData = await created.json();
        if (!created.ok)
          throw new Error(createdData?.error?.message ?? "Failed to start conversation");
        activeId = createdData.conversation.id;
        setConversationId(activeId);
        await loadConversations();
      }

      const res = await fetch(`/api/v1/professor/conversations/${activeId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          explanationLevel,
          caseId: caseId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to get an answer");
      setQuestion("");
      await loadConversation(activeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ask Professor");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StudentShell>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Ask Professor"
        description="Answers are grounded in your uploaded case text and the shared legal authority corpus. Professor is a study aid, not a substitute for your course instruction."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="mb-4 grid gap-3 rounded-xl border border-line bg-white/80 p-4 md:grid-cols-3">
        <label className="text-sm font-semibold text-ink/80">
          Conversation
          <select
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
            value={conversationId}
            onChange={(e) => setConversationId(e.target.value)}
          >
            <option value="">New conversation</option>
            {conversations.map((conversation) => (
              <option key={conversation.id} value={conversation.id}>
                {conversation.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink/80">
          Explanation level
          <select
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
            value={explanationLevel}
            onChange={(e) => setExplanationLevel(e.target.value as ExplanationLevel)}
          >
            {LEVELS.map((level) => (
              <option key={level.value} value={level.value}>
                {level.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink/80">
          Focus on a case (optional)
          <select
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          >
            <option value="">All / no specific case</option>
            {cases.map((studentCase) => (
              <option key={studentCase.id} value={studentCase.id}>
                {studentCase.title}
                {studentCase.citation ? ` (${studentCase.citation})` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Panel title="Conversation">
        <div className="mb-4 max-h-[28rem] space-y-3 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-ink/70">Ask a question to start the conversation.</p>
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
                </p>
                <p className="whitespace-pre-wrap text-ink/90">{message.content}</p>
                {message.sources && message.sources.length > 0 ? (
                  <div className="mt-2 space-y-1 border-t border-line/60 pt-2">
                    {message.sources.map((source, index) => (
                      <div key={index} className="text-xs text-ink/60">
                        <Badge>{sourceLabel(source)}</Badge>
                        {source.quote ? (
                          <span className="ml-2 italic">&ldquo;{source.quote}&rdquo;</span>
                        ) : null}
                        {source.page ? <span className="ml-2">p.{source.page}</span> : null}
                        {source.opinionPart ? (
                          <span className="ml-2">({source.opinionPart})</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                {message.socraticFollowUp ? (
                  <p className="mt-2 rounded border border-accent/30 bg-accent-soft/40 px-2 py-1.5 text-xs text-ink/80">
                    <span className="font-semibold">Think about this: </span>
                    {message.socraticFollowUp}
                  </p>
                ) : null}
              </div>
            ))
          )}
        </div>
        <form className="flex gap-2" onSubmit={ask}>
          <input
            className="flex-1 rounded border border-line px-3 py-2 text-sm"
            placeholder="e.g. What standard does the majority apply to determine negligence?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? "Asking…" : "Ask"}
          </Button>
        </form>
      </Panel>
    </StudentShell>
  );
}
