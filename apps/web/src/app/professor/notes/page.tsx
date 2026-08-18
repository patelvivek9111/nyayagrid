"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type NoteRow = {
  id: string;
  title: string;
  content: string;
  kind: "note" | "brief_challenge";
  caseId: string | null;
  courseLabel: string | null;
  updatedAt: string;
};

type CaseRow = { id: string; title: string };

export default function ProfessorNotesPage() {
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [caseId, setCaseId] = useState("");
  const [courseLabel, setCourseLabel] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    const res = await fetch("/api/v1/professor/notes");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load notes");
    setNotes(data.notes ?? []);
  }

  useEffect(() => {
    Promise.all([
      refresh(),
      fetch("/api/v1/professor/cases").then(async (res) => {
        const data = await res.json();
        if (res.ok) setCases(data.cases ?? []);
      }),
    ])
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || !content.trim()) {
      setError("Title and note text are required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(
        editingId ? `/api/v1/professor/notes/${editingId}` : "/api/v1/professor/notes",
        {
          method: editingId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            caseId: caseId || undefined,
            courseLabel: courseLabel || undefined,
            kind: "note",
          }),
        },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to save note");
      setTitle("");
      setContent("");
      setCaseId("");
      setCourseLabel("");
      setEditingId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save note");
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this note?")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/professor/notes/${id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to delete note");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete note");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Notes"
        description="Private study notes. These never write to a professional matter."
      />
      <div className="mb-4">
        <StudyAidNotice compact />
      </div>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={editingId ? "Edit note" : "New note"}>
          <form className="flex flex-col gap-3" onSubmit={save}>
            <input
              className="rounded border border-line px-3 py-2 text-sm"
              placeholder="Note title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
            <textarea
              className="min-h-[140px] rounded border border-line px-3 py-2 text-sm"
              placeholder="Your note…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <select
              className="rounded border border-line px-3 py-2 text-sm"
              value={caseId}
              onChange={(e) => setCaseId(e.target.value)}
            >
              <option value="">Not tied to a case</option>
              {cases.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.title}
                </option>
              ))}
            </select>
            <input
              className="rounded border border-line px-3 py-2 text-sm"
              placeholder="Course label (optional)"
              value={courseLabel}
              onChange={(e) => setCourseLabel(e.target.value)}
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editingId ? "Update note" : "Save note"}
            </Button>
          </form>
        </Panel>

        <Panel title="Your notes">
          {loading ? (
            <p className="text-sm text-ink/70">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="text-sm text-ink/70">No notes yet.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {notes.map((note) => (
                <li key={note.id} className="rounded border border-line px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold">{note.title}</p>
                    <Badge>{note.kind === "brief_challenge" ? "Challenge" : "Note"}</Badge>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-ink/80">{note.content}</p>
                  {note.caseId ? (
                    <Link
                      href={`/professor/cases/${note.caseId}`}
                      className="mt-1 inline-block text-xs text-accent underline"
                    >
                      Open case
                    </Link>
                  ) : null}
                  {note.courseLabel ? (
                    <p className="mt-1 text-xs text-ink/50">{note.courseLabel}</p>
                  ) : null}
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      className="text-xs underline"
                      onClick={() => {
                        setEditingId(note.id);
                        setTitle(note.title);
                        setContent(note.content);
                        setCaseId(note.caseId ?? "");
                        setCourseLabel(note.courseLabel ?? "");
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="text-xs underline" onClick={() => remove(note.id)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
