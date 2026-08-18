"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import { Button, Panel } from "@nyayagrid/ui";

export default function ProfessorHomePage() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [recent, setRecent] = useState<Array<{ id: string; title: string | null }>>([]);
  const [cases, setCases] = useState<Array<{ id: string; title: string }>>([]);

  useEffect(() => {
    fetch("/api/v1/professor/conversations")
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setRecent((data.conversations ?? []).slice(0, 5));
      })
      .catch(() => undefined);
    fetch("/api/v1/professor/cases")
      .then(async (res) => {
        const data = await res.json();
        if (res.ok) setCases((data.cases ?? []).slice(0, 5));
      })
      .catch(() => undefined);
  }, []);

  return (
    <>
      <div className="mx-auto max-w-2xl py-8 text-center">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          Nyaya Professor
        </p>
        <h1 className="mt-2 font-display text-3xl text-ink md:text-4xl">What are you studying?</h1>
        <div className="mx-auto mt-3 max-w-xl text-left">
          <StudyAidNotice />
        </div>
        <form
          className="mt-8 text-left"
          onSubmit={(e) => {
            e.preventDefault();
            const q = encodeURIComponent(question.trim());
            router.push(q ? `/professor/ask?q=${q}` : "/professor/ask");
          }}
        >
          <textarea
            className="min-h-[100px] w-full rounded-xl border border-line bg-white px-4 py-3 text-sm"
            placeholder="Ask Professor…"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button type="submit">Ask Professor</Button>
            <Link href="/professor/cases">
              <Button type="button" variant="secondary">
                Upload Case
              </Button>
            </Link>
          </div>
        </form>
      </div>

      <div className="mx-auto mt-8 grid max-w-3xl gap-4 md:grid-cols-2">
        <Panel title="Recent conversations">
          {recent.length === 0 ? (
            <p className="text-sm text-ink/60">No saved conversations yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {recent.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/professor/ask?conversationId=${c.id}`}
                    className="text-accent underline"
                  >
                    {c.title || "Untitled"}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/professor/saved"
            className="mt-3 inline-block text-xs font-semibold text-accent underline"
          >
            Saved →
          </Link>
        </Panel>
        <Panel title="Recent Cases">
          {cases.length === 0 ? (
            <p className="text-sm text-ink/60">Upload a case to brief and discuss.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {cases.map((c) => (
                <li key={c.id}>
                  <Link href={`/professor/cases/${c.id}`} className="text-accent underline">
                    {c.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            href="/professor/cases"
            className="mt-3 inline-block text-xs font-semibold text-accent underline"
          >
            All cases →
          </Link>
        </Panel>
      </div>
    </>
  );
}
