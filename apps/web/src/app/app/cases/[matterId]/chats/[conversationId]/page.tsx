"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import type { AskStreamEvent, AskUxPayload, ProvenanceSummary, SourceScope } from "@nyayagrid/ai";
import { getSourceScopedAbstentionCopy } from "@nyayagrid/ai/source-scope";
import { Button } from "@nyayagrid/ui";
import {
  ActionConfirmationCard,
  AmbiguityChooser,
  AskProgress,
  CancelledTurnBanner,
  CaseChip,
  ChatComposer,
  EvidenceStateBadge,
  ErrorState,
  FactualityAssertionBadges,
  IntelligenceHeader,
  LoadingState,
  NavigationActionLink,
  ProvenanceBadge,
  SourceDrawer,
  SourceMarker,
  type CommandCenterActionUx,
  type SourceDrawerItem,
} from "@/components/ux";
import { useMatterChrome } from "@/components/use-matter-chrome";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";
import { GUEST_COMMAND_CENTER_MESSAGE } from "@/lib/command-center-guest-policy";
import { filterRenderableMatterSources } from "@/lib/command-center-ux";
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
  factualityTypes?: string[];
  cancelled?: boolean;
  ux?: AskUxPayload;
};

function sourcesFromAnswer(sources: any[] | undefined): SourceDrawerItem[] {
  return (sources ?? []).map((s: any, i: number) => {
    const category =
      s.category === "web" || String(s.documentId ?? "").startsWith("web:")
        ? "web"
        : s.category === "legal_authority"
          ? "legal_authority"
          : "case_evidence";
    const legalTitle =
      category === "legal_authority"
        ? s.documentTitle || s.title || s.citation || s.normalizedCitation || "Legal authority"
        : null;
    return {
      id: s.chunkId || `s-${i}`,
      chunkId: s.chunkId || undefined,
      documentId: s.documentId || undefined,
      title:
        legalTitle ||
        s.documentTitle ||
        (category === "web" ? "Web source" : "Case document"),
      classLabel:
        category === "web"
          ? "Web"
          : category === "legal_authority"
            ? "Legal authority"
            : "Case evidence",
      category,
      subtitle: [
        category === "legal_authority"
          ? [s.court, s.jurisdiction, s.sourceProvider].filter(Boolean).join(" · ") || null
          : null,
        s.page != null ? `Page ${s.page}` : null,
        s.segmentRef || s.paragraph || null,
      ]
        .filter(Boolean)
        .join(" · "),
      quote: s.quote,
      quoteVerified: Boolean(s.quote) && category === "case_evidence",
      url: s.url || s.canonicalSourceUrl,
      href: s.url || s.canonicalSourceUrl,
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
    const legalTitle =
      category === "legal_authority"
        ? c.title || c.citation || c.normalizedCitation || "Legal authority"
        : null;
    return {
      id: c.chunkId || `${messageId}-${i}`,
      chunkId: c.chunkId || undefined,
      documentId: c.documentId || undefined,
      title:
        legalTitle ||
        (category === "web" ? "Web source" : "Case document"),
      classLabel:
        category === "web"
          ? "Web"
          : category === "legal_authority"
            ? "Legal authority"
            : "Case evidence",
      category,
      subtitle: [
        category === "legal_authority"
          ? [c.court, c.jurisdiction, c.sourceProvider].filter(Boolean).join(" · ") || null
          : null,
        c.page != null ? `Page ${c.page}` : null,
        c.segmentRef || null,
      ]
        .filter(Boolean)
        .join(" · "),
      quote: c.quote,
      quoteVerified: Boolean(c.quote) && category === "case_evidence",
      url: c.url || c.canonicalSourceUrl,
      href: c.url || c.canonicalSourceUrl,
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
  const cancelRequestedRef = useRef(false);
  const busyRef = useRef(false);
  const loadGenRef = useRef(0);
  const lastQuestionRef = useRef("");

  useEffect(() => {
    const loadGen = ++loadGenRef.current;
    setLoading(true);
    fetch(`/api/v1/matters/${matterId}/conversations/${conversationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          if (data?.error?.code === "DENY_GUEST_ASK") {
            throw new Error(data?.error?.message ?? GUEST_COMMAND_CENTER_MESSAGE);
          }
          throw new Error(userFacingLoadError("chats", res.status));
        }
        // Stale or in-flight Ask: never clobber live turns with a late empty/partial load.
        if (loadGen !== loadGenRef.current || busyRef.current) {
          return;
        }
        setTitle(data.conversation?.title ?? "Chat");
        const artifactsByMsg = new Map<string, any>();
        for (const a of data.artifacts ?? []) {
          if (a.messageId) artifactsByMsg.set(a.messageId, a);
        }
        setTurns(
          (data.messages ?? []).map((m: any) => {
            const art = artifactsByMsg.get(m.id);
            const validation = (art?.validation ?? {}) as Record<string, unknown>;
            const sources = filterRenderableMatterSources(
              sourcesFromCitations(art?.citations, m.id),
              { matterId },
            );
            const rawAction = (validation.conversationalAction ?? null) as Record<
              string,
              unknown
            > | null;
            const previewPayload =
              rawAction?.previewPayload && typeof rawAction.previewPayload === "object"
                ? (rawAction.previewPayload as Record<string, unknown>)
                : {};
            const action: CommandCenterActionUx | undefined =
              rawAction && typeof rawAction.pendingActionId === "string"
                ? {
                    pendingActionId: rawAction.pendingActionId,
                    actionType: String(rawAction.actionType ?? ""),
                    actionClass: String(rawAction.actionClass ?? ""),
                    actionStatus: String(rawAction.actionStatus ?? ""),
                    workflowStatus:
                      typeof rawAction.workflowStatus === "string"
                        ? rawAction.workflowStatus
                        : undefined,
                    confirmationRequired: Boolean(rawAction.confirmationRequired),
                    summary:
                      typeof previewPayload.previewText === "string"
                        ? previewPayload.previewText
                        : typeof previewPayload.title === "string"
                          ? previewPayload.title
                          : undefined,
                    targetLabel:
                      typeof previewPayload.label === "string"
                        ? previewPayload.label
                        : typeof previewPayload.title === "string"
                          ? previewPayload.title
                          : undefined,
                    sourceCount: Array.isArray(rawAction.sourceRefs)
                      ? rawAction.sourceRefs.length
                      : undefined,
                    failureReason:
                      typeof rawAction.failureReason === "string"
                        ? rawAction.failureReason
                        : null,
                    draftRoute: `/app/cases/${matterId}/draft`,
                  }
                : undefined;
            const referent = validation.referentResolution as
              | {
                  status?: string;
                  clarificationPrompt?: string;
                  candidates?: Array<{ label: string; entityType: string }>;
                }
              | undefined;
            const completionStatus = String(validation.completionStatus ?? "");
            const factualityTypes = (() => {
              const contract = validation.factualityContract as
                | { assertions?: Array<{ type?: string }> }
                | undefined;
              const types = (contract?.assertions ?? [])
                .map((a) => a.type)
                .filter((t): t is string => typeof t === "string" && t.length > 0);
              return types.length ? [...new Set(types)] : undefined;
            })();
            const ux: AskUxPayload | undefined = (() => {
              if (referent?.status === "AMBIGUOUS" && referent.candidates?.length) {
                return {
                  turnKind: "ambiguity",
                  ambiguity: {
                    prompt: referent.clarificationPrompt ?? "Which one do you mean?",
                    choices: referent.candidates.map((c) => ({
                      label: c.label,
                      entityType: c.entityType,
                    })),
                  },
                  factualityTypes,
                };
              }
              if (action?.pendingActionId) {
                return {
                  turnKind:
                    action.actionStatus === "COMPLETED" ? "action_result" : "action_preview",
                  action,
                  factualityTypes,
                  navigation:
                    action.actionClass === "NAVIGATION" &&
                    typeof previewPayload.route === "string"
                      ? {
                          kind: String(previewPayload.kind ?? "NAVIGATE"),
                          route: previewPayload.route,
                          label: String(previewPayload.label ?? "item"),
                        }
                      : undefined,
                };
              }
              if (factualityTypes?.length) return { turnKind: "answer", factualityTypes };
              return undefined;
            })();
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
              factualityTypes,
              cancelled:
                completionStatus === "cancelled" ||
                action?.actionStatus === "CANCELLED" ||
                /\[Generation stopped\]/i.test(String(m.content ?? "")),
              ux,
            } satisfies ChatTurn;
          }),
        );
      })
      .catch((err) => {
        if (loadGen !== loadGenRef.current) return;
        setError(err instanceof Error ? err.message : userFacingLoadError("chats"));
      })
      .finally(() => {
        if (loadGen === loadGenRef.current) setLoading(false);
      });
    fetch(`/api/v1/matters/${matterId}/conversations?limit=20`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok && loadGen === loadGenRef.current) setConversations(data.conversations ?? []);
      })
      .catch(() => undefined);
    return () => {
      loadGenRef.current += 1;
    };
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
    // Optimistic cancel: race-safe when mock/fast Ask completes before soft-cancel lands.
    cancelRequestedRef.current = true;
    setStreamEvents((prev) => [
      ...prev,
      {
        type: "generation_stopped",
        status: "cancelled",
        at: new Date().toISOString(),
      },
    ]);
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
    // Hard abort quickly so a completed stream cannot paint COMPLETED after Stop.
    hardAbortTimerRef.current = setTimeout(() => {
      hardAbortTimerRef.current = null;
      abortRef.current?.abort();
      // Guarantee composer unlock even if the fetch promise never settles.
      busyRef.current = false;
      setBusy(false);
    }, 500);
  }


  async function send(opts?: {
    continueToken?: string | null;
    questionOverride?: string;
    /** Retry after failure — same conversation, do not duplicate the user turn. */
    skipUserTurn?: boolean;
  }) {
    const q = (opts?.questionOverride ?? question).trim();
    if (!q && !opts?.continueToken) return;
    const text = q || lastQuestionRef.current;
    if (!text.trim()) return;

    setBusy(true);
    busyRef.current = true;
    setError("");
    setStreamEvents([]);
    setLiveAnswer("");
    setContinueToken(null);
    cancelRequestedRef.current = false;
    lastQuestionRef.current = text;
    if (!opts?.continueToken && !opts?.skipUserTurn) {
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
    let uxPayload: AskUxPayload | undefined;
    let factualityTypes: string[] | undefined;

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
        if (data?.error?.code === "DENY_GUEST_ASK") {
          throw new Error(data?.error?.message ?? GUEST_COMMAND_CENTER_MESSAGE);
        }
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
            const safe = filterRenderableMatterSources(liveSources, { matterId });
            setDrawerItems(safe);
            setDrawerOpen(true);
          }
          if (event.type === "provenance_ready") {
            provenance = event.provenance;
          }
          if (event.type === "generation_completed") {
            finalAnswer = event.answer;
            artifactId = event.artifactId;
            provenance = event.provenance;
            uxPayload = event.ux;
            factualityTypes = event.ux?.factualityTypes;
          }
          if (event.type === "continue_available") {
            clearHardAbortTimer();
            setContinueToken(event.continueToken);
          }
          if (event.type === "generation_stopped") {
            clearHardAbortTimer();
            wasStopped = true;
            cancelRequestedRef.current = true;
            // Unblock the SSE reader — soft-cancel alone can leave the stream open
            // and stick the composer in busy/disabled.
            queueMicrotask(() => abortRef.current?.abort());
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
        liveSources.push(
          ...filterRenderableMatterSources(sourcesFromAnswer(answer?.sources), { matterId }),
        );
      }

      const safeSources = filterRenderableMatterSources(liveSources, { matterId });
      const cancelled = wasStopped || cancelRequestedRef.current;
      if (finalAnswer || safeSources.length || provenance || cancelled) {
        setTurns((prev) => [
          ...prev,
          {
            id: artifactId ?? `a-${Date.now()}`,
            role: "assistant",
            content: cancelled
              ? finalAnswer || liveAnswer || "[Generation stopped]"
              : finalAnswer || liveAnswer || "[Generation stopped]",
            evidenceState: cancelled ? "insufficient" : evidenceState,
            sources: cancelled ? undefined : safeSources.length ? safeSources : undefined,
            assumptions: cancelled ? undefined : assumptions,
            unresolvedQuestions: cancelled ? undefined : unresolvedQuestions,
            artifactId: cancelled ? undefined : artifactId,
            needsMoreDocuments: cancelled ? false : needsMoreDocuments,
            provenance: cancelled ? undefined : provenance,
            factualityTypes: cancelled ? undefined : factualityTypes,
            cancelled,
            ux: cancelled ? { turnKind: "cancelled", factualityTypes } : uxPayload,
          },
        ]);
      }
      requestAnimationFrame(() => {
        threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
      });
    } catch (err) {
      if (controller.signal.aborted || cancelRequestedRef.current || wasStopped) {
        // Avoid duplicate cancelled turns when soft-cancel already finalized in try.
        setTurns((prev) => {
          if (prev.some((t) => t.role === "assistant" && t.cancelled && t.content)) {
            return prev;
          }
          return [
            ...prev,
            {
              id: `stopped-${Date.now()}`,
              role: "assistant",
              content: liveAnswer || "[Generation stopped]",
              sources: liveSources.length
                ? filterRenderableMatterSources(liveSources, { matterId })
                : undefined,
              cancelled: true,
              ux: { turnKind: "cancelled" },
            },
          ];
        });
      } else {
        setError(err instanceof Error ? err.message : "Failed");
      }
    } finally {
      clearHardAbortTimer();
      abortRef.current = null;
      busyRef.current = false;
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
        title="Nyaya Command Center"
        description="Multi-turn matter conversation. Answers are drafts grounded in this case record — not legal advice."
        actions={
          <Link href={`/app/cases/${matterId}/chats`}>
            <Button type="button" variant="ghost">
              All Case chats
            </Button>
          </Link>
        }
      />
      {error ? (
        <ErrorState
          message={error}
          onRetry={
            lastQuestionRef.current
              ? () => {
                  setError("");
                  void send({
                    questionOverride: lastQuestionRef.current,
                    skipUserTurn: true,
                  });
                }
              : undefined
          }
        />
      ) : null}
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
                {t.role === "assistant" && t.cancelled ? <CancelledTurnBanner /> : null}
                {t.role === "assistant" && t.evidenceState ? (
                  <div className="mb-2">
                    <EvidenceStateBadge state={t.evidenceState} />
                  </div>
                ) : null}
                {t.role === "assistant" && (t.factualityTypes ?? t.ux?.factualityTypes)?.length ? (
                  <FactualityAssertionBadges
                    types={t.factualityTypes ?? t.ux?.factualityTypes}
                  />
                ) : null}
                {t.role === "assistant" && t.provenance ? (
                  <div className="mb-2">
                    <ProvenanceBadge provenance={t.provenance} />
                  </div>
                ) : null}
                <p className="whitespace-pre-wrap">{t.content}</p>
                {t.role === "assistant" && t.ux?.ambiguity?.choices?.length ? (
                  <AmbiguityChooser
                    prompt={t.ux.ambiguity.prompt}
                    choices={t.ux.ambiguity.choices}
                    disabled={busy}
                    onChoose={(label) => void send({ questionOverride: label })}
                  />
                ) : null}
                {t.role === "assistant" && t.ux?.navigation ? (
                  <NavigationActionLink
                    matterId={matterId}
                    label={t.ux.navigation.label}
                    route={t.ux.navigation.route}
                    kind={t.ux.navigation.kind}
                  />
                ) : null}
                {t.role === "assistant" && t.ux?.action ? (
                  <ActionConfirmationCard
                    matterId={matterId}
                    action={t.ux.action}
                    disabled={busy}
                    onConfirm={(phrase) => void send({ questionOverride: phrase })}
                    onCancel={(phrase) => void send({ questionOverride: phrase })}
                  />
                ) : null}
                {isInsufficient(t.evidenceState) ? (
                  <p className="mt-2 rounded border border-line bg-black/[0.02] px-3 py-2 text-xs text-ink/65">
                    {
                      getSourceScopedAbstentionCopy(t.provenance?.sourceScope ?? "case")
                        .clientInsufficientHint
                    }
                  </p>
                ) : null}
                {t.needsMoreDocuments &&
                (t.provenance?.sourceScope ?? "case") !== "legal_research" &&
                (t.provenance?.sourceScope ?? "case") !== "web" ? (
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
                {isInsufficient(t.evidenceState) &&
                t.provenance?.sourceScope === "legal_research" &&
                (t.provenance.counts.authoritySourceCount ?? 0) === 0 ? (
                  <p className="mt-2 rounded border border-amber-700/25 bg-amber-50/70 px-3 py-2 text-xs text-ink/75">
                    <span className="font-semibold">Need more legal authority.</span> The configured
                    NyayaGrid legal corpus did not return sufficient authority for this question.
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
                      Sources ({t.sources.length})
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
                      aria-label={`Open ${t.sources.length} sources`}
                      onClick={() => openSources(t.sources ?? [], t.sources?.[0]?.id)}
                    >
                      View sources
                    </button>
                    {(t.provenance?.sourceScope ?? "case") !== "legal_research" &&
                    (t.provenance?.sourceScope ?? "case") !== "web" ? (
                      <Link
                        href={`/app/cases/${matterId}/evidence`}
                        className="text-xs font-semibold text-accent underline"
                      >
                        View evidence
                      </Link>
                    ) : null}
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
              onSubmit={(text) => void send({ questionOverride: text })}
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
