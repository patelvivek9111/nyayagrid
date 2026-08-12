"use client";

import { useEffect, useState, type FormEvent } from "react";
import { PublicShell } from "@/components/shell";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type DocumentRow = {
  id: string;
  title: string;
  documentKind: string | null;
  processingState: string;
  createdAt: string;
};

type ExplicitDate = { rawText: string; isoDate: string | null; label?: string | null };

type ExplanationContent = {
  plainLanguageSummary: string;
  obligations: string[];
  rightsMentioned: string[];
  risksOrUnusualLanguage: string[];
  termsNeedingClarification: string[];
  questionsForALawyer: string[];
  limitations: string[];
};

type SourceRef = { provenance: string; quote?: string | null };

const DOCUMENT_KINDS = [
  { value: "lease", label: "Lease" },
  { value: "employment", label: "Employment" },
  { value: "court_notice", label: "Court notice" },
  { value: "demand", label: "Demand letter" },
  { value: "settlement", label: "Settlement" },
  { value: "other", label: "Other" },
];

export default function GuideExplainPage() {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [documentId, setDocumentId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [documentKind, setDocumentKind] = useState("other");
  const [content, setContent] = useState("");
  const [explanation, setExplanation] = useState<ExplanationContent | null>(null);
  const [explicitDates, setExplicitDates] = useState<ExplicitDate[]>([]);
  const [sources, setSources] = useState<SourceRef[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refreshDocuments() {
    const res = await fetch("/api/v1/guide/documents");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load documents");
    setDocuments(data.documents ?? []);
  }

  useEffect(() => {
    refreshDocuments().catch((err) =>
      setError(err instanceof Error ? err.message : "Failed to load"),
    );
  }, []);

  async function ingest(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/v1/guide/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, documentKind, content }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to add document");
      setDocumentId(data.document.id);
      setTitle("");
      setContent("");
      await refreshDocuments();
      await explain(data.document.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add document");
    } finally {
      setBusy(false);
    }
  }

  async function explain(id: string) {
    if (!id) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/guide/documents/${id}/explain`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to explain document");
      setExplanation(data.record?.explanation ?? null);
      setExplicitDates(data.record?.explicitDates ?? []);
      setSources(data.record?.sources ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to explain document");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PublicShell>
      <PageHeader
        eyebrow="Nyaya Guide"
        title="Explain a document"
        description="Paste a lease, employment letter, court notice, or similar document to get a plain-language explanation. Only dates and amounts actually written in the text are reported — nothing is calculated."
      />
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Panel title="Add a document">
            <form className="flex flex-col gap-3" onSubmit={ingest}>
              <input
                className="rounded border border-line px-3 py-2 text-sm"
                placeholder="Document title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
              <select
                className="rounded border border-line px-3 py-2 text-sm"
                value={documentKind}
                onChange={(e) => setDocumentKind(e.target.value)}
              >
                {DOCUMENT_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
              <textarea
                className="min-h-[200px] rounded border border-line px-3 py-2 text-sm"
                placeholder="Paste the document text here…"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
              <Button type="submit" disabled={busy}>
                {busy ? "Working…" : "Add & explain"}
              </Button>
            </form>
          </Panel>

          <Panel title="Your documents">
            {documents.length === 0 ? (
              <p className="text-sm text-ink/70">No documents yet.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {documents.map((document) => (
                  <li
                    key={document.id}
                    className="flex items-center justify-between rounded border border-line px-3 py-2"
                  >
                    <button
                      className="text-left font-semibold text-accent underline"
                      onClick={() => {
                        setDocumentId(document.id);
                        explain(document.id);
                      }}
                    >
                      {document.title}
                    </button>
                    <Badge>{document.documentKind ?? "other"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Explanation">
          {!explanation ? (
            <p className="text-sm text-ink/70">
              Add a document, or select one on the left, to see its explanation here.
            </p>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap text-ink/90">{explanation.plainLanguageSummary}</p>

              {explicitDates.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
                    Dates found in the document
                  </p>
                  <ul className="space-y-1">
                    {explicitDates.map((date, i) => (
                      <li key={i} className="rounded border border-line px-2 py-1">
                        <span className="font-semibold">{date.label ?? "Date"}:</span>{" "}
                        {date.isoDate ?? date.rawText}{" "}
                        <span className="text-ink/50">(&ldquo;{date.rawText}&rdquo;)</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {explanation.obligations.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
                    Obligations
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {explanation.obligations.map((o, i) => (
                      <li key={i}>{o}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {explanation.risksOrUnusualLanguage.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
                    Risks or unusual language
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {explanation.risksOrUnusualLanguage.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {explanation.questionsForALawyer.length > 0 ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">
                    Questions for a lawyer
                  </p>
                  <ul className="list-disc space-y-1 pl-5">
                    {explanation.questionsForALawyer.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {sources.length > 0 ? (
                <div className="border-t border-line/60 pt-2">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink/50">
                    Sources
                  </p>
                  <ul className="space-y-1 text-xs text-ink/60">
                    {sources.map((source, i) => (
                      <li key={i}>&ldquo;{source.quote}&rdquo;</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {explanation.limitations.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-xs text-ink/50">
                  {explanation.limitations.map((limitation, i) => (
                    <li key={i}>{limitation}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </Panel>
      </div>
    </PublicShell>
  );
}
