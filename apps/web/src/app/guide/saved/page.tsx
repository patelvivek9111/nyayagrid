"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PublicShell } from "@/components/shell";
import { PageHeader, Panel } from "@nyayagrid/ui";

type ConversationRow = {
  id: string;
  title: string;
  jurisdiction: string | null;
  updatedAt: string;
};

export default function GuideSavedPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/v1/guide/conversations")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load conversations");
        setConversations(data.conversations ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Nyaya Guide"
        title="Saved Conversations"
        description="Your Nyaya Guide Q&A history. These are not privileged and are not a lawyer consultation."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <Panel title="Conversations">
        {conversations.length === 0 ? (
          <p className="text-sm text-ink/70">
            No saved conversations yet.{" "}
            <Link className="font-semibold text-accent underline" href="/guide">
              Ask Nyaya Guide
            </Link>
            .
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="rounded border border-line px-3 py-2">
                <Link className="font-semibold text-accent underline" href={`/guide?c=${conversation.id}`}>
                  {conversation.title || "Untitled"}
                </Link>
                {conversation.jurisdiction ? (
                  <p className="text-xs text-ink/50">Jurisdiction: {conversation.jurisdiction}</p>
                ) : (
                  <p className="text-xs text-ink/50">No jurisdiction recorded</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </PublicShell>
  );
}
