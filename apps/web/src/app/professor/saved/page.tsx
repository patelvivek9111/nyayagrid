"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import { Badge, PageHeader, Panel } from "@nyayagrid/ui";

type ConversationRow = {
  id: string;
  title: string;
  updatedAt: string;
};

type SavedItem = {
  id: string;
  itemType: "explanation" | "case_brief" | "authority" | "case_comparison";
  title: string;
  content: string | null;
  ref: Record<string, unknown>;
  courseLabel: string | null;
  createdAt: string;
};

const TYPE_LABELS: Record<SavedItem["itemType"], string> = {
  explanation: "Explanation",
  case_brief: "Case brief",
  authority: "Authority",
  case_comparison: "Case comparison",
};

function savedItemHref(item: SavedItem): string | null {
  const ref = item.ref ?? {};
  if (item.itemType === "explanation" && typeof ref.conversationId === "string") {
    return `/professor/ask?conversationId=${ref.conversationId}`;
  }
  if (item.itemType === "case_brief" && typeof ref.caseId === "string") {
    return `/professor/cases/${ref.caseId}`;
  }
  if (item.itemType === "case_comparison") {
    if (typeof ref.caseAId === "string") return `/professor/cases/${ref.caseAId}`;
  }
  return null;
}

export default function ProfessorSavedPage() {
  const [conversations, setConversations] = useState<ConversationRow[]>([]);
  const [items, setItems] = useState<SavedItem[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    const [conversationsRes, itemsRes] = await Promise.all([
      fetch("/api/v1/professor/conversations"),
      fetch("/api/v1/professor/saved"),
    ]);
    const conversationsData = await conversationsRes.json();
    const itemsData = await itemsRes.json();
    if (!conversationsRes.ok) {
      throw new Error(conversationsData?.error?.message ?? "Failed to load conversations");
    }
    if (!itemsRes.ok) throw new Error(itemsData?.error?.message ?? "Failed to load saved items");
    setConversations(conversationsData.conversations ?? []);
    setItems(itemsData.items ?? []);
  }

  useEffect(() => {
    load()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function remove(id: string) {
    if (!window.confirm("Remove this saved item?")) return;
    const res = await fetch(`/api/v1/professor/saved/${id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) {
      setError(data?.error?.message ?? "Failed to delete");
      return;
    }
    setItems((current) => current.filter((item) => item.id !== id));
  }

  return (
    <>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Saved Conversations"
        description="Resume a study thread, or open a saved brief or comparison."
      />
      <div className="mb-4">
        <StudyAidNotice compact />
      </div>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <Panel title="Conversations">
        {loading ? (
          <p className="text-sm text-ink/70">Loading…</p>
        ) : conversations.length === 0 ? (
          <p className="text-sm text-ink/70">No conversations yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {conversations.map((conversation) => (
              <li key={conversation.id}>
                <Link
                  href={`/professor/ask?conversationId=${conversation.id}`}
                  className="text-accent underline"
                >
                  {conversation.title || "Untitled"}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Saved items" className="mt-4">
        {loading ? (
          <p className="text-sm text-ink/70">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-ink/70">
            Nothing saved yet. Save an explanation, brief, or comparison to see it here.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {items.map((item) => {
              const href = savedItemHref(item);
              const caseBId =
                item.itemType === "case_comparison" && typeof item.ref?.caseBId === "string"
                  ? item.ref.caseBId
                  : null;
              return (
                <li key={item.id} className="rounded border border-line px-3 py-2">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    {href ? (
                      <Link href={href} className="font-semibold text-accent underline">
                        {item.title}
                      </Link>
                    ) : (
                      <p className="font-semibold text-ink">{item.title}</p>
                    )}
                    <Badge>{TYPE_LABELS[item.itemType]}</Badge>
                  </div>
                  {caseBId ? (
                    <Link
                      href={`/professor/cases/${caseBId}`}
                      className="text-xs text-accent underline"
                    >
                      Open case B
                    </Link>
                  ) : null}
                  {item.courseLabel ? (
                    <p className="text-xs text-ink/50">{item.courseLabel}</p>
                  ) : null}
                  {item.content ? (
                    <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-ink/70">{item.content}</p>
                  ) : null}
                  <button
                    type="button"
                    className="mt-2 text-xs underline"
                    onClick={() => remove(item.id)}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
