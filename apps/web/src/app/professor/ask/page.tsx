"use client";

import { useEffect, useState, type FormEvent } from "react";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import {
  ProfessorSources,
  type ProfessorSourceRef,
} from "@/components/professor/professor-sources";
import { loadProfessorSettings } from "@/lib/professor-settings";
import { NO_STUDENT_SOURCES_ANSWER } from "@/lib/professor-copy";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type ExplanationLevel = "simple" | "standard" | "advanced";

type ConversationRow = {
  id: string;
  title: string;
  explanationLevel: ExplanationLevel;
  updatedAt: string;
};

type CaseRow = { id: string; title: string; citation: string | null };

type StudentMessageRow = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  explanationLevel?: ExplanationLevel | null;
  sources?: ProfessorSourceRef[];
  socraticFollowUp?: string | null;
  createdAt: string;
};

const LEVELS: { value: ExplanationLevel; label: string }[] = [
  { value: "simple", label: "Simple" },
  { value: "standard", label: "Standard" },
  { value: "advanced", label: "Advanced" },
];

const STARTERS = [
  { label: "Explain simply", text: "Explain this in simple terms." },
  { label: "Why the court ruled", text: "Why did the court rule this way?" },
  { label: "Most important fact", text: "What is the most important fact in this case?" },
  { label: "Hypothetical", text: "What if a key fact in this case were different?" },
  { label: "Compare with another case", text: "How does this compare with another case in my library?" },
];

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
  const [savedMessage, setSavedMessage] = useState("");

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
    setExplanationLevel(data.conversation?.explanationLevel ?? explanationLevel);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialId = params.get("conversationId") ?? "";
    const initialQ = params.get("q") ?? "";
    const settings = loadProfessorSettings();
    setExplanationLevel(settings.explanationLevel);
    if (initialQ) setQuestion(initialQ);
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

  async function ask(event?: FormEvent, override?: string) {
    event?.preventDefault();
    const text = (override ?? question).trim();
    if (!text) return;
    setBusy(true);
    setError("");
    setSavedMessage("");
    try {
      let activeId = conversationId;
      if (!activeId) {
        const created = await fetch("/api/v1/professor/conversations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: text.slice(0, 120),
            explanationLevel,
            caseId: caseId || undefined,
          }),
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
          question: text,
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

  async function saveConversation() {
    if (!conversationId) return;
    const title =
      conversations.find((row) => row.id === conversationId)?.title ?? "Saved conversation";
    setBusy(true);
    try {
      const res = await fetch("/api/v1/professor/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemType: "explanation",
          title,
          content: messages.at(-1)?.content ?? title,
          ref: { conversationId },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to save");
      setSavedMessage("Conversation saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Ask Professor"
        description="Answers are grounded in your uploaded case text and the shared legal authority corpus. Professor is a study aid, not a substitute for your course instruction."
      />
      <div className="mb-4">
        <StudyAidNotice />
      </div>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {savedMessage ? <p className="mb-4 text-sm text-accent">{savedMessage}</p> : null}

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

      <div className="mb-4 flex flex-wrap gap-2">
        {STARTERS.map((starter) => (
          <button
            key={starter.label}
            type="button"
            className="rounded-full border border-line bg-white px-3 py-1 text-xs text-ink/80 hover:border-accent hover:text-accent"
            onClick={() => setQuestion(starter.text)}
          >
            {starter.label}
          </button>
        ))}
      </div>

      <Panel title="Conversation">
        {conversationId ? (
          <div className="mb-3">
            <Button type="button" variant="secondary" disabled={busy} onClick={saveConversation}>
              Save conversation
            </Button>
          </div>
        ) : null}
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
                  {message.explanationLevel ? ` · ${message.explanationLevel}` : ""}
                </p>
                <p className="whitespace-pre-wrap text-ink/90">{message.content}</p>
                {message.content === NO_STUDENT_SOURCES_ANSWER ? (
                  <p className="mt-1 text-xs text-ink/50">No surviving sources for this answer.</p>
                ) : null}
                {message.sources ? <ProfessorSources sources={message.sources} /> : null}
                {message.socraticFollowUp ? (
                  <button
                    type="button"
                    className="mt-2 w-full rounded border border-accent/30 bg-accent-soft/40 px-2 py-1.5 text-left text-xs text-ink/80"
                    onClick={() => {
                      setQuestion(message.socraticFollowUp ?? "");
                    }}
                  >
                    <span className="font-semibold">Think about this: </span>
                    {message.socraticFollowUp}
                  </button>
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
            Ask
          </Button>
        </form>
      </Panel>
    </>
  );
}
