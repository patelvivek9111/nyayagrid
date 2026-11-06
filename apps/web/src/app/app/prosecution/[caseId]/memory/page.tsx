"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { ProsecutionCaseNav } from "@/components/prosecution/case-section";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState, StatusLabel } from "@/components/ux";
import { Button } from "@nyayagrid/ui";
import { humanizeKey } from "@/lib/plain-labels";

type MemoryRow = {
  id: string;
  memoryType: string;
  content: string;
  status: string;
  origin: string;
  confidence: string | null;
  evidenceItemId: string | null;
  isVerifiedFact: boolean;
  attorneyBadge: "verified" | "suggested" | "historical";
  provenance: Record<string, unknown>;
  updatedAt: string;
};

function badgeTone(badge: MemoryRow["attorneyBadge"]): "ok" | "warn" | "neutral" {
  if (badge === "verified") return "ok";
  if (badge === "suggested") return "warn";
  return "neutral";
}

export default function ProsecutionCaseMemoryPage() {
  const params = useParams<{ caseId: string }>();
  const caseId = params.caseId;
  const { organizationId } = useActiveOrganization();
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [memoryType, setMemoryType] = useState("open_question");
  const [saving, setSaving] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    fetch(`/api/v1/prosecution/cases/${caseId}/memory?organizationId=${organizationId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? "Could not load case memory.");
        setMemories(data.memories ?? []);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load case memory.");
        setMemories([]);
      })
      .finally(() => setLoading(false));
  }, [caseId, organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !content.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/v1/prosecution/cases/${caseId}/memory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          memoryType,
          content: content.trim(),
          origin: "manual",
          status: "proposed",
          provenance: { humanEntered: true, extractionOrigin: "human" },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not create memory.");
      setContent("");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create memory.");
    } finally {
      setSaving(false);
    }
  }

  async function review(
    memoryId: string,
    action: "approve" | "reject" | "edit",
    editContent?: string,
  ) {
    if (!organizationId) return;
    setReviewingId(memoryId);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/prosecution/cases/${caseId}/memory/${memoryId}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            organizationId,
            action,
            content: action === "edit" ? editContent : undefined,
            provenance:
              action === "edit" ? { humanEntered: true, extractionOrigin: "human" } : undefined,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not review memory.");
      load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not review memory.");
    } finally {
      setReviewingId(null);
    }
  }

  return (
    <ProfessionalShell title="Case memory">
      <ProsecutionCaseNav caseId={caseId} active="memory" />
      <p className="text-xs uppercase tracking-[0.16em] text-accent">Nyaya Memory</p>
      <h1 className="font-display text-2xl text-ink">Prosecution case memory</h1>
      <p className="mt-1 max-w-2xl text-sm text-ink/70">
        Reviewable, case-scoped notes with provenance. Proposed AI entries are suggestions — not
        verified facts. Nyaya does not record guilt verdicts or charging recommendations.
      </p>

      <form onSubmit={onCreate} className="mt-4 space-y-3 rounded-md border border-line p-3">
        <label className="block text-sm font-semibold text-ink">
          Memory type
          <select
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm font-normal"
            value={memoryType}
            onChange={(event) => setMemoryType(event.target.value)}
          >
            <option value="confirmed_fact">Confirmed fact</option>
            <option value="disputed_fact">Disputed fact</option>
            <option value="allegation">Allegation</option>
            <option value="admission">Admission</option>
            <option value="legal_issue">Legal issue</option>
            <option value="open_question">Open question</option>
            <option value="procedural_context">Procedural context</option>
            <option value="evidence_note">Evidence note</option>
            <option value="strategy_note">Strategy note</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="block text-sm font-semibold text-ink">
          Content
          <textarea
            className="mt-1 block w-full rounded border border-line px-2 py-1.5 text-sm font-normal"
            rows={3}
            value={content}
            onChange={(event) => setContent(event.target.value)}
            placeholder="Record a reviewable case fact, issue, or question…"
            required
          />
        </label>
        <Button type="submit" disabled={saving || !content.trim()}>
          {saving ? "Saving…" : "Add proposed memory"}
        </Button>
      </form>

      {loading ? <LoadingState label="Loading case memory" /> : null}
      {error ? (
        <div className="mt-3">
          <ErrorState message={error} />
        </div>
      ) : null}

      {!loading && memories.length === 0 && !error ? (
        <div className="mt-4">
          <EmptyState
            title="No case memory yet"
            description="Create reviewable entries linked to this criminal case. Approve only after human review."
          />
        </div>
      ) : null}

      <ul className="mt-4 space-y-3">
        {memories.map((memory) => (
          <li key={memory.id} className="rounded-md border border-line p-3">
            <div className="flex flex-wrap items-center gap-2">
              <StatusLabel
                label={memory.isVerifiedFact ? "Verified fact" : humanizeKey(memory.attorneyBadge)}
                tone={badgeTone(memory.attorneyBadge)}
              />
              <StatusLabel label={humanizeKey(memory.status)} tone="neutral" />
              <span className="text-xs text-ink/55">{humanizeKey(memory.memoryType)}</span>
              <span className="text-xs text-ink/55">· {humanizeKey(memory.origin)}</span>
              {memory.confidence ? (
                <span className="text-xs text-ink/55">· {humanizeKey(memory.confidence)}</span>
              ) : null}
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-ink/90">{memory.content}</p>
            {memory.evidenceItemId ? (
              <p className="mt-1 text-xs text-ink/55">Evidence link: {memory.evidenceItemId}</p>
            ) : null}
            <p className="mt-1 text-xs text-ink/55">
              Provenance:{" "}
              {memory.provenance?.humanEntered
                ? "human-entered"
                : memory.provenance?.documentId
                  ? `document ${String(memory.provenance.documentId)}`
                  : memory.provenance?.extractionOrigin
                    ? String(memory.provenance.extractionOrigin)
                    : "recorded"}
            </p>
            {memory.status === "proposed" || memory.status === "approved" ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {memory.status === "proposed" ? (
                  <Button
                    type="button"
                    disabled={reviewingId === memory.id}
                    onClick={() => review(memory.id, "approve")}
                  >
                    Approve
                  </Button>
                ) : null}
                <Button
                  type="button"
                  disabled={reviewingId === memory.id}
                  onClick={() => {
                    const next = window.prompt("Corrected content", memory.content);
                    if (next?.trim()) void review(memory.id, "edit", next.trim());
                  }}
                >
                  Edit &amp; approve
                </Button>
                <Button
                  type="button"
                  disabled={reviewingId === memory.id}
                  onClick={() => review(memory.id, "reject")}
                >
                  Reject
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </ProfessionalShell>
  );
}
