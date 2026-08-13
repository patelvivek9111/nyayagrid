"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge, Button, Panel } from "@nyayagrid/ui";

type MatterAuthorityItem = {
  id: string;
  authorityId: string;
  status: string;
  relevanceNote: string | null;
  authority: {
    title: string;
    citation: string | null;
    authorityType: string;
    jurisdiction: string | null;
    treatmentSummary: string;
  };
};

type ResearchNote = {
  id: string;
  content: string;
  origin: string;
  authorityId: string | null;
  createdAt: string;
};

const STATUS_OPTIONS = ["saved", "key_authority", "rejected", "not_relevant"] as const;

export default function MatterResearchPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;

  const [question, setQuestion] = useState("");
  const [queryResult, setQueryResult] = useState<any>(null);

  const [matterAuthorities, setMatterAuthorities] = useState<MatterAuthorityItem[]>([]);
  const [notes, setNotes] = useState<ResearchNote[]>([]);
  const [noteContent, setNoteContent] = useState("");

  const [memo, setMemo] = useState<any>(null);
  const [memoQuestion, setMemoQuestion] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function loadMatterAuthorities() {
    const res = await fetch(`/api/v1/matters/${matterId}/authorities`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load saved authorities");
    setMatterAuthorities(json.authorities ?? []);
  }

  async function loadNotes() {
    const res = await fetch(`/api/v1/matters/${matterId}/research/notes`);
    const json = await res.json();
    if (!res.ok) throw new Error(json?.error?.message ?? "Failed to load notes");
    setNotes(json.notes ?? []);
  }

  useEffect(() => {
    loadMatterAuthorities().catch((err) => setError(err.message));
    loadNotes().catch((err) => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matterId]);

  async function askQuestion(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError("");
    setQueryResult(null);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/research/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queryText: question }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Query failed");
      setQueryResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setBusy(false);
    }
  }

  async function saveAuthority(
    authorityId: string,
    status: (typeof STATUS_OPTIONS)[number] = "saved",
  ) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/authorities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authorityId, status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Save failed");
      await loadMatterAuthorities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function updateStatus(matterAuthorityId: string, status: (typeof STATUS_OPTIONS)[number]) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/authorities/${matterAuthorityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Update failed");
      await loadMatterAuthorities();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusy(false);
    }
  }

  async function addNote(e: FormEvent) {
    e.preventDefault();
    if (!noteContent.trim()) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/research/notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: noteContent }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Note creation failed");
      setNoteContent("");
      await loadNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Note creation failed");
    } finally {
      setBusy(false);
    }
  }

  async function generateMemo(e: FormEvent) {
    e.preventDefault();
    if (!memoQuestion.trim()) return;
    setBusy(true);
    setError("");
    setMemo(null);
    try {
      const res = await fetch(`/api/v1/matters/${matterId}/research/memo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ researchQuestion: memoQuestion }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Memo generation failed");
      setMemo(json.memo);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Memo generation failed");
    } finally {
      setBusy(false);
    }
  }

  const synthesis = queryResult?.synthesis;
  const hits: any[] = queryResult?.hits ?? [];
  const coverageWarnings: string[] =
    queryResult?.coverageWarnings ?? synthesis?.coverageWarnings ?? [];

  return (
    <>
      {error ? <p className="mb-3 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <p className="mb-4 rounded border border-line bg-accent-soft/30 px-3 py-2 text-xs text-ink/80">
        Current treatment has not been independently verified. Legal authority passages below are
        distinct from this matter&apos;s own facts, timeline, and documents — matter context is used
        only to formulate the research question, never as a source of law.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Ask a research question">
          <form className="mb-3 flex gap-2" onSubmit={askQuestion}>
            <input
              className="flex-1 rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Research question for this matter"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Running…" : "Ask"}
            </Button>
          </form>

          {coverageWarnings.length > 0 ? (
            <div className="mb-3 rounded border border-line bg-[color-mix(in_srgb,var(--ng-danger)_8%,white)] p-2 text-xs">
              <p className="font-semibold">Coverage warnings</p>
              <ul className="list-disc pl-4">
                {coverageWarnings.map((warning, i) => (
                  <li key={i}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {synthesis ? (
            <div className="space-y-3 text-sm">
              <p className="whitespace-pre-wrap">{synthesis.conciseAnswer}</p>
              {hits.length > 0 ? (
                <ul className="space-y-2">
                  {hits.map((hit: any) => (
                    <li key={hit.chunkId} className="rounded border border-line p-2">
                      <Link
                        href={`/app/research/authorities/${hit.authorityId}`}
                        className="font-semibold text-accent underline"
                      >
                        {hit.title}
                      </Link>
                      <div className="text-xs text-ink/60">{hit.citation ?? "No citation"}</div>
                      <div className="mt-2 flex gap-2">
                        <Button onClick={() => saveAuthority(hit.authorityId, "saved")}>
                          Save
                        </Button>
                        <Button onClick={() => saveAuthority(hit.authorityId, "key_authority")}>
                          Mark key authority
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink/70">No results yet.</p>
          )}
        </Panel>

        <Panel title="Saved matter authorities">
          {matterAuthorities.length === 0 ? (
            <p className="text-sm text-ink/70">No authorities saved to this matter yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {matterAuthorities.map((item) => (
                <li key={item.id} className="rounded border border-line p-2">
                  <Link
                    href={`/app/research/authorities/${item.authorityId}`}
                    className="font-semibold text-accent underline"
                  >
                    {item.authority.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge>{item.status}</Badge>
                    {item.authority.citation ? (
                      <span className="text-xs text-ink/60">{item.authority.citation}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-ink/60">{item.authority.treatmentSummary}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {STATUS_OPTIONS.filter((s) => s !== item.status).map((status) => (
                      <button
                        key={status}
                        className="rounded border border-line px-2 py-1 text-xs hover:bg-accent-soft/40"
                        onClick={() => updateStatus(item.id, status)}
                        disabled={busy}
                      >
                        {status.replace("_", " ")}
                      </button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Research notes">
          <form className="mb-3 flex gap-2" onSubmit={addNote}>
            <input
              className="flex-1 rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Add a note"
              value={noteContent}
              onChange={(e) => setNoteContent(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </form>
          {notes.length === 0 ? (
            <p className="text-sm text-ink/70">No notes yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {notes.map((note) => (
                <li key={note.id} className="rounded border border-line p-2">
                  <p>{note.content}</p>
                  <p className="mt-1 text-xs text-ink/60">
                    {note.origin === "ai" ? "AI-generated" : "Attorney note"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Generate research memo">
          <form className="mb-3 flex gap-2" onSubmit={generateMemo}>
            <input
              className="flex-1 rounded border border-line px-2 py-1.5 text-sm"
              placeholder="Legal issue for the memo"
              value={memoQuestion}
              onChange={(e) => setMemoQuestion(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Generating…" : "Generate"}
            </Button>
          </form>
          {memo ? (
            <div className="space-y-2 text-sm">
              <p className="text-xs uppercase tracking-wide text-ink/60">
                AI-generated draft memo · not attorney work product until reviewed
              </p>
              <p>
                <span className="font-semibold">Issue: </span>
                {memo.issue}
              </p>
              <p>
                <span className="font-semibold">Short answer: </span>
                {memo.shortAnswer}
              </p>
              <p>
                <span className="font-semibold">Facts/assumptions: </span>
                {memo.factsAssumptions}
              </p>
              <p className="whitespace-pre-wrap">
                <span className="font-semibold">Analysis: </span>
                {memo.analysis}
              </p>
              {memo.counterarguments ? (
                <p className="whitespace-pre-wrap">
                  <span className="font-semibold">Counterarguments: </span>
                  {memo.counterarguments}
                </p>
              ) : null}
              <p>
                <span className="font-semibold">Conclusion: </span>
                {memo.conclusion}
              </p>
              {(memo.coverageWarnings ?? []).length > 0 ? (
                <ul className="list-disc pl-4 text-xs text-ink/70">
                  {memo.coverageWarnings.map((w: string, i: number) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : (
            <p className="text-sm text-ink/70">No memo generated yet.</p>
          )}
        </Panel>
      </div>
    </>
  );
}
