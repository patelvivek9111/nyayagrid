"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@nyayagrid/ui";
import {
  ChatComposer,
  EmptyState,
  ErrorState,
  LoadingState,
  SourceDrawer,
  SourceMarker,
  type SourceDrawerItem,
} from "@/components/ux";

type Conv = { id: string; title: string | null; updatedAt: string; preview?: string | null };

export default function CaseChatsPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const router = useRouter();
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
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load chats");
        setConversations(data.conversations ?? []);
      })
      .catch((err) => setError(err.message));
  }

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [matterId]);

  async function startChat() {
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question.trim(), mode: runTask ? "task" : "ask" }),
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
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
      setRunTask(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-ink">Case Chats</h2>
        <p className="text-sm text-ink/60">Conversations stay tied to this Case only.</p>
      </div>

      <ChatComposer
        value={question}
        onChange={setQuestion}
        onSubmit={startChat}
        busy={busy}
        onRunTask={() => setRunTask(true)}
        placeholder="Start a new Case chat…"
      />
      {error ? <ErrorState message={error} /> : null}
      {loading ? <LoadingState /> : null}

      {!loading && conversations.length === 0 ? (
        <EmptyState
          title="No chats yet"
          description="Ask Nyaya a Case question to create the first conversation."
        />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {conversations.map((c) => (
            <li key={c.id}>
              <Link
                href={`/app/cases/${matterId}/chats/${c.id}`}
                className="block px-4 py-3 hover:bg-accent-soft/30"
              >
                <p className="font-semibold text-sm">{c.title || "Untitled chat"}</p>
                {c.preview ? <p className="truncate text-xs text-ink/50">{c.preview}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Link href={`/app/cases/${matterId}/nyaya`}>
          <Button type="button" variant="ghost">
            Ask Nyaya about this case
          </Button>
        </Link>
      </div>
    </div>
  );
}
