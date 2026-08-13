"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import {
  ChatComposer,
  ErrorState,
  LoadingState,
  SourceDrawer,
  SourceMarker,
} from "@/components/ux";
import type { SourceDrawerItem } from "@/components/ux";

export default function GeneralChatPage() {
  const params = useParams<{ sessionId: string }>();
  const sessionId = params.sessionId;
  const { organizationId } = useActiveOrganization();
  const [title, setTitle] = useState("Chat");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [turns, setTurns] = useState<
    Array<{ id: string; role: "user" | "assistant"; content: string; sources?: SourceDrawerItem[] }>
  >([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    fetch(`/api/v1/research/sessions/${sessionId}?organizationId=${organizationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load chat");
        if (data.session?.matterId) {
          throw new Error("This session is Case-scoped. Open it from the Case instead.");
        }
        setTitle(data.session?.title ?? "Chat");
        // Session detail may include notes/queries depending on API shape.
        const history = (data.queries ?? data.messages ?? []).flatMap(
          (q: {
            id: string;
            queryText?: string;
            question?: string;
            answer?: string;
            synthesis?: { answer?: string };
          }) => {
            const userText = q.queryText ?? q.question;
            const answerText = q.synthesis?.answer ?? q.answer;
            const rows: Array<{ id: string; role: "user" | "assistant"; content: string }> = [];
            if (userText) rows.push({ id: `${q.id}-u`, role: "user", content: userText });
            if (answerText) rows.push({ id: `${q.id}-a`, role: "assistant", content: answerText });
            return rows;
          },
        );
        setTurns(history);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [organizationId, sessionId]);

  async function send() {
    if (!organizationId || !question.trim()) return;
    setBusy(true);
    setError("");
    const q = question.trim();
    setQuestion("");
    setTurns((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: q }]);
    try {
      const res = await fetch(`/api/v1/research/sessions/${sessionId}/query`, {
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
      const sources: SourceDrawerItem[] = (data.hits ?? []).map(
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
      setTurns((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          content:
            data.synthesis?.answer ??
            (sources.length === 0
              ? "I couldn't find enough verified authority to answer that confidently."
              : "See sources for potentially relevant authority."),
          sources,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <ProfessionalShell title={title}>
      <p className="mb-4 text-xs text-ink/50">
        General chat ·{" "}
        <Link href="/app/chats" className="underline">
          All chats
        </Link>
      </p>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}
      <div className="mb-6 space-y-3">
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
            {t.sources?.length ? (
              <div className="mt-2">
                {t.sources.map((_, i) => (
                  <SourceMarker
                    key={`${t.id}-${i}`}
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
      <ChatComposer
        value={question}
        onChange={setQuestion}
        onSubmit={send}
        busy={busy}
        disabled={!organizationId}
        placeholder="Continue this general chat…"
      />
      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </ProfessionalShell>
  );
}
