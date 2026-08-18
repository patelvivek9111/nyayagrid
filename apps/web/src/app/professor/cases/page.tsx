"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type CaseRow = {
  id: string;
  title: string;
  citation: string | null;
  court: string | null;
  processingState: string;
  courseLabel: string | null;
  createdAt: string;
};

export default function ProfessorCasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [title, setTitle] = useState("");
  const [citation, setCitation] = useState("");
  const [court, setCourt] = useState("");
  const [courseLabel, setCourseLabel] = useState("");
  const [content, setContent] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const res = await fetch("/api/v1/professor/cases");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load cases");
    setCases(data.cases ?? []);
  }

  useEffect(() => {
    refresh()
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  async function ingest(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      setError("A case title is required.");
      return;
    }
    if (!file && content.trim().length < 20) {
      setError("Paste at least 20 characters of opinion text, or choose a text or PDF file.");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let res: Response;
      if (file) {
        const form = new FormData();
        form.set("title", title);
        if (citation.trim()) form.set("citation", citation);
        if (court.trim()) form.set("court", court);
        if (courseLabel.trim()) form.set("courseLabel", courseLabel);
        if (content.trim()) form.set("content", content);
        form.set("file", file);
        res = await fetch("/api/v1/professor/cases", { method: "POST", body: form });
      } else {
        res = await fetch("/api/v1/professor/cases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title,
            content,
            citation: citation || undefined,
            court: court || undefined,
            courseLabel: courseLabel || undefined,
          }),
        });
      }
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to upload case");
      setTitle("");
      setCitation("");
      setCourt("");
      setCourseLabel("");
      setContent("");
      setFile(null);
      setMessage(
        data.skipped
          ? "This exact case text was already in your library."
          : `Uploaded — ${data.chunkCount} passages indexed.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upload case");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Your cases"
        description="Paste an opinion or upload a text/PDF file into your private library. Files are stored only as student cases — never as professional matter documents."
      />
      <div className="mb-4">
        <StudyAidNotice compact />
      </div>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {message ? <p className="mb-4 text-sm text-accent">{message}</p> : null}

      <div className="mb-4">
        <Link href="/professor/compare" className="text-sm font-semibold text-accent underline">
          Compare two cases →
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Upload a case">
          <form className="flex flex-col gap-3" onSubmit={ingest}>
            <input
              className="rounded border border-line px-3 py-2 text-sm"
              placeholder="Case title (e.g. Palsgraf v. Long Island Railroad Co.)"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                className="rounded border border-line px-3 py-2 text-sm"
                placeholder="Citation (optional)"
                value={citation}
                onChange={(e) => setCitation(e.target.value)}
              />
              <input
                className="rounded border border-line px-3 py-2 text-sm"
                placeholder="Court (optional)"
                value={court}
                onChange={(e) => setCourt(e.target.value)}
              />
            </div>
            <input
              className="rounded border border-line px-3 py-2 text-sm"
              placeholder="Course label (optional)"
              value={courseLabel}
              onChange={(e) => setCourseLabel(e.target.value)}
            />
            <textarea
              className="min-h-[160px] rounded border border-line px-3 py-2 text-sm"
              placeholder="Paste the full opinion text here…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <label className="text-xs font-semibold text-ink/70">
              Or upload a .txt / .pdf file
              <input
                className="mt-1 block w-full text-sm"
                type="file"
                accept=".txt,.pdf,text/plain,application/pdf"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Button type="submit" disabled={busy}>
              {busy ? "Uploading…" : "Add case"}
            </Button>
          </form>
        </Panel>

        <Panel title="Case library">
          {loading ? (
            <p className="text-sm text-ink/70">Loading your cases…</p>
          ) : cases.length === 0 ? (
            <p className="text-sm text-ink/70">No cases yet. Upload one to get started.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {cases.map((studentCase) => (
                <li key={studentCase.id} className="rounded border border-line px-3 py-2">
                  <Link
                    href={`/professor/cases/${studentCase.id}`}
                    className="font-semibold text-accent underline"
                  >
                    {studentCase.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink/60">
                    {studentCase.citation ? <span>{studentCase.citation}</span> : null}
                    {studentCase.court ? <span>· {studentCase.court}</span> : null}
                    {studentCase.courseLabel ? <Badge>{studentCase.courseLabel}</Badge> : null}
                    <Badge>{studentCase.processingState}</Badge>
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
