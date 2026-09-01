"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@nyayagrid/ui";
import {
  ChatComposer,
  EmptyState,
  ErrorState,
  IntelligenceHeader,
  LoadingState,
} from "@/components/ux";
import { useFeatureFlags } from "@/components/use-feature-flags";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";
import { SUGGESTED_CHAT_PROMPTS } from "@/lib/workspace-ux";

type Conv = { id: string; title: string | null; updatedAt: string; preview?: string | null };

export default function CaseChatsPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const router = useRouter();
  const { flags } = useFeatureFlags();
  const [conversations, setConversations] = useState<Conv[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [runTask, setRunTask] = useState(false);

  function refresh() {
    return fetch(`/api/v1/matters/${matterId}/conversations`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(userFacingLoadError("chats", res.status));
        setConversations(data.conversations ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : userFacingLoadError("chats")));
  }

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [matterId]);

  async function startChat(prompt?: string) {
    const text = (prompt ?? question).trim();
    if (!text) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, mode: runTask ? "task" : "ask" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Ask failed");
      if (data.run || data.mode === "task") {
        router.push(`/app/cases/${matterId}/work`);
        return;
      }
      const conversationId = data.qa?.conversationId ?? data.conversationId;
      if (!conversationId) throw new Error("Ask succeeded but no conversation was returned");
      router.push(`/app/cases/${matterId}/chats/${conversationId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : userFacingLoadError("chats"));
    } finally {
      setBusy(false);
      setRunTask(false);
    }
  }

  async function createChat() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New chat" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(userFacingLoadError("chats", res.status));
      const id = data.conversation?.id;
      if (!id) throw new Error(userFacingLoadError("chats"));
      router.push(`/app/cases/${matterId}/chats/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : userFacingLoadError("chats"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        title="Case Chats"
        description="Conversations stay tied to this Case. Nyaya answers from the files in this matter."
        actions={
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => void createChat()}
          >
            New chat
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="rounded-xl border border-line bg-white/80">
          <p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-ink/45">
            Conversations
          </p>
          {loading ? (
            <div className="p-3">
              <LoadingState />
            </div>
          ) : null}
          {!loading && conversations.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink/55">Start a conversation about this case.</p>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/app/cases/${matterId}/chats/${c.id}`}
                    className="block border-b border-line px-3 py-2.5 last:border-b-0 hover:bg-accent-soft/30"
                  >
                    <p className="truncate text-sm font-semibold">{c.title || "Untitled chat"}</p>
                    {c.preview ? <p className="truncate text-xs text-ink/50">{c.preview}</p> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <div className="flex min-h-[22rem] flex-col rounded-xl border border-line bg-white/80">
          <div className="flex-1 px-4 py-4">
            {!loading && conversations.length === 0 ? (
              <EmptyState
                title="Start a conversation about this case."
                description="Ask Nyaya about this Case to create the first conversation."
              />
            ) : (
              <p className="text-sm text-ink/60">Ask Nyaya about:</p>
            )}
            <ul className="mt-3 flex flex-wrap gap-2">
              {SUGGESTED_CHAT_PROMPTS.map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    className="rounded-md border border-line bg-white px-3 py-1.5 text-left text-xs font-semibold text-ink/70 hover:border-accent hover:text-accent"
                    onClick={() => {
                      setQuestion(prompt);
                      void startChat(prompt);
                    }}
                    disabled={busy}
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="sticky bottom-0 border-t border-line bg-white p-3">
            <ChatComposer
              value={question}
              onChange={setQuestion}
              onSubmit={() => void startChat()}
              busy={busy}
              onRunTask={flags.agents ? () => setRunTask(true) : undefined}
              placeholder="Ask Nyaya about this Case…"
            />
          </div>
        </div>
      </div>
      {error ? <ErrorState message={error} /> : null}
      <Link
        href={`/app/cases/${matterId}/nyaya`}
        className="inline-block text-sm font-semibold text-accent underline"
      >
        Ask Nyaya about this case
      </Link>
    </div>
  );
}
