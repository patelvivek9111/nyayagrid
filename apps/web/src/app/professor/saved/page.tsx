"use client";

import { useEffect, useState } from "react";
import { StudentShell } from "@/components/shell";
import { Badge, PageHeader, Panel } from "@nyayagrid/ui";

type SavedItem = {
  id: string;
  itemType: "explanation" | "case_brief" | "authority" | "case_comparison";
  title: string;
  content: string | null;
  createdAt: string;
};

const TYPE_LABELS: Record<SavedItem["itemType"], string> = {
  explanation: "Explanation",
  case_brief: "Case brief",
  authority: "Authority",
  case_comparison: "Case comparison",
};

export default function ProfessorSavedPage() {
  const [items, setItems] = useState<SavedItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/v1/professor/saved")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load saved items");
        setItems(data.items ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  return (
    <StudentShell>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Saved"
        description="Explanations, briefs, authorities, and comparisons you've saved for later review."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <Panel title="Your saved items">
        {items.length === 0 ? (
          <p className="text-sm text-ink/70">
            Nothing saved yet. Save an explanation, brief, or comparison to see it here.
          </p>
        ) : (
          <ul className="space-y-3 text-sm">
            {items.map((item) => (
              <li key={item.id} className="rounded border border-line px-3 py-2">
                <div className="mb-1 flex items-center justify-between">
                  <p className="font-semibold text-ink">{item.title}</p>
                  <Badge>{TYPE_LABELS[item.itemType]}</Badge>
                </div>
                {item.content ? (
                  <p className="whitespace-pre-wrap text-ink/70">{item.content}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </StudentShell>
  );
}
