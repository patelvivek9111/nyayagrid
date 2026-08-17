"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PublicShell } from "@/components/shell";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

const HIGH_STAKES_GUIDANCE =
  "This may be a time-sensitive or high-risk situation. Consider contacting a qualified lawyer or the appropriate emergency service promptly — this information cannot assess the urgency of your specific situation.";

type GuideMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  sources?: Array<{
    provenance: "user_provided" | "document_extracted" | "legal_authority" | "guide_explanation";
    quote?: string | null;
    note?: string;
  }>;
  cautionLevel?: "standard" | "elevated";
  createdAt: string;
};

type ConversationRow = {
  id: string;
  title: string;
  jurisdiction: string | null;
  updatedAt: string;
};

type DocumentRow = { id: string; title: string };
type SituationRow = { id: string; title: string };

function sourceLabel(provenance: string): string {
  if (provenance === "legal_authority") return "Legal authority";
  if (provenance === "document_extracted") return "Your document";
  if (provenance === "user_provided") return "What you shared";
  return "General information";
}

export default function GuideHomePage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [situations, setSituations] = useState<SituationRow[]>([]);
  const [conversationId, setConversationId] = useState<string>("");
  const [documentId, setDocumentId] = useState<string>("");
  const [situationId, setSituationId] = useState<string>("");
  const [messages, setMessages] = useState<GuideMessage[]>([]);
  const [jurisdiction, setJurisdiction] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastDisclaimer, setLastDisclaimer] = useState<string | null>(null);
  const [lastCaveat, setLastCaveat] = useState<string | null>(null);
  const [lastHighStakes, setLastHighStakes] = useState(false);

  async function loadConversations() {
    const res = await fetch("/api/v1/guide/conversations");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load conversations");
    setConversations(data.conversations ?? []);
  }

  async function loadConversation(id: string) {
    const res = await fetch(`/api/v1/guide/conversations/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load conversation");
    setMessages(data.messages ?? []);
    setJurisdiction(data.conversation?.jurisdiction ?? "");
  }

  useEffect(() => {
    loadConversations().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load"),
    );
    fetch("/api/v1/guide/documents")
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setDocuments(data.documents ?? []);
      })
      .catch(() => undefined);
    fetch("/api/v1/guide/situations")
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setSituations(data.situations ?? []);
      })
      .catch(() => undefined);

    const fromQuery = new URLSearchParams(window.location.search).get("c");
    if (fromQuery) {
      setConversationId(fromQuery);
      loadConversation(fromQuery).catch((err) =>
        setError(err instanceof Error ? err.message : "Failed to load conversation"),
      );
    }
  }, []);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/guide/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          jurisdiction: jurisdiction || undefined,
          conversationId: conversationId || undefined,
          documentId: documentId || undefined,
          situationId: situationId || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to get an answer");
      setConversationId(data.conversationId);
      setLastDisclaimer(data.disclaimer ?? null);
      setLastCaveat(data.jurisdictionCaveat ?? null);
      setLastHighStakes(Boolean(data.highStakes));
      setQuestion("");
      await Promise.all([loadConversations(), loadConversation(data.conversationId)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to ask Guide");
    } finally {
      setBusy(false);
    }
  }

  const showHighStakes =
    lastHighStakes || messages.some((message) => message.cautionLevel === "elevated");

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Nyaya Guide"
        title="Ask a legal question"
        description="General legal information grounded in your own documents and a shared legal authority corpus — not legal advice."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      {showHighStakes ? (
        <div
          role="alert"
          className="mb-4 rounded-xl border border-[var(--ng-danger)] bg-[var(--ng-danger)]/10 px-4 py-3 text-sm text-ink"
        >
          <p className="font-semibold">Time-sensitive or high-risk situation</p>
          <p className="mt-1">{HIGH_STAKES_GUIDANCE}</p>
        </div>
      ) : null}

      {!jurisdiction.trim() ? (
        <div className="mb-4 rounded-xl border border-accent/40 bg-accent-soft/40 px-4 py-3 text-sm">
          <p className="font-semibold">Jurisdiction is not set</p>
          <p className="mt-1 text-ink/80">
            Laws vary by country, state, and locality. Enter a jurisdiction before asking a
            jurisdiction-dependent question. If you leave it blank, Guide will not assume any
            specific jurisdiction.
          </p>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 rounded-xl border border-line bg-white/80 p-4 md:grid-cols-2">
        <label className="text-sm font-semibold text-ink/80">
          Conversation
          <select
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
            value={conversationId}
            onChange={(e) => {
              setConversationId(e.target.value);
              if (e.target.value) loadConversation(e.target.value).catch(() => undefined);
              else setMessages([]);
            }}
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
          Jurisdiction (country / state / province)
          <input
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
            placeholder="e.g. Ontario, Canada"
            value={jurisdiction}
            onChange={(e) => setJurisdiction(e.target.value)}
          />
        </label>
        <label className="text-sm font-semibold text-ink/80">
          Optional document
          <select
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
            value={documentId}
            onChange={(e) => setDocumentId(e.target.value)}
          >
            <option value="">None</option>
            {documents.map((document) => (
              <option key={document.id} value={document.id}>
                {document.title}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-semibold text-ink/80">
          Optional situation
          <select
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm"
            value={situationId}
            onChange={(e) => setSituationId(e.target.value)}
          >
            <option value="">None</option>
            {situations.map((situation) => (
              <option key={situation.id} value={situation.id}>
                {situation.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Panel title="Conversation">
        <div className="mb-4 max-h-[28rem] space-y-3 overflow-y-auto">
          {messages.length === 0 ? (
            <p className="text-sm text-ink/70">Ask a question to get started.</p>
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
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">
                    {message.role === "user" ? "You" : "Guide"}
                  </p>
                  {message.cautionLevel === "elevated" ? (
                    <Badge>Time-sensitive — consider a lawyer</Badge>
                  ) : null}
                </div>
                <p className="whitespace-pre-wrap text-ink/90">{message.content}</p>
                {message.sources && message.sources.length > 0 ? (
                  <div className="mt-2 space-y-1 border-t border-line/60 pt-2">
                    {message.sources.map((source, index) => (
                      <div key={index} className="text-xs text-ink/60">
                        <Badge>{sourceLabel(source.provenance)}</Badge>
                        {source.quote ? (
                          <span className="ml-2 italic">&ldquo;{source.quote}&rdquo;</span>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
        {lastCaveat ? (
          <p className="mb-2 text-sm text-ink/70" data-testid="jurisdiction-caveat">
            {lastCaveat}
          </p>
        ) : null}
        {lastDisclaimer ? <p className="mb-3 text-xs text-ink/50">{lastDisclaimer}</p> : null}
        <form className="flex gap-2" onSubmit={ask}>
          <input
            className="flex-1 rounded border border-line px-3 py-2 text-sm"
            placeholder="e.g. My landlord gave me a notice to vacate — what does that mean?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <Button type="submit" disabled={busy || !question.trim()}>
            {busy ? "Asking…" : "Ask"}
          </Button>
        </form>
      </Panel>
    </PublicShell>
  );
}
