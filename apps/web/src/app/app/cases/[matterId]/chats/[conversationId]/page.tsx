"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { AskStreamEvent, ProvenanceSummary, SourceScope } from "@nyayagrid/ai";
import { getSourceScopedAbstentionCopy } from "@nyayagrid/ai/source-scope";
import { Button } from "@nyayagrid/ui";
import {
  AskProgress,
  CaseChip,
  ChatComposer,
  EvidenceStateBadge,
  ErrorState,
  IntelligenceHeader,
  LoadingState,
  ProvenanceBadge,
  SourceDrawer,
  SourceMarker,
  type SourceDrawerItem,
} from "@/components/ux";
import { useMatterChrome } from "@/components/use-matter-chrome";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";
import { USER_FACING_ASK_ERROR } from "@/lib/user-facing-error";

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
  provenance?: ProvenanceSummary;
};

function sourcesFromAnswer(sources: any[] | undefined): SourceDrawerItem[] {
  return (sources ?? []).map((s: any, i: number) => {
    const category =
      s.category === "web" || String(s.documentId ?? "").startsWith("web:")
        ? "web"
        : s.category === "legal_authority"
          ? "legal_authority"
          : "case_evidence";
    return {
      id: s.chunkId || `s-${i}`,
      chunkId: s.chunkId || undefined,
      documentId: s.documentId || undefined,
      title: s.documentTitle || (category === "web" ? "Web source" : "Case document"),
      classLabel:
        category === "web"
          ? "Web"
          : category === "legal_authority"
            ? "Legal authority"
            : "Case evidence",
      category,
      subtitle: [s.page != null ? `Page ${s.page}` : null, s.segmentRef || s.paragraph || null]
        .filter(Boolean)
        .join(" · "),
      quote: s.quote,
      quoteVerified: Boolean(s.quote) && category === "case_evidence",
      url: s.url,
      retrievedAt: s.retrievedAt,
    };
  });
}

function sourcesFromCitations(citations: any[] | undefined, messageId: string): SourceDrawerItem[] {
  return (citations ?? []).map((c: any, i: number) => {
    const category =
      c.category === "web" || String(c.documentId ?? "").startsWith("web:")
        ? "web"
        : c.category === "legal_authority"
          ? "legal_authority"
          : "case_evidence";
    return {
      id: c.chunkId || `${messageId}-${i}`,
      chunkId: c.chunkId || undefined,
      documentId: c.documentId || undefined,
      title: category === "web" ? "Web source" : "Case document",
      classLabel:
        category === "web"
          ? "Web"
          : category === "legal_authority"
            ? "Legal authority"
            : "Case evidence",
      category,
      subtitle: [c.page != null ? `Page ${c.page}` : null, c.segmentRef || null]
        .filter(Boolean)
        .join(" · "),
      quote: c.quote,
      quoteVerified: Boolean(c.quote) && category === "case_evidence",
      url: c.url,
      retrievedAt: c.retrievedAt,
    };
  });
}

function streamSourceToDrawerItem(source: AskStreamEvent & { type: "source_added" }): SourceDrawerItem {
  const s = source.source;
  return {
    id: s.id,
    title: s.title,
    classLabel:
      s.category === "web"
        ? "Web"
        : s.category === "legal_authority"
          ? "Legal authority"
          : "Case evidence",
    category: s.category,
    subtitle: s.subtitle,
    quote: s.quote,
    chunkId: s.chunkId,
    documentId: s.documentId,
    url: s.url,
    retrievedAt: s.retrievedAt,
    href: s.url,
  };
}

async function consumeAskSse(
  res: Response,
  onEvent: (event: AskStreamEvent) => void,
): Promise<void> {
  if (!res.body) throw new Error(USER_FACING_ASK_ERROR);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const lines = part.split("\n");
      let dataLine = "";
      for (const line of lines) {
        if (line.startsWith("data: ")) dataLine = line.slice(6);
      }
      if (!dataLine) continue;
      try {
        onEvent(JSON.parse(dataLine) as AskStreamEvent);
      } catch {
        /* ignore malformed SSE chunks */
      }
    }
  }
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
  const [sourceScope, setSourceScope] = useState<SourceScope>("case");
  const [streamEvents, setStreamEvents] = useState<AskStreamEvent[]>([]);
  const [liveAnswer, setLiveAnswer] = useState("");
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversations, setConversations] = useState<
    Array<{ id: string; title: string | null; preview?: string | null }>
  >([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);
  const [drawerActiveId, setDrawerActiveId] = useState<string | undefined>();
  const threadRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hardAbortTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastQuestionRef = useRef("");

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
              provenance: validation.provenance as ProvenanceSummary | undefined,
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
    if (!item.chunkId || item.category === "web") return item;
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

  function clearHardAbortTimer() {
    if (hardAbortTimerRef.current) {
      clearTimeout(hardAbortTimerRef.current);
      hardAbortTimerRef.current = null;
    }
  }

  function stopGenerating() {
    // Soft-cancel: abort generation on the server without tearing down the SSE
    // socket, so generation_stopped + continue_available can still arrive.
    void fetch(`/api/v1/matters/${matterId}/ask/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId }),
    }).catch(() => {
      /* best-effort; fall back to hard abort below */
    });
    clearHardAbortTimer();
    // Hard abort remains a last-resort fallback if soft-cancel never lands.
    hardAbortTimerRef.current = setTimeout(() => {
      hardAbortTimerRef.current = null;
      abortRef.current?.abort();
    }, 8_000);
  }


  async function send(opts?: { continueToken?: string | null; questionOverride?: string }) {
    const q = (opts?.questionOverride ?? question).trim();
    if (!q && !opts?.continueToken) return;
    const text = q || lastQuestionRef.current;
    if (!text.trim()) return;

    setBusy(true);
    setError("");
    setStreamEvents([]);
    setLiveAnswer("");
    setContinueToken(null);
    lastQuestionRef.current = text;
    if (!opts?.continueToken) {
      setQuestion("");
      setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: text }]);
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const liveSources: SourceDrawerItem[] = [];
    let provenance: ProvenanceSummary | undefined;
    let finalAnswer = "";
    let artifactId: string | undefined;
    let evidenceState: string | undefined;
    let assumptions: string[] | undefined;
    let unresolvedQuestions: string[] | undefined;
    let needsMoreDocuments = false;
    let wasStopped = false;

    try {
      const res = await fetch(`/api/v1/matters/${matterId}/ask`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        signal: controller.signal,
        body: JSON.stringify({
          question: text,
          conversationId,
          mode: "ask",
          sourceScope,
          stream: true,
          ...(opts?.continueToken ? { continueToken: opts.continueToken } : {}),
        }),
      });

      const contentType = res.headers.get("content-type") ?? "";
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? USER_FACING_ASK_ERROR);
      }

      if (contentType.includes("text/event-stream")) {
        await consumeAskSse(res, (event) => {
          setStreamEvents((prev) => [...prev, event]);
          if (event.type === "text_delta") {
            setLiveAnswer((prev) => prev + event.text);
            finalAnswer += event.text;
          }
          if (event.type === "source_added") {
            const item = streamSourceToDrawerItem(event);
            liveSources.push(item);
            setDrawerItems([...liveSources]);
            setDrawerOpen(true);
          }
          if (event.type === "provenance_ready") {
            provenance = event.provenance;
          }
          if (event.type === "generation_completed") {
            finalAnswer = event.answer;
            artifactId = event.artifactId;
            provenance = event.provenance;
          }
          if (event.type === "continue_available") {
            clearHardAbortTimer();
            setContinueToken(event.continueToken);
          }
          if (event.type === "generation_stopped") {
            clearHardAbortTimer();
            wasStopped = true;
          }
          if (event.type === "generation_failed") {
            setError(event.message || USER_FACING_ASK_ERROR);
          }
        });
      } else {
        const data = await res.json();
        if (data.run || data.mode === "task") {
          router.push(`/app/cases/${matterId}/work`);
          return;
        }
        const qa = data.qa ?? data;
        const answer = qa.answer;
        finalAnswer = answer?.answer ?? "No answer returned.";
        evidenceState = answer?.evidenceState;
        assumptions = answer?.assumptions;
        unresolvedQuestions = answer?.unresolvedQuestions;
        artifactId = qa.artifact?.id;
        provenance = qa.provenance ?? qa.artifact?.validation?.provenance;
        needsMoreDocuments = Boolean(qa.needsMoreDocuments);
        liveSources.push(...sourcesFromAnswer(answer?.sources));
      }

      if (finalAnswer || liveSources.length || provenance || wasStopped) {
        setTurns((prev) => [
          ...prev,
          {
            id: artifactId ?? `a-${Date.now()}`,
            role: "assistant",
            content: finalAnswer || liveAnswer || "[Generation stopped]",
            evidenceState: wasStopped ? "insufficient" : evidenceState,
            sources: liveSources.length ? liveSources : undefined,
            assumptions,
            unresolvedQuestions,
            artifactId,
            needsMoreDocuments,
            provenance,
          },
        ]);
      }
      requestAnimationFrame(() => {
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch (err) {
      if (controller.signal.aborted) {
        setTurns((prev) => [
          ...prev,
          {
            id: `stopped-${Date.now()}`,
            role: "assistant",
            content: liveAnswer || "[Generation stopped]",
            sources: liveSources.length ? liveSources : undefined,
          },
        ]);
      } else {
        setError(err instanceof Error ? err.message : "Failed");
      }
    } finally {
      clearHardAbortTimer();
      abortRef.current = null;
      setBusy(false);
      setLiveAnswer("");
      setStreamEvents([]);
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
            {loading ? <LoadingState label="Loading conversation…" /> : null}
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
                {t.role === "assistant" && t.provenance ? (
                  <div className="mb-2">
                    <ProvenanceBadge provenance={t.provenance} />
                  </div>
                ) : null}
                <p className="whitespace-pre-wrap">{t.content}</p>
                {isInsufficient(t.evidenceState) ? (
                  <p className="mt-2 rounded border border-line bg-black/[0.02] px-3 py-2 text-xs text-ink/65">
                    {
                      getSourceScopedAbstentionCopy(t.provenance?.sourceScope ?? "case")
                        .clientInsufficientHint
                    }
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
            {busy ? (
              <div className="mr-4 space-y-2 rounded-lg border border-line bg-white px-4 py-3 text-sm shadow-sm">
                <AskProgress events={streamEvents} />
                {liveAnswer ? (
                  <p className="whitespace-pre-wrap text-ink/80">{liveAnswer}</p>
                ) : null}
              </div>
            ) : null}
            {continueToken && !busy ? (
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void send({ continueToken, questionOverride: lastQuestionRef.current })}
                >
                  Continue generating
                </Button>
              </div>
            ) : null}
          </div>
          <div className="sticky bottom-0 border-t border-line bg-white p-3">
            <ChatComposer
              value={question}
              onChange={setQuestion}
              onSubmit={() => void send()}
              busy={busy}
              placeholder="Ask Nyaya about this Case…"
              sourceScope={sourceScope}
              onSourceScopeChange={setSourceScope}
              stopSlot={
                busy ? (
                  <Button type="button" variant="ghost" onClick={stopGenerating}>
                    Stop generating
                  </Button>
                ) : null
              }
            />
          </div>
        </div>
      </div>
      <SourceDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={drawerItems}
        activeId={drawerActiveId}
        title="Sources"
      />
    </div>
  );
}
