"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import { MatterShell } from "@/components/shell";
import { Badge, Button, Panel } from "@nyayagrid/ui";

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
  sourceAssertions: Array<{ text: string; chunkIds: string[] }>;
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
};

export default function MatterDraftPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;

  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

  useEffect(() => {
    loadDrafts().catch((err) => setError(err.message));
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

  async function createDraft(e: FormEvent) {
    e.preventDefault();
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
        body: JSON.stringify({ action: "generate", title, draftType, instructions }),
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

  const currentVersion = versions.find(
    (v) => v.versionNumber === selectedDraft?.currentVersionNumber,
  );

  return (
    <MatterShell matterId={matterId} title="Draft">
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Drafts" className="lg:col-span-1">
          {drafts.length === 0 ? (
            <p className="text-sm text-ink/70">No drafts yet.</p>
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
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <select
              className="w-full rounded border border-line px-2 py-1.5 text-sm"
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
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
            />
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
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{selectedDraft.draftType}</Badge>
                <Badge>v{selectedDraft.currentVersionNumber}</Badge>
                <Badge>{selectedDraft.status}</Badge>
              </div>
              <textarea
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                rows={16}
              />
              <input
                className="w-full rounded border border-line px-2 py-1.5 text-sm"
                placeholder="Change summary (optional)"
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

        <Panel title="Versions & provenance" className="lg:col-span-1">
          {!selectedDraft ? (
            <p className="text-sm text-ink/70">No draft selected.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Version history
                </p>
                <ul className="space-y-2 text-sm">
                  {[...versions].reverse().map((v) => (
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
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/60">
                  Why did Nyaya include this?
                </p>
                {!currentVersion?.sourceAssertions?.length ? (
                  <p className="text-sm text-ink/70">
                    No grounded source assertions recorded for the current version.
                  </p>
                ) : (
                  <ul className="space-y-2 text-sm">
                    {currentVersion.sourceAssertions.map((a, idx) => (
                      <li key={idx} className="rounded border border-line p-2">
                        <p>{a.text}</p>
                        <p className="mt-1 text-xs text-ink/60">
                          {a.chunkIds.length} source chunk(s) cited
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </Panel>
      </div>
    </MatterShell>
  );
}
