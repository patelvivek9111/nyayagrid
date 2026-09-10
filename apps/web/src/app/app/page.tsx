"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useActiveOrganization } from "@/components/use-active-organization";
import { useFeatureFlags } from "@/components/use-feature-flags";
import { genericAskRedirect } from "@/lib/first-run";
import { researchTurnAnswer } from "@/lib/research-chat";
import { useOrgCapability } from "@/components/use-org-capability";
import {
  CaseChip,
  ChatComposer,
  SourceDrawer,
  SourceMarker,
  type CaseOption,
  type SourceDrawerItem,
  ErrorState,
} from "@/components/ux";

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  evidenceState?: string;
  sources?: SourceDrawerItem[];
};

export default function NewChatPage() {
  const router = useRouter();
  const { organizationId, organizations, loading: orgLoading } = useActiveOrganization();
  const viewCap = useOrgCapability(organizationId, "matters.view");
  const { flags } = useFeatureFlags();
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cases, setCases] = useState<CaseOption[]>([]);
  const [selectedCase, setSelectedCase] = useState<CaseOption | null>(null);
  const [runTask, setRunTask] = useState(false);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  useEffect(() => {
    if (orgLoading || viewCap.loading) return;
    const href = genericAskRedirect({
      organizationCount: organizations.length,
      roleKey: viewCap.roleKey,
    });
    if (href) router.replace(href);
  }, [orgLoading, viewCap.loading, viewCap.roleKey, organizations.length, router]);

  useEffect(() => {
    if (!organizationId) return;
    fetch(`/api/v1/matters?organizationId=${organizationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) {
          setCases(
            (data.matters ?? []).map((m: { id: string; title: string; matterNumber: string }) => ({
              id: m.id,
              title: m.title,
              matterNumber: m.matterNumber,
            })),
          );
        }
      })
      .catch(() => undefined);
  }, [organizationId]);

  async function ensureGeneralSession(): Promise<string> {
    if (sessionId) return sessionId;
    const res = await fetch("/api/v1/research/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        organizationId,
        title: question.slice(0, 80) || "General chat",
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to start chat");
    setSessionId(data.session.id);
    return data.session.id as string;
  }

  async function send() {
    if (!organizationId || !question.trim()) return;
    setBusy(true);
    setError("");
    const q = question.trim();
    setQuestion("");
    setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: q }]);

    try {
      if (selectedCase) {
        const res = await fetch(`/api/v1/matters/${selectedCase.id}/ask`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            conversationId,
            mode: runTask ? "task" : "ask",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Ask failed");

        if (data.mode === "task" || data.run) {
          router.push(`/app/cases/${selectedCase.id}/work`);
          return;
        }

        const cid = data.conversationId as string;
        setConversationId(cid);
        const sources: SourceDrawerItem[] = (data.answer?.sources ?? []).map(
          (
            s: { chunkId?: string; documentId: string; quote: string; page?: number },
            i: number,
          ) => ({
            id: s.chunkId ?? `${s.documentId}-${i}`,
            title: `Document source`,
            classLabel: "From this case",
            subtitle: s.page ? `Page ${s.page}` : undefined,
            quote: s.quote,
          }),
        );
        setTurns((prev) => [
          ...prev,
          {
            id: data.artifact?.id ?? `a-${Date.now()}`,
            role: "assistant",
            content: data.answer?.answer ?? data.answer ?? "No answer returned.",
            evidenceState: data.answer?.evidenceState,
            sources,
          },
        ]);
        router.replace(`/app/cases/${selectedCase.id}/chats/${cid}`);
      } else {
        const sid = await ensureGeneralSession();
        const res = await fetch(`/api/v1/research/sessions/${sid}/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            queryText: q,
            includeMatterContext: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Query failed");
        const sources: SourceDrawerItem[] = (data.hits ?? data.authorities ?? []).map(
          (
            h: { chunkId?: string; title?: string; citation?: string; snippet?: string },
            i: number,
          ) => ({
            id: h.chunkId ?? `hit-${i}`,
            title: h.title ?? "Authority",
            classLabel: "Legal Authority",
            subtitle: h.citation ?? undefined,
            quote: h.snippet,
          }),
        );
        const answerText = researchTurnAnswer(data);
        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "assistant",
            content: answerText,
            evidenceState: data.synthesis?.evidenceState,
            sources,
          },
        ]);
        router.replace(`/app/chats/${sid}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
      setRunTask(false);
    }
  }

  async function onUpload(file: File) {
    if (!selectedCase) {
      setError("Select a Case before uploading a document.");
      return;
    }
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`/api/v1/matters/${selectedCase.id}/documents`, {
      method: "POST",
      body: form,
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Upload failed");
      return;
    }
    setError("");
    setTurns((prev) => [
      ...prev,
      {
        id: `sys-${Date.now()}`,
        role: "assistant",
        content: `Uploaded “${file.name}” to ${selectedCase.title}. Processing state: ${data.document?.processingState ?? "uploaded"}.`,
      },
    ]);
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-3xl flex-col">
      <div className="flex-1">
        {turns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
              Nyaya
            </p>
            <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">
              What can Nyaya help you with?
            </h1>
            <p className="mt-3 max-w-md text-sm text-ink/60">
              Ask a question. Attach a case if you want Nyaya to use that case&apos;s files.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-6">
            {turns.map((t) => (
              <div
                key={t.id}
                className={
                  t.role === "user"
                    ? "ml-8 rounded-lg bg-accent-soft/40 px-4 py-3 text-sm"
                    : "mr-4 rounded-lg border border-line bg-white px-4 py-3 text-sm"
                }
              >
                <p className="whitespace-pre-wrap">{t.content}</p>
                {t.evidenceState === "insufficient" ||
                t.evidenceState === "insufficient_evidence" ? (
                  <p className="mt-2 text-xs text-ink/55">
                    Insufficient verified evidence for a confident answer.
                  </p>
                ) : null}
                {t.sources && t.sources.length > 0 ? (
                  <div className="mt-2">
                    {t.sources.map((_, i) => (
                      <SourceMarker
                        key={`${t.id}-s-${i}`}
                        index={i + 1}
                        onClick={() => {
                          setDrawerItems(t.sources ?? []);
                          setDrawerOpen(true);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
        {error ? <ErrorState message={error} /> : null}
      </div>

      <div className="sticky bottom-0 bg-gradient-to-t from-[var(--ng-paper)] via-[var(--ng-paper)] to-transparent pb-2 pt-4">
        {orgLoading ? <p className="mb-2 text-xs text-ink/50">Loading workspace…</p> : null}
        <ChatComposer
          value={question}
          onChange={setQuestion}
          onSubmit={send}
          busy={busy}
          disabled={!organizationId}
          cases={cases}
          caseChip={
            selectedCase ? (
              <CaseChip
                label={selectedCase.title}
                onClear={() => {
                  setSelectedCase(null);
                  setConversationId(null);
                }}
              />
            ) : null
          }
          onSelectCase={(id) => {
            const c = cases.find((x) => x.id === id);
            if (c) setSelectedCase(c);
          }}
          onUploadDocument={onUpload}
          onRunTask={flags.agents ? () => setRunTask(true) : undefined}
          placeholder={
            selectedCase
              ? `Ask about ${selectedCase.title}…`
              : "Ask a legal question. Attach a case to use its files."
          }
          footer={
            <p className="text-[11px] text-ink/45">
              This is a draft, not legal advice. With no case attached, Nyaya will not read your
              case files.
            </p>
          }
        />
      </div>

      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
