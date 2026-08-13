"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Panel, Badge, Button } from "@nyayagrid/ui";
import {
  ConflictingEvidenceBadge,
  EmptyState,
  ErrorState,
  LoadingState,
  SuggestedBadge,
  VerifiedBadge,
  SourceDrawer,
  type SourceDrawerItem,
} from "@/components/ux";

type FindingSource = {
  id: string;
  side?: string | null;
  supportingText?: string | null;
  page?: number | null;
  documentId?: string;
  chunkId?: string | null;
};

type Finding = {
  id: string;
  title: string;
  explanation?: string | null;
  findingType: string;
  confidence?: string;
  status: string;
  attention?: string;
  sources?: FindingSource[];
  relatedTimelineEventIds?: string[];
  sideAEventIds?: string[];
  sideBEventIds?: string[];
};

export default function CaseEvidencePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [data, setData] = useState<any>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  async function loadEvidence() {
    const res = await fetch(`/api/v1/matters/${matterId}/evidence`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load evidence");
    setData(json);
  }

  async function loadContradictions() {
    const res = await fetch(
      `/api/v1/matters/${matterId}/analysis/findings?runType=contradiction&includeSources=true`,
    );
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load contradictions");
    setFindings(json.findings ?? []);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadEvidence(), loadContradictions()])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [matterId]);

  async function detectContradictions() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/analysis/contradictions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Contradiction detection failed");
      await loadContradictions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Detection failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewFinding(findingId: string, action: "reviewed" | "dismissed") {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/analysis/findings/${findingId}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Review failed");
      await loadContradictions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  function openSides(finding: Finding) {
    const sources = finding.sources ?? [];
    setDrawerItems(
      sources.map((s, i) => ({
        id: s.id ?? `src-${i}`,
        title: s.side === "B" ? "Side B" : "Side A",
        classLabel: "Conflicting evidence",
        subtitle: s.page != null ? `Page ${s.page}` : undefined,
        quote: s.supportingText ?? undefined,
        chunkId: s.chunkId ?? undefined,
      })),
    );
    setDrawerOpen(true);
  }

  if (loading) return <LoadingState label="Loading evidence…" />;
  if (error && !data) return <ErrorState message={error} />;

  const docs = data?.documents ?? [];
  const matrix = data?.evidenceMatrix ?? data?.matrix ?? [];
  const contradictionFindings = findings.filter(
    (f) => f.findingType === "contradiction" || f.findingType === "tension",
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-ink">Evidence</h2>
        <p className="text-sm text-ink/60">
          How source material relates to issues and facts — including dual-sided conflicts. Nyaya
          never picks a single “truth” from a contradiction.
        </p>
      </div>

      {error ? <ErrorState message={error} /> : null}

      <Panel title="Conflicting evidence">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button type="button" disabled={busy} variant="secondary" onClick={detectContradictions}>
            {busy ? "Working…" : "Detect contradictions"}
          </Button>
          <p className="text-xs text-ink/55">
            Findings stay proposed until reviewed. Timeline suggestions stay separate until
            verified.
          </p>
        </div>
        {contradictionFindings.length === 0 ? (
          <EmptyState
            title="No contradictions detected yet"
            description="Run detection after documents are processed, or open Analysis for deposition-scoped runs."
          />
        ) : (
          <ul className="space-y-3 text-sm">
            {contradictionFindings.map((f) => {
              const sideA = (f.sources ?? []).filter((s) => s.side === "A");
              const sideB = (f.sources ?? []).filter((s) => s.side === "B");
              return (
                <li key={f.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold">{f.title}</p>
                    <ConflictingEvidenceBadge />
                    {f.status === "proposed" ? <SuggestedBadge /> : <VerifiedBadge>Reviewed</VerifiedBadge>}
                    <Badge>{f.findingType}</Badge>
                  </div>
                  {f.explanation ? <p className="mt-2 text-ink/75">{f.explanation}</p> : null}
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded border border-line bg-black/[0.02] p-2 text-xs">
                      <p className="font-semibold uppercase tracking-wide text-ink/45">Side A</p>
                      <p className="mt-1 text-ink/75">
                        {sideA[0]?.supportingText ?? "No Side A summary stored."}
                      </p>
                    </div>
                    <div className="rounded border border-line bg-black/[0.02] p-2 text-xs">
                      <p className="font-semibold uppercase tracking-wide text-ink/45">Side B</p>
                      <p className="mt-1 text-ink/75">
                        {sideB[0]?.supportingText ?? "No Side B summary stored."}
                      </p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="text-xs font-semibold text-accent underline"
                      onClick={() => openSides(f)}
                    >
                      Inspect both sides
                    </button>
                    {(f.relatedTimelineEventIds ?? []).length > 0 ? (
                      <Link
                        href={`/app/cases/${matterId}/timeline?relatedFinding=${f.id}`}
                        className="text-xs font-semibold text-accent underline"
                      >
                        Related Timeline events ({f.relatedTimelineEventIds!.length})
                      </Link>
                    ) : (
                      <Link
                        href={`/app/cases/${matterId}/timeline`}
                        className="text-xs text-ink/55 underline"
                      >
                        Open Timeline
                      </Link>
                    )}
                    {(f.sideAEventIds?.length || f.sideBEventIds?.length) ? (
                      <span className="text-[11px] text-ink/50">
                        Sides stay separate
                        {f.sideAEventIds?.length ? ` · A→${f.sideAEventIds.length}` : ""}
                        {f.sideBEventIds?.length ? ` · B→${f.sideBEventIds.length}` : ""}
                        {" "}(no auto-merge)
                      </span>
                    ) : null}
                    {f.status === "proposed" ? (
                      <>
                        <Button
                          type="button"
                          disabled={busy}
                          onClick={() => reviewFinding(f.id, "reviewed")}
                        >
                          Mark reviewed
                        </Button>
                        <Button
                          type="button"
                          disabled={busy}
                          variant="ghost"
                          onClick={() => reviewFinding(f.id, "dismissed")}
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title="Important documents">
        {docs.filter((d: any) => d.important || d.reviewState?.important).length === 0 ? (
          <p className="text-sm text-ink/60">No documents marked important yet.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {docs
              .filter((d: any) => d.important || d.reviewState?.important)
              .map((d: any) => (
                <li key={d.document?.id ?? d.id} className="flex justify-between gap-2">
                  <span className="font-semibold">{d.document?.title ?? d.title}</span>
                  <VerifiedBadge>Reviewed</VerifiedBadge>
                </li>
              ))}
          </ul>
        )}
      </Panel>

      <Panel title="Evidence by document">
        {docs.length === 0 ? (
          <EmptyState
            title="No evidence links yet"
            description="Upload and analyze documents to connect sources to facts, events, and people."
          />
        ) : (
          <ul className="space-y-4">
            {docs.map((row: any) => {
              const doc = row.document ?? row;
              const links = [
                ...(row.linkedEvents ?? []).map((e: any) => ({
                  kind: "Event",
                  label: e.title,
                  status: e.status,
                })),
                ...(row.linkedFacts ?? []).map((f: any) => ({
                  kind: "Fact",
                  label: f.statement ?? f.title,
                  status: f.status,
                })),
                ...(row.linkedEntities ?? []).map((e: any) => ({
                  kind: "Person",
                  label: e.displayName,
                  status: e.status,
                })),
                ...(row.linkedGraphEdges ?? []).map((e: any) => ({
                  kind: "Relationship",
                  label: e.relationshipType ?? e.edgeType,
                  status: e.status,
                })),
              ];
              return (
                <li key={doc.id} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-sm">{doc.title}</p>
                    <Badge>{doc.processingState}</Badge>
                    {row.important || row.reviewState?.important ? (
                      <VerifiedBadge>Key</VerifiedBadge>
                    ) : null}
                  </div>
                  {links.length === 0 ? (
                    <p className="mt-2 text-xs text-ink/50">No linked intelligence yet.</p>
                  ) : (
                    <ul className="mt-2 space-y-1 text-xs">
                      {links.map((l, i) => (
                        <li
                          key={`${doc.id}-${i}`}
                          className="flex items-center justify-between gap-2"
                        >
                          <span>
                            {l.kind}: {l.label}
                          </span>
                          {l.status === "proposed" ? <SuggestedBadge /> : <VerifiedBadge />}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {Array.isArray(matrix) && matrix.length > 0 ? (
        <Panel title="Issue matrix">
          <ul className="space-y-3 text-sm">
            {matrix.map((item: any, idx: number) => (
              <li key={item.id ?? idx} className="rounded border border-line p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">{item.issue ?? item.label ?? "Issue"}</p>
                  {item.conflict || item.stance === "contrary" ? (
                    <ConflictingEvidenceBadge />
                  ) : null}
                  {item.status === "proposed" ? <SuggestedBadge /> : <VerifiedBadge />}
                </div>
                {item.supporting ? (
                  <p className="mt-1 text-xs text-ink/65">Supporting: {item.supporting}</p>
                ) : null}
                {item.contrary ? (
                  <p className="mt-1 text-xs text-ink/65">Contrary: {item.contrary}</p>
                ) : null}
                {item.gap ? <p className="mt-1 text-xs text-ink/65">Gap: {item.gap}</p> : null}
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-accent underline"
                  onClick={() => {
                    setDrawerItems(
                      (item.sources ?? []).map((s: any, i: number) => ({
                        id: s.id ?? `src-${i}`,
                        title: s.title ?? "Source",
                        classLabel: "Matter Evidence",
                        quote: s.quote ?? s.snippet,
                      })),
                    );
                    setDrawerOpen(true);
                  }}
                >
                  Inspect sources
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <p className="text-xs text-ink/50">
        AI classifications remain <SuggestedBadge /> until reviewed. Suggested timeline events stay
        on{" "}
        <Link href={`/app/cases/${matterId}/timeline`} className="text-accent underline">
          Timeline
        </Link>{" "}
        until verified.{" "}
        <Link href={`/app/cases/${matterId}/analysis`} className="text-accent underline">
          Open Analysis
        </Link>
      </p>
      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}
