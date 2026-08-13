"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { Badge, Button, Panel } from "@nyayagrid/ui";
import { EmptyState, ErrorState, LoadingState, SuggestedBadge } from "@/components/ux";

const DRAFT_TYPES = [
  "demand_letter",
  "complaint",
  "motion",
  "brief",
  "contract",
  "settlement_agreement",
  "discovery_request",
  "correspondence",
  "memo",
  "other",
];

type DraftVersion = {
  id: string;
  versionNumber: number;
  content: string;
  changeSummary: string | null;
  origin: string;
  sourceAssertions: Array<{
    text: string;
    chunkIds: string[];
    provenanceClass?: "FACT_SOURCE" | "LEGAL_AUTHORITY";
  }>;
  createdAt: string;
};

type Draft = {
  id: string;
  title: string;
  draftType: string;
  status: string;
  currentVersionNumber: number;
  aiGenerated: boolean;
  updatedAt: string;
  sourceContext?: {
    documentIds?: string[];
    assumptions?: string[];
    unresolvedPlaceholders?: string[];
    insufficientSourceMaterial?: boolean;
  } | null;
};

type MatterDoc = { id: string; title: string };

export default function CaseDraftPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [docs, setDocs] = useState<MatterDoc[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState("");
  const [draftType, setDraftType] = useState("demand_letter");
  const [content, setContent] = useState("");
  const [instructions, setInstructions] = useState("");

  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [selectedDraft, setSelectedDraft] = useState<Draft | null>(null);
  const [versions, setVersions] = useState<DraftVersion[]>([]);
  const [editContent, setEditContent] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [sectionHint, setSectionHint] = useState("");

  async function loadDrafts() {
    const res = await fetch(`/api/v1/matters/${matterId}/drafts`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load drafts");
    setDrafts(json.drafts ?? []);
  }

  async function loadDocuments() {
    const res = await fetch(`/api/v1/matters/${matterId}/documents?limit=50`);
    const json = await res.json();
    if (!res.ok) return;
    const items: MatterDoc[] = (json.items ?? json.documents ?? []).map(
      (d: { id: string; title: string }) => ({ id: d.id, title: d.title }),
    );
    setDocs(items);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadDrafts(), loadDocuments()])
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load drafts"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  async function loadDraft(draftId: string) {
    const res = await fetch(`/api/v1/matters/${matterId}/drafts/${draftId}`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load draft");
    setSelectedDraft(json.draft);
    setVersions(json.versions ?? []);
    const current = (json.versions ?? []).find(
      (v: DraftVersion) => v.versionNumber === json.draft.currentVersionNumber,
    );
    setEditContent(current?.content ?? "");
  }

  async function selectDraft(draftId: string) {
    setSelectedDraftId(draftId);
    setError("");
    try {
      await loadDraft(draftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load draft");
    }
  }

  async function createDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, draftType, content }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Create failed");
      setTitle("");
      setContent("");
      await loadDrafts();
      await selectDraft(json.draft.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateDraft() {
    if (!title.trim()) {
      setError("Title is required to generate a draft");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/drafts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "generate",
          title,
          draftType,
          instructions,
          documentIds: selectedDocIds.length > 0 ? selectedDocIds : undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Generate failed");
      setTitle("");
      setInstructions("");
      await loadDrafts();
      await selectDraft(json.draft.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generate failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveVersion() {
    if (!selectedDraftId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/drafts/${selectedDraftId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent, changeSummary: changeSummary || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Save failed");
      setChangeSummary("");
      await loadDrafts();
      await loadDraft(selectedDraftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function transform(action: "shorten" | "expand" | "change_tone" | "regenerate") {
    if (!selectedDraftId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/drafts/${selectedDraftId}/transform`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, sectionHint: sectionHint || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Transform failed");
      await loadDrafts();
      await loadDraft(selectedDraftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transform failed");
    } finally {
      setBusy(false);
    }
  }

  async function restoreVersion(versionId: string) {
    if (!selectedDraftId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/drafts/${selectedDraftId}/restore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Restore failed");
      await loadDrafts();
      await loadDraft(selectedDraftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  async function markAttorneyReviewed() {
    if (!selectedDraftId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/drafts/${selectedDraftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "in_review" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Status update failed");
      await loadDrafts();
      await loadDraft(selectedDraftId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Status update failed");
    } finally {
      setBusy(false);
    }
  }

  const currentVersion = versions.find(
    (v) => v.versionNumber === selectedDraft?.currentVersionNumber,
  );
  const assumptions = selectedDraft?.sourceContext?.assumptions ?? [];
  const unresolved = selectedDraft?.sourceContext?.unresolvedPlaceholders ?? [];
  const insufficient = Boolean(selectedDraft?.sourceContext?.insufficientSourceMaterial);
  const needsAttorneyReview =
    Boolean(selectedDraft?.aiGenerated) && selectedDraft?.status === "draft";

  const sortedVersions = useMemo(
    () => [...versions].sort((a, b) => b.versionNumber - a.versionNumber),
    [versions],
  );

  if (loading) return <LoadingState label="Loading drafts…" />;

  return (
    <div className="space-y-4">
      {error ? <ErrorState message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Drafts" className="lg:col-span-1">
          {drafts.length === 0 ? (
            <EmptyState
              title="No drafts yet"
              description="Create a manual draft or generate one from Case documents."
            />
          ) : (
            <ul className="mb-4 space-y-2 text-sm">
              {drafts.map((d) => (
                <li key={d.id}>
                  <button
                    className={`w-full rounded border px-2 py-1.5 text-left ${
                      selectedDraftId === d.id
                        ? "border-accent bg-accent-soft/50"
                        : "border-line bg-white"
                    }`}
                    onClick={() => selectDraft(d.id)}
                  >
                    <div className="font-semibold">{d.title}</div>
                    <div className="text-xs text-ink/60">
                      {d.draftType} · v{d.currentVersionNumber} · {d.status}
                      {d.aiGenerated ? " · AI" : ""}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form className="space-y-2 border-t border-line pt-3" onSubmit={createDraft}>
            <input
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Title"
              aria-label="Draft title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <select
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              aria-label="Draft type"
              value={draftType}
              onChange={(e) => setDraftType(e.target.value)}
            >
              {DRAFT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <textarea
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Initial content (optional for manual draft)"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={3}
            />
            <textarea
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Instructions for Nyaya (used when generating)"
              aria-label="Draft generation instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
            />
            <fieldset className="rounded border border-line p-2">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-ink/60">
                Source documents
              </legend>
              {docs.length === 0 ? (
                <p className="text-xs text-ink/55">No Case documents yet. Generate will say so.</p>
              ) : (
                <ul className="max-h-32 space-y-1 overflow-auto text-sm">
                  {docs.map((doc) => (
                    <li key={doc.id}>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(doc.id)}
                          onChange={(e) => {
                            setSelectedDocIds((prev) =>
                              e.target.checked
                                ? [...prev, doc.id]
                                : prev.filter((id) => id !== doc.id),
                            );
                          }}
                        />
                        <span>{doc.title}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[11px] text-ink/50">
                Leave unchecked to use all Case documents. Empty selection with no chunks records
                insufficient source material.
              </p>
            </fieldset>
            <div className="flex gap-2">
              <Button disabled={busy} type="submit">
                Create manual draft
              </Button>
              <Button disabled={busy} variant="secondary" type="button" onClick={generateDraft}>
                Generate with Nyaya
              </Button>
            </div>
          </form>
        </Panel>

        <Panel title="Content" className="lg:col-span-1">
          {!selectedDraft ? (
            <p className="text-sm text-ink/70">Select a draft to view and edit its content.</p>
          ) : (
            <div className="space-y-3">
              {needsAttorneyReview ? (
                <div
                  className="rounded-lg border border-amber-700/30 bg-amber-50 px-3 py-2 text-sm"
                  role="status"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <SuggestedBadge>Attorney review required</SuggestedBadge>
                    <span className="text-amber-900">
                      AI-generated work product. Status stays draft until you mark it reviewed.
                      NyayaGrid does not send or file this document.
                    </span>
                  </div>
                  <Button
                    className="mt-2"
                    type="button"
                    disabled={busy}
                    onClick={markAttorneyReviewed}
                  >
                    Mark attorney-reviewed
                  </Button>
                </div>
              ) : selectedDraft.aiGenerated ? (
                <p className="text-xs text-ink/55">
                  AI-originated draft · status {selectedDraft.status}. Still not sent or filed.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{selectedDraft.draftType}</Badge>
                <Badge>v{selectedDraft.currentVersionNumber}</Badge>
                <Badge>{selectedDraft.status}</Badge>
              </div>
              <textarea
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
                aria-label="Draft content"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={16}
              />
              <input
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
                placeholder="Change summary (optional)"
                aria-label="Draft change summary"
                value={changeSummary}
                onChange={(e) => setChangeSummary(e.target.value)}
              />
              <Button disabled={busy} onClick={saveVersion}>
                Save new version
              </Button>

              <div className="border-t border-line pt-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Ask Nyaya to transform
                </p>
                <input
                  className="mb-2 w-full rounded border border-line px-2 py-1.5 text-sm"
                  placeholder="Section hint (optional)"
                  value={sectionHint}
                  onChange={(e) => setSectionHint(e.target.value)}
                />
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} variant="ghost" onClick={() => transform("shorten")}>
                    Shorten
                  </Button>
                  <Button disabled={busy} variant="ghost" onClick={() => transform("expand")}>
                    Expand
                  </Button>
                  <Button disabled={busy} variant="ghost" onClick={() => transform("change_tone")}>
                    Change tone
                  </Button>
                  <Button disabled={busy} variant="ghost" onClick={() => transform("regenerate")}>
                    Regenerate
                  </Button>
                </div>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="Sources, assumptions & versions" className="lg:col-span-1">
          {!selectedDraft ? (
            <p className="text-sm text-ink/70">No draft selected.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Source assertions
                </p>
                {insufficient ? (
                  <p className="text-sm text-ink/70" data-testid="insufficient-source-material">
                    Insufficient source material was provided for a fully grounded draft.
                  </p>
                ) : null}
                {!currentVersion?.sourceAssertions?.length && !insufficient ? (
                  <p className="text-sm text-ink/70">
                    No grounded source assertions recorded for the current version.
                  </p>
                ) : (
                  <ul aria-label="Draft source assertions" className="space-y-2 text-sm">
                    {currentVersion?.sourceAssertions.map((a, idx) => (
                      <li key={idx} className="rounded border border-line p-2">
                        <p>{a.text}</p>
                        <p className="mt-1 text-xs text-ink/60">
                          {a.chunkIds.length} source chunk(s)
                          {a.provenanceClass ? ` · ${a.provenanceClass}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Assumptions
                </p>
                {assumptions.length === 0 ? (
                  <p className="text-sm text-ink/70">No explicit assumptions recorded.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {assumptions.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Unresolved placeholders
                </p>
                {unresolved.length === 0 ? (
                  <p className="text-sm text-ink/70">None recorded for this version.</p>
                ) : (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {unresolved.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Version history
                </p>
                <p className="mb-2 text-xs text-ink/55">
                  Restoring appends a new version. History is never rewritten or deleted.
                </p>
                <ul aria-label="Draft version history" className="space-y-2 text-sm">
                  {sortedVersions.map((v) => (
                    <li key={v.id} className="rounded border border-line p-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold">v{v.versionNumber}</span>
                        <span className="text-xs text-ink/60">{v.origin}</span>
                      </div>
                      {v.changeSummary ? (
                        <p className="text-xs text-ink/70">{v.changeSummary}</p>
                      ) : null}
                      {v.versionNumber !== selectedDraft.currentVersionNumber ? (
                        <Button
                          className="mt-1"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => restoreVersion(v.id)}
                        >
                          Restore this version
                        </Button>
                      ) : (
                        <p className="mt-1 text-[11px] text-ink/50">Current version</p>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
