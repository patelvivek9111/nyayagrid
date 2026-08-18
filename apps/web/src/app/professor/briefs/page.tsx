"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StudyAidNotice } from "@/components/professor/study-aid-notice";
import { Badge, PageHeader, Panel } from "@nyayagrid/ui";

type BriefRow = {
  briefId: string;
  caseId: string;
  title: string;
  court: string | null;
  citation: string | null;
  year: string | null;
  courseLabel: string | null;
  updatedAt: string;
};

export default function ProfessorBriefsPage() {
  const [briefs, setBriefs] = useState<BriefRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/v1/professor/briefs")
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load briefs");
        setBriefs(data.briefs ?? []);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      <PageHeader
        eyebrow="Nyaya Professor"
        title="Case Briefs"
        description="Generated briefs from your uploaded opinions. Open a brief to review it beside the source passages."
      />
      <div className="mb-4">
        <StudyAidNotice compact />
      </div>
      {error ? <p className="mb-4 text-sm text-[var(--ng-danger)]">{error}</p> : null}
      <Panel title="Your briefs">
        {loading ? (
          <p className="text-sm text-ink/70">Loading briefs…</p>
        ) : briefs.length === 0 ? (
          <p className="text-sm text-ink/70">
            No briefs yet. Generate one from a case in your library.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {briefs.map((brief) => (
              <li key={brief.briefId} className="rounded border border-line px-3 py-2">
                <Link
                  href={`/professor/cases/${brief.caseId}`}
                  className="font-semibold text-accent underline"
                >
                  {brief.title}
                </Link>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-ink/60">
                  {brief.court ? <span>{brief.court}</span> : null}
                  {brief.year ? <span>· {brief.year}</span> : null}
                  {brief.citation ? <span>· {brief.citation}</span> : null}
                  {brief.courseLabel ? <Badge>{brief.courseLabel}</Badge> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
