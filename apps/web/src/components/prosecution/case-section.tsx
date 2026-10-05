"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";

export const PROSECUTION_SECTIONS = [
  { segment: "", label: "Overview" },
  { segment: "charges", label: "Charges" },
  { segment: "evidence", label: "Evidence" },
  { segment: "witnesses", label: "Witnesses" },
  { segment: "discovery", label: "Discovery" },
  { segment: "timeline", label: "Timeline" },
  { segment: "research", label: "Research" },
  { segment: "motions", label: "Motions" },
  { segment: "hearings", label: "Hearings" },
  { segment: "tasks", label: "Tasks" },
] as const;

type Overview = {
  case: { id: string; caseNumber: string; caseStatus: string; jurisdiction: string; court: string; summary: string | null };
  defendants: Array<{ id: string; displayName: string }>;
  charges: Array<{ id: string; countNumber: string; offenseName: string; status: string }>;
  hearings: Array<{ id: string; hearingType: string; outcome: string | null }>;
  openTasks: Array<{ id: string; title: string; status: string }>;
  evidenceCount: number;
  discoveryCount: number;
  witnessCount: number;
  elementGaps: Array<{ elementText: string; status: string }>;
  issueFlags: Array<{ id: string; issueType: string; status: string }>;
  guiltConclusion: null;
};

export function ProsecutionCaseNav({ caseId, active }: { caseId: string; active: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-line pb-px" aria-label="Prosecution sections">
      {PROSECUTION_SECTIONS.map((section) => {
        const href = section.segment ? `/app/prosecution/${caseId}/${section.segment}` : `/app/prosecution/${caseId}`;
        const current = active === section.segment;
        return (
          <Link
            key={section.label}
            href={href}
            aria-current={current ? "page" : undefined}
            className={
              current
                ? "whitespace-nowrap border-b-2 border-accent px-3 py-2 text-sm font-semibold text-accent"
                : "whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-ink/60"
            }
          >
            {section.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function ProsecutionSection({ caseId, section }: { caseId: string; section: string }) {
  const { organizationId } = useActiveOrganization();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? "Could not load this criminal case.");
        if (!cancelled) setOverview(data.overview);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load this criminal case.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [caseId, organizationId]);

  if (loading) return <LoadingState label="Loading criminal case" />;
  if (error) return <ErrorState message={error} />;
      if (!overview) return <EmptyState title="No case" description="This criminal case is not available." />;

  return (
    <div>
      <ProsecutionCaseNav caseId={caseId} active={section} />
      <p className="text-xs uppercase tracking-[0.16em] text-accent">Nyaya Prosecution</p>
      <h1 className="font-display text-2xl text-ink">
        {overview.case.caseNumber}
        <span className="ml-2 text-base text-ink/60">{overview.case.caseStatus}</span>
      </h1>
      <p className="mt-1 text-sm text-ink/70">
        {overview.case.jurisdiction} · {overview.case.court}
      </p>
      {section === "" ? <OverviewBody overview={overview} /> : null}
      {section === "charges" ? (
        <RecordList
          empty="No charges yet."
          rows={overview.charges.map((charge) => `${charge.countNumber}. ${charge.offenseName} (${charge.status})`)}
        />
      ) : null}
      {section === "evidence" ? <p className="mt-4 text-sm text-ink/80">{overview.evidenceCount} evidence items.</p> : null}
      {section === "witnesses" ? <p className="mt-4 text-sm text-ink/80">{overview.witnessCount} witnesses.</p> : null}
      {section === "discovery" ? <p className="mt-4 text-sm text-ink/80">{overview.discoveryCount} discovery items.</p> : null}
      {section === "timeline" ? <p className="mt-4 text-sm text-ink/80">Timeline events use prosecution event types and stay tied to this case.</p> : null}
      {section === "research" ? (
        <p className="mt-4 text-sm text-ink/80">
          <Link className="font-semibold text-accent underline" href="/app/research">
            Open Nyaya Research
          </Link>{" "}
          for authority lookup. Research stays in the shared workspace.
        </p>
      ) : null}
      {section === "motions" ? <p className="mt-4 text-sm text-ink/80">Motions are stored on this case. Filing still requires a person.</p> : null}
      {section === "hearings" ? (
        <RecordList empty="No hearings yet." rows={overview.hearings.map((hearing) => hearing.hearingType)} />
      ) : null}
      {section === "tasks" ? (
        <RecordList empty="No open tasks." rows={overview.openTasks.map((task) => task.title)} />
      ) : null}
    </div>
  );
}

function OverviewBody({ overview }: { overview: Overview }) {
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Defendants</h2>
        <RecordList empty="No defendants." rows={overview.defendants.map((person) => person.displayName)} />
      </section>
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Counts</h2>
        <p className="text-sm text-ink/80">{overview.charges.length}</p>
        <p className="mt-2 text-sm text-ink/80">Evidence {overview.evidenceCount}</p>
        <p className="text-sm text-ink/80">Discovery {overview.discoveryCount}</p>
        <p className="text-sm text-ink/80">Witnesses {overview.witnessCount}</p>
      </section>
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Element gaps</h2>
        <RecordList
          empty="No element gaps recorded."
          rows={overview.elementGaps.map((gap) => `${gap.elementText}: ${gap.status}`)}
        />
      </section>
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Issue flags</h2>
        <RecordList empty="No procedure issues." rows={overview.issueFlags.map((issue) => issue.issueType)} />
        <p className="mt-2 text-xs text-ink/60">Nyaya does not return a guilt verdict.</p>
      </section>
    </div>
  );
}

function RecordList({ rows, empty }: { rows: string[]; empty: string }) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-ink/60">{empty}</p>;
  return (
    <ul className="mt-2 space-y-1 text-sm text-ink/80">
      {rows.map((row) => (
        <li key={row}>{row}</li>
      ))}
    </ul>
  );
}
