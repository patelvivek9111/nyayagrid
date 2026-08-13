"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Panel, Badge, Button } from "@nyayagrid/ui";
import { EmptyState, ErrorState, LoadingState, SuggestedBadge } from "@/components/ux";

type Doc = {
  id: string;
  title: string;
  processingState: string;
  malwareScanStatus: string;
  processingError: string | null;
  latestVersionId: string | null;
};

async function fetchJson(input: string, init?: RequestInit) {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

export default function MatterDocumentsPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [docs, setDocs] = useState<Doc[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [docAId, setDocAId] = useState("");
  const [docBId, setDocBId] = useState("");
  const [compareBusy, setCompareBusy] = useState(false);
  const [comparisons, setComparisons] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);

  const readyDocs = docs.filter((d) => Boolean(d.latestVersionId));

  async function refreshDocs() {
    const data = await fetchJson(`/api/v1/matters/${matterId}/documents`);
    setDocs(data.documents ?? []);
  }

  async function refreshComparisons() {
    const data = await fetchJson(`/api/v1/matters/${matterId}/analysis/comparisons`);
    setComparisons(data.comparisons ?? []);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([refreshDocs(), refreshComparisons()])
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [matterId]);

  async function onUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage("");
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/v1/matters/${matterId}/documents`, {
        method: "POST",
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Upload failed");
      setMessage(
        `Uploaded. Processing state: ${data.document?.processingState ?? data.processing?.state}`,
      );
      await refreshDocs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  }

  async function selectComparison(comparisonId: string) {
    try {
      const json = await fetchJson(
        `/api/v1/matters/${matterId}/analysis/comparisons/${comparisonId}`,
      );
      setSelected(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load comparison");
    }
  }

  async function runComparison() {
    const docA = docs.find((d) => d.id === docAId);
    const docB = docs.find((d) => d.id === docBId);
    if (!docA?.latestVersionId || !docB?.latestVersionId) {
      setError("Select two ready documents to compare");
      return;
    }
    setCompareBusy(true);
    setError("");
    try {
      const json = await fetchJson(`/api/v1/matters/${matterId}/analysis/comparisons`, {
        method: "POST",
        body: JSON.stringify({
          documentAId: docA.id,
          versionAId: docA.latestVersionId,
          documentBId: docB.id,
          versionBId: docB.latestVersionId,
        }),
      });
      await refreshComparisons();
      await selectComparison(json.comparison.id);
      setMessage("Comparison saved. Changes below are proposals for attorney review.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setCompareBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-xl text-ink">Documents</h2>
        <p className="text-sm text-ink/60">
          Case file room — upload, track processing, and compare versions for material changes.
        </p>
      </div>

      <Panel title="Upload document">
        <p className="mb-3 text-sm text-ink/70">
          Supported: PDF (native text), DOCX, TXT. OCR is not enabled in Phase 2.
        </p>
        <input type="file" accept=".pdf,.docx,.txt,.md" onChange={onUpload} disabled={uploading} />
        {message ? <p className="mt-3 text-sm text-accent">{message}</p> : null}
        {error ? <ErrorState message={error} /> : null}
      </Panel>

      {loading ? <LoadingState label="Loading documents…" /> : null}

      <Panel title="Matter documents">
        {docs.length === 0 ? (
          <EmptyState
            title="No documents uploaded"
            description="Upload a PDF, DOCX, or text file to ground Case Chat and analysis."
          />
        ) : (
          <ul className="space-y-3">
            {docs.map((doc) => (
              <li key={doc.id} className="rounded border border-line px-3 py-3 text-sm">
                <div className="font-semibold">{doc.title}</div>
                <div className="mt-1 flex flex-wrap gap-2">
                  <Badge>{doc.processingState}</Badge>
                  <Badge>{doc.malwareScanStatus}</Badge>
                </div>
                {doc.processingError ? (
                  <p className="mt-2 text-[var(--ng-danger)]">{doc.processingError}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Compare versions">
        <p className="mb-3 text-sm text-ink/70">
          Pick two ready documents (or versions) to surface material differences. Diffs are
          deterministic; any AI summary is a proposal — not auto-approved.
        </p>
        {readyDocs.length < 2 ? (
          <p className="text-sm text-ink/60">
            Upload at least two processed documents to run a comparison.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-ink/60">
                Document A
                <select
                  className="mt-1 w-full rounded border border-line bg-white px-2 py-2 text-sm"
                  value={docAId}
                  onChange={(e) => setDocAId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {readyDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-xs font-semibold uppercase tracking-wide text-ink/60">
                Document B
                <select
                  className="mt-1 w-full rounded border border-line bg-white px-2 py-2 text-sm"
                  value={docBId}
                  onChange={(e) => setDocBId(e.target.value)}
                >
                  <option value="">Select…</option>
                  {readyDocs.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="button"
                disabled={compareBusy || !docAId || !docBId || docAId === docBId}
                onClick={runComparison}
              >
                {compareBusy ? "Comparing…" : "Compare"}
              </Button>
              <div className="border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Past comparisons
                </p>
                {comparisons.length === 0 ? (
                  <p className="text-sm text-ink/55">None yet.</p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {comparisons.map((c) => (
                      <li key={c.comparison.id}>
                        <button
                          type="button"
                          className={`w-full rounded border px-2 py-1.5 text-left ${
                            selected?.comparison.id === c.comparison.id
                              ? "border-accent bg-accent-soft/50"
                              : "border-line bg-white"
                          }`}
                          onClick={() => selectComparison(c.comparison.id)}
                        >
                          {c.comparison.summary?.slice(0, 60) ?? "Comparison"} ·{" "}
                          {c.changes.length} change(s)
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Changes</p>
                {selected ? <SuggestedBadge>Proposal</SuggestedBadge> : null}
                {selected?.summaryScore?.alignment ? (
                  <Badge>
                    Summary {selected.summaryScore.alignment}
                    {typeof selected.summaryScore.score === "number"
                      ? ` · ${Math.round(selected.summaryScore.score * 100)}%`
                      : ""}
                  </Badge>
                ) : null}
              </div>
              {!selected ? (
                <p className="text-sm text-ink/70">Select or run a comparison to view changes.</p>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-ink/55">
                    Diffs are deterministic. Any AI summary is a proposal — verify claims against the
                    change list{selected.summaryScore?.alignment &&
                    selected.summaryScore.alignment !== "aligned"
                      ? " (summary not fully aligned with the diff)"
                      : ""}
                    .
                  </p>
                  {selected.comparison.summary ? (
                    <p className="whitespace-pre-wrap text-sm text-ink/80">
                      {selected.comparison.summary}
                    </p>
                  ) : (
                    <p className="text-sm text-ink/60">
                      No AI summary — reviewing deterministic diffs.
                    </p>
                  )}
                  {selected.summaryScore?.unsupportedClaims?.length ? (
                    <div className="rounded border border-amber-700/25 bg-amber-50/70 px-3 py-2 text-xs text-ink/75">
                      <p className="font-semibold">Flagged summary claims (not in diff digest)</p>
                      <ul className="mt-1 list-inside list-disc">
                        {selected.summaryScore.unsupportedClaims.map((claim: string) => (
                          <li key={claim}>{claim}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {(selected.changes ?? []).length === 0 ? (
                    <p className="text-sm text-ink/70">No substantive paragraph differences detected.</p>
                  ) : (
                    <ul className="space-y-3 text-sm">
                      {selected.changes.map((c: any) => (
                        <li key={c.id} className="rounded border border-line p-3">
                          <div className="flex items-center justify-between gap-2">
                            <Badge>{c.changeType}</Badge>
                            <Badge>{c.attention}</Badge>
                          </div>
                          {c.oldText ? (
                            <p className="mt-2 text-xs">
                              <span className="font-semibold text-ink/60">Old: </span>
                              {c.oldText}
                            </p>
                          ) : null}
                          {c.newText ? (
                            <p className="mt-1 text-xs">
                              <span className="font-semibold text-ink/60">New: </span>
                              {c.newText}
                            </p>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-ink/50">
          Full analysis tools remain on{" "}
          <Link href={`/app/cases/${matterId}/analysis`} className="text-accent underline">
            Analysis
          </Link>
          .
        </p>
      </Panel>
    </div>
  );
}
