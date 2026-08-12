"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { StudentShell } from "@/components/shell";
import { Badge, Button, PageHeader, Panel } from "@nyayagrid/ui";

type CaseRow = {
  id: string;
  title: string;
  citation: string | null;
  court: string | null;
  processingState: string;
  createdAt: string;
};

export default function ProfessorCasesPage() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [title, setTitle] = useState("");
  const [citation, setCitation] = useState("");
  const [court, setCourt] = useState("");
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh() {
    const res = await fetch("/api/v1/professor/cases");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load cases");
    setCases(data.cases ?? []);
  }

  useEffect(() => {
    refresh().catch((err) => setMessage(err instanceof Error ? err.message : "Failed to load"));
  }, []);

  async function ingest(event: FormEvent) {
    event.preventDefault();
    if (!title.trim() || content.trim().length < 20) {
      setMessage("Title and at least 20 characters of case text are required.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch("/api/v1/professor/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          citation: citation || undefined,
          court: court || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "Failed to upload case");
      setTitle("");
      setCitation("");
      setCourt("");
      setContent("");
      setMessage(
        data.skipped
          ? "This exact case text was already in your library."
          : `Uploaded — ${data.chunkCount} passages indexed.`,
      );
      await refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Failed to upload case");
    } finally {
      setBusy(false);
    }
  }

  return (
    <StudentShell>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Your cases"
        description="Paste the text of a judicial opinion to add it to your private case library. Nothing here is shared with any other student."
      />
      {message ? <p className="mb-4 text-sm text-accent">{message}</p> : null}

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
            <textarea
              className="min-h-[220px] rounded border border-line px-3 py-2 text-sm"
              placeholder="Paste the full opinion text here…"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              required
            />
            <Button type="submit" disabled={busy}>
              {busy ? "Uploading…" : "Add case"}
            </Button>
          </form>
        </Panel>

        <Panel title="Case library">
          {cases.length === 0 ? (
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
                    <Badge>{studentCase.processingState}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </StudentShell>
  );
}
