"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudentShell } from "@/components/shell";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type ConversationRow = { id: string; title: string; updatedAt: string; explanationLevel: string };
type CaseRow = { id: string; title: string; citation: string | null; processingState: string };
type SavedItemRow = { id: string; title: string; itemType: string };

export default function ProfessorHomePage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [saved, setSaved] = useState<SavedItemRow[]>([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    async function load() {
      try {
        const [conversationsRes, casesRes, savedRes] = await Promise.all([
          fetch("/api/v1/professor/conversations"),
          fetch("/api/v1/professor/cases"),
          fetch("/api/v1/professor/saved"),
        ]);
        const [conversationsData, casesData, savedData] = await Promise.all([
          conversationsRes.json(),
          casesRes.json(),
          savedRes.json(),
        ]);
        if (!conversationsRes.ok) throw new Error(conversationsData?.error?.message);
        if (!casesRes.ok) throw new Error(casesData?.error?.message);
        if (!savedRes.ok) throw new Error(savedData?.error?.message);
        setConversations(conversationsData.conversations ?? []);
        setCases(casesData.cases ?? []);
        setSaved(savedData.items ?? []);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "Failed to load your workspace");
      }
    }
    load();
  }, []);

  return (
    <StudentShell>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Welcome back"
        description="Upload cases, ask study questions, generate briefs, and compare opinions — all grounded in the text you provide and the shared legal authority corpus."
      />
      {message ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{message}</p> : null}

      <div className="mb-6 grid gap-4 md:grid-cols-3">
        <Panel title="Ask Professor">
          <p className="mb-3 text-sm text-ink/70">
            Ask a question in {conversations.length > 0 ? "an existing" : "a new"} conversation.
          </p>
          <Link href="/professor/ask">
            <Button>Ask a question</Button>
          </Link>
        </Panel>
        <Panel title="Cases">
          <p className="mb-3 text-sm text-ink/70">
            {cases.length} case{cases.length === 1 ? "" : "s"} in your library.
          </p>
          <Link href="/professor/cases">
            <Button variant="secondary">View cases</Button>
          </Link>
        </Panel>
        <Panel title="Saved">
          <p className="mb-3 text-sm text-ink/70">
            {saved.length} saved item{saved.length === 1 ? "" : "s"}.
          </p>
          <Link href="/professor/saved">
            <Button variant="secondary">View saved</Button>
          </Link>
        </Panel>
      </div>

      <Panel title="Recent conversations">
        {conversations.length === 0 ? (
          <p className="text-sm text-ink/70">No conversations yet. Ask your first question.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {conversations.slice(0, 6).map((conversation) => (
              <li
                key={conversation.id}
                className="flex items-center justify-between rounded border border-line px-3 py-2"
              >
                <Link
                  href={`/professor/ask?conversationId=${conversation.id}`}
                  className="font-semibold text-accent underline"
                >
                  {conversation.title}
                </Link>
                <Badge>{conversation.explanationLevel}</Badge>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </StudentShell>
  );
}
