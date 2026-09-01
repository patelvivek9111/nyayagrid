"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@nyayagrid/ui";
import {
  EmptyState,
  ErrorState,
  FilterChipBar,
  IntelligenceHeader,
  IntelligenceInspector,
  LoadingState,
  RelatedList,
  SourceDrawer,
  TrustStatus,
  type SourceDrawerItem,
} from "@/components/ux";
import {
  evidenceLinkSummary,
  evidenceMatrixIssues,
  sourceCountLabel,
  trustStatusFromRecord,
  unwrapEvidencePreviews,
  userFacingLoadError,
  type EvidenceDocumentRow,
  type EvidenceMatrixIssue,
} from "@/lib/case-intelligence-ux";

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
  sources?: FindingSource[];
  relatedTimelineEventIds?: string[];
  sideAEventIds?: string[];
  sideBEventIds?: string[];
};

type EvidenceTab = "key" | "conflicts" | "missing" | "issues" | "all";

export default function CaseEvidencePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [data, setData] = useState<any>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [entities, setEntities] = useState<Array<{ id: string; displayName: string }>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<EvidenceTab>("key");
  const [selectedDoc, setSelectedDoc] = useState<EvidenceDocumentRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItems, setDrawerItems] = useState<SourceDrawerItem[]>([]);

  async function loadEvidence() {
    const res = await fetch(`/api/v1/matters/${matterId}/evidence`);
    const json = await res.json();
    if (!res.ok) throw new Error(userFacingLoadError("evidence", res.status));
    setData(json);
  }

  async function loadContradictions() {
    const res = await fetch(
      `/api/v1/matters/${matterId}/analysis/findings?runType=contradiction&includeSources=true`,
    );
    const json = await res.json();
    if (!res.ok) throw new Error(userFacingLoadError("evidence", res.status));
    setFindings(json.findings ?? []);
  }

  async function loadPeople() {
    const res = await fetch(`/api/v1/matters/${matterId}/entities`);
    if (!res.ok) return;
    const json = await res.json();
    setEntities((json.entities ?? []).map((e: any) => ({ id: e.id, displayName: e.displayName })));
  }

  function reload() {
    return Promise.all([loadEvidence(), loadContradictions(), loadPeople()]);
  }

  useEffect(() => {
    setLoading(true);
    reload()
      .catch((err) =>
        setError(err instanceof Error ? err.message : userFacingLoadError("evidence")),
      )
      .finally(() => setLoading(false));
  }, [matterId]);

  async function detectContradictions() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/analysis/contradictions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      if (!res.ok) throw new Error("We couldn't detect conflicts. Try again.");
      await loadContradictions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't detect conflicts. Try again.");
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
      if (!res.ok) throw new Error("We couldn't update that review. Try again.");
      await loadContradictions();
    } catch (err) {
      setError(err instanceof Error ? err.message : "We couldn't update that review. Try again.");
    } finally {
      setBusy(false);
    }
  }

  function openFindingSources(finding: Finding) {
    const sources = finding.sources ?? [];
    setDrawerItems(
      sources.map((s, i) => ({
        id: s.id ?? `src-${i}`,
        title: s.side === "B" ? "Source B" : "Source A",
        classLabel: "Conflicting evidence",
        subtitle: s.page != null ? `Page ${s.page}` : undefined,
        quote: s.supportingText ?? undefined,
        chunkId: s.chunkId ?? undefined,
        documentId: s.documentId,
      })),
    );
    setDrawerOpen(true);
  }

  const docs: EvidenceDocumentRow[] = data?.documents ?? [];
  const matrix = evidenceMatrixIssues(data?.evidenceMatrix ?? data?.matrix);
  const contradictionFindings = findings.filter(
    (f) => f.findingType === "contradiction" || f.findingType === "tension",
  );
  const keyDocs = docs.filter((d) => d.important || d.reviewState?.important);
  const gaps = matrix.flatMap((issue) =>
    (issue.gaps ?? []).map((gap) => ({ issue: issue.label ?? "Issue", rationale: gap.rationale })),
  );
  const entityName = (id: string | undefined) =>
    entities.find((e) => e.id === id)?.displayName ?? "";

  const selectedPreviews = selectedDoc
    ? unwrapEvidencePreviews({
        ...selectedDoc,
        linkedEntities: (selectedDoc.linkedEntities ?? []).map((item: any) => ({
          ...item,
          displayName: item.displayName ?? entityName(item.entityId ?? item.entity?.id),
        })),
      })
    : [];

  if (loading) return <LoadingState label="Loading evidence…" />;
  if (error && !data) return <ErrorState message={error} />;

  return (
    <div className="space-y-4">
      <IntelligenceHeader
        title="Evidence"
        description="What the record supports or challenges. Conflicting accounts stay side by side — NyayaGrid does not choose a single truth."
        actions={
          <Button type="button" variant="secondary" disabled={busy} onClick={detectContradictions}>
            {busy ? "Working…" : "Look for conflicts"}
          </Button>
        }
      />
      {error ? <ErrorState message={error} /> : null}
      <FilterChipBar
        value={tab}
        onChange={(id) => {
          setTab(id as EvidenceTab);
          setSelectedDoc(null);
        }}
        options={[
          { id: "key", label: "Key evidence", count: keyDocs.length },
          { id: "conflicts", label: "Conflicts", count: contradictionFindings.length },
          { id: "missing", label: "Missing / unsupported", count: gaps.length },
          { id: "issues", label: "By issue", count: matrix.length },
          { id: "all", label: "All sources", count: docs.length },
        ]}
      />

      {tab === "conflicts" ? (
        contradictionFindings.length === 0 ? (
          <EmptyState
            title="No conflicting evidence yet."
            description="After documents are processed, look for conflicts. Each side stays separate until a lawyer reviews it."
          />
        ) : (
          <ul className="space-y-3">
            {contradictionFindings.map((f) => {
              const sideA = (f.sources ?? []).filter((s) => s.side === "A");
              const sideB = (f.sources ?? []).filter((s) => s.side === "B");
              return (
                <li key={f.id} className="rounded-xl border border-line bg-white/80 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-lg text-ink">{f.title}</h3>
                    <TrustStatus
                      kind={trustStatusFromRecord({
                        status: f.status,
                        disputed: true,
                      })}
                    />
                  </div>
                  <p className="mt-2 text-sm text-ink/70">
                    NyayaGrid does not choose between these accounts automatically.
                  </p>
                  {f.explanation ? (
                    <p className="mt-2 text-sm text-ink/75">{f.explanation}</p>
                  ) : null}
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-lg border border-line bg-black/[0.02] p-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                        Source A
                      </p>
                      <p className="mt-1 line-clamp-5 text-ink/80">
                        {sideA[0]?.supportingText ?? "No Source A summary stored."}
                      </p>
                    </div>
                    <div className="rounded-lg border border-line bg-black/[0.02] p-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink/45">
                        Source B
                      </p>
                      <p className="mt-1 line-clamp-5 text-ink/80">
                        {sideB[0]?.supportingText ?? "No Source B summary stored."}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button type="button" variant="secondary" onClick={() => openFindingSources(f)}>
                      {sourceCountLabel((f.sources ?? []).length)}
                    </Button>
                    <Link
                      href={`/app/cases/${matterId}/review`}
                      className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
                    >
                      Review evidence
                    </Link>
                    <Link
                      href={
                        (f.relatedTimelineEventIds ?? []).length > 0
                          ? `/app/cases/${matterId}/timeline?relatedFinding=${f.id}`
                          : `/app/cases/${matterId}/timeline`
                      }
                      className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
                    >
                      Open timeline
                    </Link>
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
        )
      ) : null}

      {tab === "missing" ? (
        gaps.length === 0 ? (
          <EmptyState
            title="No missing or unsupported items recorded."
            description="Gaps appear when confirmed facts or events still lack a cited source or description."
          />
        ) : (
          <ul className="space-y-2">
            {gaps.map((gap, i) => (
              <li
                key={`${gap.issue}-${i}`}
                className="rounded-lg border border-line bg-white px-4 py-3 text-sm"
              >
                <p className="font-semibold">{gap.issue}</p>
                <p className="mt-1 text-ink/70">{gap.rationale}</p>
              </li>
            ))}
          </ul>
        )
      ) : null}

      {tab === "issues" ? (
        matrix.length === 0 ? (
          <EmptyState
            title="No issues linked yet."
            description="Confirmed facts and events will appear here with supporting and contrary sources."
          />
        ) : (
          <ul className="space-y-3">
            {matrix.map((issue, idx) => (
              <IssueCard
                key={issue.issueKey ?? idx}
                issue={issue}
                onOpenSources={(items) => {
                  setDrawerItems(items);
                  setDrawerOpen(true);
                }}
              />
            ))}
          </ul>
        )
      ) : null}

      {(tab === "key" || tab === "all") && (
        <DocumentList
          docs={tab === "key" ? keyDocs : docs}
          emptyTitle={
            tab === "key" ? "No key evidence yet." : "No case evidence has been linked yet."
          }
          emptyDescription={
            tab === "key"
              ? "Mark a document important, or confirm facts and events linked to a source."
              : "Upload and analyze documents to connect sources to facts, events, and people."
          }
          entityName={entityName}
          selectedId={selectedDoc?.document?.id ?? selectedDoc?.id}
          onSelect={setSelectedDoc}
        />
      )}

      <IntelligenceInspector
        open={Boolean(selectedDoc)}
        title={selectedDoc?.document?.title ?? selectedDoc?.title ?? "Document"}
        onClose={() => setSelectedDoc(null)}
        actions={
          selectedDoc ? (
            <>
              <Link
                href={`/app/cases/${matterId}/documents`}
                className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
              >
                Open document
              </Link>
              <Link
                href={`/app/cases/${matterId}/timeline`}
                className="inline-flex items-center rounded-md border border-line px-4 py-2 text-sm font-semibold"
              >
                Open timeline
              </Link>
            </>
          ) : null
        }
      >
        {selectedDoc ? (
          <>
            <RelatedList heading="Case connections" empty="No extracted case connections yet.">
              {selectedPreviews.length > 0 ? (
                <ul className="space-y-1">
                  {selectedPreviews.slice(0, 8).map((preview, i) => (
                    <li key={`${preview.kind}-${i}`}>{preview.label}</li>
                  ))}
                </ul>
              ) : null}
            </RelatedList>
          </>
        ) : null}
      </IntelligenceInspector>
      <SourceDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} items={drawerItems} />
    </div>
  );
}

function IssueCard({
  issue,
  onOpenSources,
}: {
  issue: EvidenceMatrixIssue;
  onOpenSources: (items: SourceDrawerItem[]) => void;
}) {
  const supporting = issue.supporting ?? [];
  const contrary = issue.contrary ?? [];
  return (
    <li className="rounded-xl border border-line bg-white/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ink">{issue.label ?? "Issue"}</h3>
        {contrary.length > 0 ? <TrustStatus kind="disputed" /> : <TrustStatus kind="verified" />}
      </div>
      {supporting[0]?.rationale ? (
        <p className="mt-2 text-sm text-ink/75">
          <span className="font-semibold">Supports: </span>
          {supporting[0].rationale}
        </p>
      ) : null}
      {contrary[0]?.rationale ? (
        <p className="mt-1 text-sm text-ink/75">
          <span className="font-semibold">Conflicts with: </span>
          {contrary[0].rationale}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-2 text-xs font-semibold text-accent underline"
        onClick={() =>
          onOpenSources(
            [...supporting, ...contrary].map((s, i) => ({
              id: `${issue.issueKey ?? "issue"}-${i}`,
              title: "Source",
              classLabel: "Matter Evidence",
              quote: s.rationale,
              documentId: s.documentId ?? undefined,
            })),
          )
        }
      >
        {sourceCountLabel(supporting.length + contrary.length)}
      </button>
    </li>
  );
}

function DocumentList({
  docs,
  emptyTitle,
  emptyDescription,
  entityName,
  selectedId,
  onSelect,
}: {
  docs: EvidenceDocumentRow[];
  emptyTitle: string;
  emptyDescription: string;
  entityName: (id: string | undefined) => string;
  selectedId?: string;
  onSelect: (row: EvidenceDocumentRow) => void;
}) {
  if (docs.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  return (
    <ul className="space-y-2">
      {docs.map((row) => {
        const doc = row.document ?? row;
        const previews = unwrapEvidencePreviews({
          ...row,
          linkedEntities: (row.linkedEntities ?? []).map((item: any) => ({
            ...item,
            displayName: item.displayName ?? entityName(item.entityId ?? item.entity?.id),
          })),
        });
        const summary = evidenceLinkSummary(previews);
        const id = doc.id;
        return (
          <li key={id}>
            <button
              type="button"
              className={`w-full rounded-lg border px-4 py-3 text-left ${
                selectedId === id
                  ? "border-accent bg-accent-soft/40"
                  : "border-line bg-white hover:bg-accent-soft/20"
              }`}
              onClick={() => onSelect(row)}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-sm">{doc.title}</span>
                {row.important || row.reviewState?.important ? (
                  <TrustStatus kind="verified" />
                ) : null}
              </div>
              {previews.length === 0 ? (
                <p className="mt-1 text-xs text-ink/50">No extracted case connections yet.</p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-ink/55">{summary}</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-ink/75">
                    {previews.slice(0, 3).map((preview, i) => (
                      <li key={`${id}-${i}`}>{preview.label}</li>
                    ))}
                  </ul>
                </>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
