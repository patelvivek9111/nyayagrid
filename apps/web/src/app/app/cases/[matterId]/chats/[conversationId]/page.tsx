"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@nyayagrid/ui";
import {
  CaseChip,
  ChatComposer,
  EvidenceStateBadge,
  ErrorState,
  IntelligenceHeader,
  LoadingState,
  SourceDrawer,
  SourceMarker,
  type SourceDrawerItem,
} from "@/components/ux";
import { useMatterChrome } from "@/components/use-matter-chrome";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";

type ChatTurn = {
  id: string;
  role: string;
  content: string;
  sources?: SourceDrawerItem[];
  evidenceState?: string;
  assumptions?: string[];
  unresolvedQuestions?: string[];
  artifactId?: string;
  needsMoreDocuments?: boolean;
};

function sourcesFromAnswer(sources: any[] | undefined): SourceDrawerItem[] {
  return (sources ?? []).map((s: any, i: number) => ({
    id: s.chunkId || `s-${i}`,
    chunkId: s.chunkId || undefined,
    documentId: s.documentId || undefined,
    title: s.documentTitle || "Case document",
    classLabel: "Matter Evidence",
    subtitle: [s.page != null ? `Page ${s.page}` : null, s.segmentRef || s.paragraph || null]
      .filter(Boolean)
      .join(" · "),
    quote: s.quote,
    quoteVerified: Boolean(s.quote),
  }));
}

function sourcesFromCitations(citations: any[] | undefined, messageId: string): SourceDrawerItem[] {
  return (citations ?? []).map((c: any, i: number) => ({
    id: c.chunkId || `${messageId}-${i}`,
    chunkId: c.chunkId || undefined,
    documentId: c.documentId || undefined,
    title: "Case document",
    classLabel: "Matter Evidence",
    subtitle: [c.page != null ? `Page ${c.page}` : null, c.segmentRef || null]
      .filter(Boolean)
      .join(" · "),
    quote: c.quote,
    quoteVerified: Boolean(c.quote),
  }));
}

export default function CaseChatThreadPage() {
  const params = useParams<{ matterId: string; conversationId: string }>();
  const { matterId, conversationId } = params;
  const router = useRouter();
  const { title: caseTitle } = useMatterChrome();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [title, setTitle] = useState("Chat");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversations, setConversations] = useState<
    Array<{ id: string; title: string | null; preview?: string | null }>
  >([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);
  const [drawerActiveId, setDrawerActiveId] = useState<string | undefined>();
  const threadRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/matters/${matterId}/conversations/${conversationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(userFacingLoadError("chats", res.status));
        setTitle(data.conversation?.title ?? "Chat");
        const artifactsByMsg = new Map<string, any>();
        for (const a of data.artifacts ?? []) {
          if (a.messageId) artifactsByMsg.set(a.messageId, a);
        }
        setTurns(
          (data.messages ?? []).map((m: any) => {
            const art = artifactsByMsg.get(m.id);
            const validation = (art?.validation ?? {}) as Record<string, unknown>;
            const sources = sourcesFromCitations(art?.citations, m.id);
            return {
              id: m.id,
              role: m.role,
              content: m.content,
              evidenceState: art?.evidenceState,
              sources: sources.length ? sources : undefined,
              assumptions: Array.isArray(validation.assumptions)
                ? (validation.assumptions as string[])
                : undefined,
              unresolvedQuestions: Array.isArray(validation.unresolvedQuestions)
                ? (validation.unresolvedQuestions as string[])
                : undefined,
              artifactId: art?.id,
              needsMoreDocuments: Boolean(validation.needsMoreDocuments),
            } satisfies ChatTurn;
          }),
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : userFacingLoadError("chats")))
      .finally(() => setLoading(false));
    fetch(`/api/v1/matters/${matterId}/conversations?limit=20`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setConversations(data.conversations ?? []);
      })
      .catch(() => undefined);
  }, [matterId, conversationId]);

  async function enrichSource(item: SourceDrawerItem) {
    if (!item.chunkId) return item;
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/citations/${item.chunkId}`);
      const data = await res.json();
      if (!res.ok) return item;
      return {
        ...item,
        title: data.document?.title ?? item.title,
        subtitle: [
          data.chunk?.pageStart != null ? `Page ${data.chunk.pageStart}` : item.subtitle,
          data.chunk?.segmentRef,
        ]
          .filter(Boolean)
          .join(" · "),
        quote: item.quote || data.chunk?.content,
        quoteVerified: true,
        documentId: data.document?.id ?? data.chunk?.documentId ?? item.documentId,
      };
    } catch {
      return item;
    }
  }

  async function openSources(items: SourceDrawerItem[], activeId?: string) {
    setDrawerOpen(true);
    setDrawerActiveId(activeId);
    setDrawerItems(items);
    const enriched = await Promise.all(items.map(enrichSource));
    setDrawerItems(enriched);
  }

  async function send() {
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    const q = question.trim();
    setQuestion("");
    setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: q }]);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, conversationId, mode: "ask" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Ask failed");
      if (data.run || data.mode === "task") {
        router.push(`/app/cases/${matterId}/work`);
        return;
      }
      const qa = data.qa ?? data;
      const answer = qa.answer;
      const sources = sourcesFromAnswer(answer?.sources);
      const validation = (qa.artifact?.validation ?? {}) as Record<string, unknown>;
      setTurns((prev) => [
        ...prev,
        {
          id: qa.artifact?.id ?? `a-${Date.now()}`,
          role: "assistant",
          content: answer?.answer ?? "No answer returned.",
          evidenceState: answer?.evidenceState,
          sources: sources.length ? sources : undefined,
          assumptions: answer?.assumptions,
          unresolvedQuestions: answer?.unresolvedQuestions,
          artifactId: qa.artifact?.id,
          needsMoreDocuments: Boolean(qa.needsMoreDocuments ?? validation.needsMoreDocuments),
        },
      ]);
      requestAnimationFrame(() => {
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  const isInsufficient = (state?: string) =>
    state === "insufficient" || state === "insufficient_evidence";

  return (
    <div className="space-y-3">
      <IntelligenceHeader
        title="Case Chats"
        description="Conversations stay tied to this Case. Nyaya's answers are drafts, not legal advice."
        actions={
          <Link href={`/app/cases/${matterId}/chats`}>
            <Button type="button" variant="ghost">
              All Case chats
            </Button>
          </Link>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <div className="grid min-h-[28rem] gap-3 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside className="hidden overflow-hidden rounded-xl border border-line bg-white/80 lg:block">
          <p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            Conversations
          </p>
          <ul>
            {conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/app/cases/${matterId}/chats/${c.id}`}
                  className={`block border-b border-line px-3 py-2.5 text-sm last:border-b-0 ${
                    c.id === conversationId
                      ? "bg-accent-soft/40 font-semibold"
                      : "hover:bg-black/[0.02]"
                  }`}
                >
                  <span className="block truncate">{c.title || "Untitled chat"}</span>
                  {c.preview ? (
                    <span className="block truncate text-xs font-normal text-ink/50">
                      {c.preview}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </aside>
        <div className="flex min-h-[28rem] flex-col rounded-xl border border-line bg-white">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
            <CaseChip label={caseTitle} />
            <span className="text-sm font-semibold text-ink">{title}</span>
          </div>
          <div ref={threadRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {loading ? <LoadingState /> : null}
            {!loading && turns.length === 0 ? (
              <p className="text-sm text-ink/55">Start a conversation about this case.</p>
            ) : null}
            {turns.map((t) => (
              <div
                key={t.id}
                className={
                  t.role === "user"
                    ? "ml-8 rounded-lg bg-accent-soft/40 px-4 py-3 text-sm"
                    : "mr-4 rounded-lg border border-line bg-white px-4 py-3 text-sm shadow-sm"
                }
              >
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                  {t.role === "user" ? "You" : "Nyaya"}
                </p>
                {t.role === "assistant" && t.evidenceState ? (
                  <div className="mb-2">
                    <EvidenceStateBadge state={t.evidenceState} />
                  </div>
                ) : null}
                <p className="whitespace-pre-wrap">{t.content}</p>
                {isInsufficient(t.evidenceState) ? (
                  <p className="mt-2 rounded border border-line bg-black/[0.02] px-3 py-2 text-xs text-ink/65">
                    I couldn&apos;t find enough verified evidence in this Case to answer that
                    confidently. Upload or point me at relevant documents, then ask again.
                  </p>
                ) : null}
                {t.needsMoreDocuments ? (
                  <p className="mt-2 rounded border border-amber-700/25 bg-amber-50/70 px-3 py-2 text-xs text-ink/75">
                    <span className="font-semibold">Need more documents.</span> This answer may be
                    incomplete without additional Case files.{" "}
                    <Link
                      href={`/app/cases/${matterId}/documents`}
                      className="font-semibold text-accent underline"
                    >
                      Open Documents
                    </Link>
                  </p>
                ) : null}
                {t.assumptions && t.assumptions.length > 0 ? (
                  <div className="mt-2 rounded border border-line px-3 py-2 text-xs text-ink/70">
                    <p className="font-semibold uppercase tracking-wide text-ink/45">Assumptions</p>
                    <ul className="mt-1 list-inside list-disc">
                      {t.assumptions.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {t.unresolvedQuestions && t.unresolvedQuestions.length > 0 ? (
                  <div className="mt-2 rounded border border-amber-700/20 bg-amber-50/50 px-3 py-2 text-xs text-ink/70">
                    <p className="font-semibold uppercase tracking-wide text-amber-800/80">
                      Unresolved
                    </p>
                    <ul className="mt-1 list-inside list-disc">
                      {t.unresolvedQuestions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {t.sources?.length ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/45">
                      Sources
                    </span>
                    {t.sources.map((src, i) => (
                      <SourceMarker
                        key={`${t.id}-${i}`}
                        index={i + 1}
                        onClick={() => openSources(t.sources ?? [], src.id)}
                      />
                    ))}
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent underline"
                      onClick={() => openSources(t.sources ?? [], t.sources?.[0]?.id)}
                    >
                      View source
                    </button>
                    <Link
                      href={`/app/cases/${matterId}/evidence`}
                      className="text-xs font-semibold text-accent underline"
                    >
                      View evidence
                    </Link>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          <div className="sticky bottom-0 border-t border-line bg-white p-3">
            <ChatComposer
              value={question}
              onChange={setQuestion}
              onSubmit={send}
              busy={busy}
              placeholder="Ask Nyaya about this Case…"
            />
          </div>
        </div>
      </div>
      <SourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={drawerItems}
        activeId={drawerActiveId}
        title="Case sources"
      />
    </div>
  );
}
