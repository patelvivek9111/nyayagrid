"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MatterShell } from "@/components/shell";
import { Badge, Button, Panel } from "@nyayagrid/ui";

type DocumentRow = {
  id: string;
  title: string;
  processingState: string;
  latestVersionId: string | null;
  latestVersionNumber: number | null;
};

const TABS = ["contracts", "comparisons", "depositions", "evidence", "discovery"] as const;
type Tab = (typeof TABS)[number];

async function fetchJson(input: string, init?: RequestInit) {
  const res = await fetch(input, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? "Request failed");
  return json;
}

export default function MatterAnalysisPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;

  const [tab, setTab] = useState<Tab>("contracts");
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson(`/api/v1/matters/${matterId}/documents`)
      .then((json) => setDocuments(json.documents ?? []))
      .catch((err) => setError(err.message));
  }, [matterId]);

  return (
    <MatterShell matterId={matterId} title="Analysis">
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold capitalize ${
              tab === t ? "border-accent bg-accent-soft/50" : "border-line bg-white"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "contracts" ? (
        <ContractsSection matterId={matterId} documents={documents} onError={setError} />
      ) : null}
      {tab === "comparisons" ? (
        <ComparisonsSection matterId={matterId} documents={documents} onError={setError} />
      ) : null}
      {tab === "depositions" ? (
        <DepositionsSection matterId={matterId} documents={documents} onError={setError} />
      ) : null}
      {tab === "evidence" ? <EvidenceSection matterId={matterId} onError={setError} /> : null}
      {tab === "discovery" ? <DiscoverySection matterId={matterId} onError={setError} /> : null}
    </MatterShell>
  );
}

function DocumentSelect({
  documents,
  value,
  onChange,
}: {
  documents: DocumentRow[];
  value: string;
  onChange: (documentId: string) => void;
}) {
  return (
    <select
      className="w-full rounded border border-line px-2 py-1.5 text-sm"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Select document…</option>
      {documents.map((d) => (
        <option key={d.id} value={d.id} disabled={!d.latestVersionId}>
          {d.title} {d.latestVersionId ? "" : "(not ready)"}
        </option>
      ))}
    </select>
  );
}

/* ----------------------------- Contracts ----------------------------- */

function ContractsSection({
  matterId,
  documents,
  onError,
}: {
  matterId: string;
  documents: DocumentRow[];
  onError: (msg: string) => void;
}) {
  const [documentId, setDocumentId] = useState("");
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [redlines, setRedlines] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadAnalyses() {
    const json = await fetchJson(`/api/v1/matters/${matterId}/analysis/contracts`);
    setAnalyses(json.analyses ?? []);
  }

  useEffect(() => {
    loadAnalyses().catch((err) => onError(err.message));
  }, [matterId]);

  async function selectAnalysis(analysisId: string) {
    try {
      const json = await fetchJson(`/api/v1/matters/${matterId}/analysis/contracts/${analysisId}`);
      setSelected(json);
      const redlineJson = await fetchJson(
        `/api/v1/matters/${matterId}/analysis/contracts/${analysisId}/redlines`,
      );
      setRedlines(redlineJson.suggestions ?? []);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load analysis");
    }
  }

  async function runAnalysis() {
    const doc = documents.find((d) => d.id === documentId);
    if (!doc?.latestVersionId) {
      onError("Select a ready document to analyze");
      return;
    }
    setBusy(true);
    try {
      const json = await fetchJson(`/api/v1/matters/${matterId}/analysis/contracts`, {
        method: "POST",
        body: JSON.stringify({ documentId: doc.id, documentVersionId: doc.latestVersionId }),
      });
      await loadAnalyses();
      await selectAnalysis(json.analysis.analysis.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewItem(itemId: string, action: "reviewed" | "dismissed") {
    if (!selected) return;
    setBusy(true);
    try {
      await fetchJson(
        `/api/v1/matters/${matterId}/analysis/contracts/${selected.analysis.id}/items/${itemId}/review`,
        { method: "POST", body: JSON.stringify({ action }) },
      );
      await selectAnalysis(selected.analysis.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateRedlines() {
    if (!selected) return;
    setBusy(true);
    try {
      await fetchJson(
        `/api/v1/matters/${matterId}/analysis/contracts/${selected.analysis.id}/redlines`,
        { method: "POST", body: JSON.stringify({}) },
      );
      await selectAnalysis(selected.analysis.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Redline generation failed");
    } finally {
      setBusy(false);
    }
  }

  async function reviewRedline(suggestionId: string, status: "accepted" | "rejected") {
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/analysis/redlines/${suggestionId}/review`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      if (selected) await selectAnalysis(selected.analysis.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Redline review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="Run contract analysis">
        <div className="space-y-2">
          <DocumentSelect documents={documents} value={documentId} onChange={setDocumentId} />
          <Button disabled={busy || !documentId} onClick={runAnalysis}>
            Analyze contract
          </Button>
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
            Past analyses
          </p>
          <ul className="space-y-2 text-sm">
            {analyses.map((a) => (
              <li key={a.id}>
                <button
                  className={`w-full rounded border px-2 py-1.5 text-left ${
                    selected?.analysis.id === a.id
                      ? "border-accent bg-accent-soft/50"
                      : "border-line bg-white"
                  }`}
                  onClick={() => selectAnalysis(a.id)}
                >
                  {a.summary?.slice(0, 60) ?? "Contract analysis"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel title="Analysis items">
        {!selected ? (
          <p className="text-sm text-ink/70">Select an analysis to view items.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {selected.items.map((item: any) => (
              <li key={item.id} className="rounded border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{item.title}</span>
                  <Badge>{item.attention}</Badge>
                </div>
                <p className="mt-1 text-xs uppercase tracking-wide text-ink/50">
                  {item.category} · {item.status}
                </p>
                {item.originalText ? (
                  <div className="mt-2 rounded bg-black/[0.03] p-2 text-xs">
                    <p className="font-semibold text-ink/60">Original text</p>
                    <p>{item.originalText}</p>
                  </div>
                ) : null}
                {item.explanation ? (
                  <div className="mt-2 text-xs">
                    <p className="font-semibold text-ink/60">Nyaya's explanation</p>
                    <p>{item.explanation}</p>
                  </div>
                ) : null}
                {item.status === "proposed" ? (
                  <div className="mt-2 flex gap-2">
                    <Button disabled={busy} onClick={() => reviewItem(item.id, "reviewed")}>
                      Mark reviewed
                    </Button>
                    <Button
                      disabled={busy}
                      variant="ghost"
                      onClick={() => reviewItem(item.id, "dismissed")}
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Redline suggestions">
        {!selected ? (
          <p className="text-sm text-ink/70">Select an analysis first.</p>
        ) : (
          <div className="space-y-3">
            <Button disabled={busy} onClick={generateRedlines}>
              Generate redlines with Nyaya
            </Button>
            <ul className="space-y-3 text-sm">
              {redlines.map((r) => (
                <li key={r.id} className="rounded border border-line p-3">
                  <div className="flex items-center justify-between">
                    <Badge>{r.status}</Badge>
                  </div>
                  <div className="mt-2 text-xs">
                    <p className="font-semibold text-ink/60">Current</p>
                    <p>{r.currentClause}</p>
                  </div>
                  <div className="mt-2 text-xs">
                    <p className="font-semibold text-ink/60">Proposed</p>
                    <p>{r.proposedClause}</p>
                  </div>
                  <p className="mt-2 text-xs text-ink/70">{r.reason}</p>
                  {r.status === "proposed" ? (
                    <div className="mt-2 flex gap-2">
                      <Button disabled={busy} onClick={() => reviewRedline(r.id, "accepted")}>
                        Accept
                      </Button>
                      <Button
                        disabled={busy}
                        variant="ghost"
                        onClick={() => reviewRedline(r.id, "rejected")}
                      >
                        Reject
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------- Comparisons ----------------------------- */

function ComparisonsSection({
  matterId,
  documents,
  onError,
}: {
  matterId: string;
  documents: DocumentRow[];
  onError: (msg: string) => void;
}) {
  const [docAId, setDocAId] = useState("");
  const [docBId, setDocBId] = useState("");
  const [comparisons, setComparisons] = useState<any[]>([]);
  const [selected, setSelected] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  async function loadComparisons() {
    const json = await fetchJson(`/api/v1/matters/${matterId}/analysis/comparisons`);
    setComparisons(json.comparisons ?? []);
  }

  useEffect(() => {
    loadComparisons().catch((err) => onError(err.message));
  }, [matterId]);

  async function selectComparison(comparisonId: string) {
    try {
      const json = await fetchJson(
        `/api/v1/matters/${matterId}/analysis/comparisons/${comparisonId}`,
      );
      setSelected(json);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to load comparison");
    }
  }

  async function runComparison() {
    const docA = documents.find((d) => d.id === docAId);
    const docB = documents.find((d) => d.id === docBId);
    if (!docA?.latestVersionId || !docB?.latestVersionId) {
      onError("Select two ready documents to compare");
      return;
    }
    setBusy(true);
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
      await loadComparisons();
      await selectComparison(json.comparison.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Comparison failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Compare document versions">
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Document A</p>
          <DocumentSelect documents={documents} value={docAId} onChange={setDocAId} />
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/60">Document B</p>
          <DocumentSelect documents={documents} value={docBId} onChange={setDocBId} />
          <Button disabled={busy || !docAId || !docBId} onClick={runComparison}>
            Compare
          </Button>
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
            Past comparisons
          </p>
          <ul className="space-y-2 text-sm">
            {comparisons.map((c) => (
              <li key={c.comparison.id}>
                <button
                  className={`w-full rounded border px-2 py-1.5 text-left ${
                    selected?.comparison.id === c.comparison.id
                      ? "border-accent bg-accent-soft/50"
                      : "border-line bg-white"
                  }`}
                  onClick={() => selectComparison(c.comparison.id)}
                >
                  {c.comparison.summary?.slice(0, 60) ?? "Comparison"} · {c.changes.length}{" "}
                  change(s)
                </button>
              </li>
            ))}
          </ul>
        </div>
      </Panel>

      <Panel title="Changes">
        {!selected ? (
          <p className="text-sm text-ink/70">Select a comparison to view changes.</p>
        ) : (
          <div className="space-y-3">
            {selected.comparison.summary ? (
              <p className="text-sm text-ink/80">{selected.comparison.summary}</p>
            ) : null}
            <ul className="space-y-3 text-sm">
              {selected.changes.map((c: any) => (
                <li key={c.id} className="rounded border border-line p-3">
                  <div className="flex items-center justify-between">
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
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------- Depositions ----------------------------- */

function DepositionsSection({
  matterId,
  documents,
  onError,
}: {
  matterId: string;
  documents: DocumentRow[];
  onError: (msg: string) => void;
}) {
  const [documentId, setDocumentId] = useState("");
  const [findings, setFindings] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function loadFindings() {
    const json = await fetchJson(
      `/api/v1/matters/${matterId}/analysis/findings?runType=deposition,contradiction`,
    );
    setFindings(json.findings ?? []);
  }

  useEffect(() => {
    loadFindings().catch((err) => onError(err.message));
  }, [matterId]);

  async function analyzeDeposition() {
    const doc = documents.find((d) => d.id === documentId);
    if (!doc?.latestVersionId) {
      onError("Select a ready document to analyze");
      return;
    }
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/analysis/depositions`, {
        method: "POST",
        body: JSON.stringify({ documentId: doc.id, documentVersionId: doc.latestVersionId }),
      });
      await loadFindings();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Deposition analysis failed");
    } finally {
      setBusy(false);
    }
  }

  async function detectContradictions() {
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/analysis/contradictions`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadFindings();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Contradiction detection failed");
    } finally {
      setBusy(false);
    }
  }

  async function review(findingId: string, action: "reviewed" | "dismissed") {
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/analysis/findings/${findingId}/review`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      await loadFindings();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Review failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Run analysis">
        <div className="space-y-2">
          <DocumentSelect documents={documents} value={documentId} onChange={setDocumentId} />
          <Button disabled={busy || !documentId} onClick={analyzeDeposition}>
            Analyze deposition
          </Button>
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs text-ink/70">
            Detect contradictions across all matter documents (or scope to the selected document).
          </p>
          <Button disabled={busy} variant="secondary" onClick={detectContradictions}>
            Detect contradictions
          </Button>
        </div>
      </Panel>

      <Panel title="Findings">
        {findings.length === 0 ? (
          <p className="text-sm text-ink/70">No findings yet.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {findings.map((f) => (
              <li key={f.id} className="rounded border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{f.title}</span>
                  <Badge>{f.attention}</Badge>
                </div>
                <p className="text-xs uppercase tracking-wide text-ink/50">
                  {f.findingType} · {f.confidence} confidence · {f.status}
                </p>
                {f.explanation ? <p className="mt-1">{f.explanation}</p> : null}
                {f.status === "proposed" ? (
                  <div className="mt-2 flex gap-2">
                    <Button disabled={busy} onClick={() => review(f.id, "reviewed")}>
                      Mark reviewed
                    </Button>
                    <Button
                      disabled={busy}
                      variant="ghost"
                      onClick={() => review(f.id, "dismissed")}
                    >
                      Dismiss
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------- Evidence ----------------------------- */

function EvidenceSection({
  matterId,
  onError,
}: {
  matterId: string;
  onError: (msg: string) => void;
}) {
  const [data, setData] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const json = await fetchJson(`/api/v1/matters/${matterId}/evidence`);
    setData(json);
  }

  useEffect(() => {
    load().catch((err) => onError(err.message));
  }, [matterId]);

  async function toggleImportant(documentId: string, important: boolean) {
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/evidence/documents/${documentId}/important`, {
        method: "POST",
        body: JSON.stringify({ important }),
      });
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <p className="text-sm text-ink/70">Loading evidence intelligence…</p>;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="Documents">
        <ul className="space-y-2 text-sm">
          {data.documents.map((d: any) => (
            <li
              key={d.document.id}
              className="flex items-center justify-between rounded border border-line p-2"
            >
              <div>
                <p className="font-semibold">{d.document.title}</p>
                <p className="text-xs text-ink/60">
                  {d.linkedEvents.length} event(s) · {d.linkedFacts.length} fact(s)
                </p>
              </div>
              <Button
                variant={d.important ? "primary" : "ghost"}
                disabled={busy}
                onClick={() => toggleImportant(d.document.id, !d.important)}
              >
                {d.important ? "Important" : "Mark important"}
              </Button>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="Evidence matrix">
        {data.evidenceMatrix.issues.length === 0 ? (
          <p className="text-sm text-ink/70">No verified facts or events to map yet.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {data.evidenceMatrix.issues.map((issue: any) => (
              <li key={issue.issueKey} className="rounded border border-line p-3">
                <p className="font-semibold">{issue.label}</p>
                <p className="mt-1 text-xs text-ink/60">
                  {issue.supporting.length} supporting · {issue.contrary.length} contrary ·{" "}
                  {issue.gaps.length} gap(s)
                </p>
                {issue.gaps.map((g: any, idx: number) => (
                  <p key={idx} className="mt-1 text-xs text-[var(--ng-danger)]">
                    Gap: {g.rationale}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ----------------------------- Discovery ----------------------------- */

const RELEVANCE_OPTIONS = ["unknown", "relevant", "not_relevant"];
const PRIVILEGE_OPTIONS = ["unknown", "potentially_privileged", "privileged", "not_privileged"];
const RESPONSIVENESS_OPTIONS = ["unknown", "responsive", "not_responsive"];
const CONFIDENTIALITY_OPTIONS = ["unknown", "confidential", "not_confidential"];

function DiscoverySection({
  matterId,
  onError,
}: {
  matterId: string;
  onError: (msg: string) => void;
}) {
  const [items, setItems] = useState<any[]>([]);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [tags, setTags] = useState<any[]>([]);
  const [newTagLabel, setNewTagLabel] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadQueue() {
    const json = await fetchJson(
      `/api/v1/matters/${matterId}/discovery?pendingOnly=${pendingOnly}`,
    );
    setItems(json.items ?? []);
  }

  async function loadTags() {
    const json = await fetchJson(`/api/v1/matters/${matterId}/discovery/tags`);
    setTags(json.tags ?? []);
  }

  useEffect(() => {
    loadQueue().catch((err) => onError(err.message));
    loadTags().catch((err) => onError(err.message));
  }, [matterId, pendingOnly]);

  async function updateReview(documentId: string, patch: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/discovery/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      await loadQueue();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function proposeClassification(documentId: string) {
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/discovery/documents/${documentId}/classify`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      await loadQueue();
    } catch (err) {
      onError(err instanceof Error ? err.message : "AI proposal failed");
    } finally {
      setBusy(false);
    }
  }

  async function createTag() {
    if (!newTagLabel.trim()) return;
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/discovery/tags`, {
        method: "POST",
        body: JSON.stringify({ label: newTagLabel }),
      });
      setNewTagLabel("");
      await loadTags();
    } catch (err) {
      onError(err instanceof Error ? err.message : "Tag creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function assignTag(documentId: string, tagId: string) {
    setBusy(true);
    try {
      await fetchJson(`/api/v1/matters/${matterId}/discovery/tags/assign`, {
        method: "POST",
        body: JSON.stringify({ documentId, tagId }),
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Tag assignment failed");
    } finally {
      setBusy(false);
    }
  }

  async function detectDuplicates(near: boolean) {
    setBusy(true);
    try {
      const json = await fetchJson(`/api/v1/matters/${matterId}/discovery/duplicates`, {
        method: "POST",
        body: JSON.stringify({ near }),
      });
      onError("");
      alert(
        `Exact duplicates: ${json.exact.groupsCreated} group(s), ${json.exact.membersAdded} member(s)` +
          (json.near
            ? `\nNear duplicates: ${json.near.groupsCreated} group(s), ${json.near.membersAdded} member(s)`
            : ""),
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Duplicate detection failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <Panel title="Tags">
        <div className="flex flex-wrap items-center gap-2">
          {tags.map((t) => (
            <Badge key={t.id}>{t.label}</Badge>
          ))}
          <input
            className="rounded border border-line px-2 py-1 text-sm"
            placeholder="New tag label"
            value={newTagLabel}
            onChange={(e) => setNewTagLabel(e.target.value)}
          />
          <Button disabled={busy} onClick={createTag}>
            Add tag
          </Button>
          <Button disabled={busy} variant="ghost" onClick={() => detectDuplicates(false)}>
            Detect exact duplicates
          </Button>
          <Button disabled={busy} variant="ghost" onClick={() => detectDuplicates(true)}>
            Detect exact + near duplicates
          </Button>
        </div>
      </Panel>

      <Panel title="Review queue">
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={pendingOnly}
            onChange={(e) => setPendingOnly(e.target.checked)}
          />
          Show only pending review
        </label>
        {items.length === 0 ? (
          <p className="text-sm text-ink/70">No documents in the discovery queue.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {items.map(({ document, reviewState }: any) => (
              <li key={document.id} className="rounded border border-line p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{document.title}</span>
                  <Button
                    disabled={busy}
                    variant="ghost"
                    onClick={() => proposeClassification(document.id)}
                  >
                    AI propose (review required)
                  </Button>
                </div>
                {reviewState?.aiProposalNote ? (
                  <p className="mt-1 rounded bg-black/[0.03] p-2 text-xs">
                    <span className="font-semibold">Nyaya proposal — not final:</span>{" "}
                    {reviewState.aiProposalNote} (relevance: {reviewState.aiRelevance ?? "n/a"},
                    privilege: {reviewState.aiPrivilege ?? "n/a"})
                  </p>
                ) : null}
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <select
                    className="rounded border border-line px-2 py-1 text-xs"
                    value={reviewState?.relevance ?? "unknown"}
                    onChange={(e) => updateReview(document.id, { relevance: e.target.value })}
                  >
                    {RELEVANCE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        relevance: {o}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border border-line px-2 py-1 text-xs"
                    value={reviewState?.privilege ?? "unknown"}
                    onChange={(e) =>
                      updateReview(document.id, {
                        privilege: e.target.value,
                        humanPrivilegeFinal: e.target.value !== "unknown",
                      })
                    }
                  >
                    {PRIVILEGE_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        privilege: {o}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border border-line px-2 py-1 text-xs"
                    value={reviewState?.responsiveness ?? "unknown"}
                    onChange={(e) => updateReview(document.id, { responsiveness: e.target.value })}
                  >
                    {RESPONSIVENESS_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        responsiveness: {o}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border border-line px-2 py-1 text-xs"
                    value={reviewState?.confidentiality ?? "unknown"}
                    onChange={(e) => updateReview(document.id, { confidentiality: e.target.value })}
                  >
                    {CONFIDENTIALITY_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        confidentiality: {o}
                      </option>
                    ))}
                  </select>
                </div>
                {tags.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {tags.map((t) => (
                      <Button
                        key={t.id}
                        variant="ghost"
                        disabled={busy}
                        onClick={() => assignTag(document.id, t.id)}
                      >
                        + {t.label}
                      </Button>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
