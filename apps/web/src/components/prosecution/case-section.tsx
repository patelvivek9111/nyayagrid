"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState, StatusLabel } from "@/components/ux";
import { formatCoverageWarning, humanizeKey } from "@/lib/plain-labels";

export const PROSECUTION_SECTIONS = [
  { segment: "", label: "Overview" },
  { segment: "charges", label: "Charges" },
  { segment: "elements", label: "Elements Matrix" },
  { segment: "evidence", label: "Evidence" },
  { segment: "witnesses", label: "Witnesses" },
  { segment: "discovery", label: "Discovery" },
  { segment: "disclosure", label: "Disclosure" },
  { segment: "warrants", label: "Warrants" },
  { segment: "subpoenas", label: "Subpoenas" },
  { segment: "motions", label: "Motions" },
  { segment: "hearings", label: "Hearings" },
  { segment: "pleas", label: "Pleas" },
  { segment: "timeline", label: "Timeline" },
  { segment: "research", label: "Research" },
  { segment: "tasks", label: "Tasks" },
] as const;

type MatrixRow = {
  chargeId: string;
  offenseName: string;
  elementId: string;
  elementText: string;
  status: string;
  supportingEvidenceIds: string[];
  contraryEvidenceIds: string[];
  uncertainEvidenceIds: string[];
  missingEvidenceIds: string[];
  authorityIds: string[];
  humanReviewStatus: string;
  guiltConclusion: null;
};

type DiscoveryDashboard = {
  totalItems: number;
  unreviewed: number;
  flagged: number;
  potentialDisclosureReview: number;
  produced: number;
  pendingProduction: number;
  missingOrExpected: number;
};

type Overview = {
  case: {
    id: string;
    caseNumber: string;
    caseStatus: string;
    jurisdiction: string;
    court: string;
    summary: string | null;
  };
  defendants: Array<{ id: string; displayName: string }>;
  charges: Array<{
    id: string;
    countNumber: string;
    offenseName: string;
    status: string;
    statuteCitation?: string | null;
  }>;
  hearings: Array<{ id: string; hearingType: string; outcome: string | null }>;
  motions: Array<{ id: string; motionType: string; status: string; filingParty?: string | null }>;
  subpoenas: Array<{ id: string; recipient: string; status: string; requestScope?: string | null }>;
  openTasks: Array<{ id: string; title: string; status: string }>;
  evidenceCount: number;
  discoveryCount: number;
  witnessCount: number;
  elementGaps: Array<{ elementText: string; status: string }>;
  issueFlags: Array<{ id: string; issueType: string; status: string }>;
  issueSeparation?: Array<{
    id: string;
    kind: "charge" | "procedure" | "element_gap";
    label: string;
    status: string | null;
    defendantId: string | null;
  }>;
  evidenceScope?: {
    jointEvidenceIds: string[];
    unassignedEvidenceIds: string[];
    byDefendant: Array<{
      defendantId: string;
      displayName: string;
      specificEvidenceIds: string[];
      jointEvidenceIds: string[];
    }>;
  };
  matrix?: MatrixRow[];
  discoveryDashboard?: DiscoveryDashboard;
  guiltConclusion: null;
};

function elementTone(status: string): "ok" | "warn" | "danger" | "neutral" | "info" {
  if (status === "SUPPORTED") return "ok";
  if (status === "PARTIALLY_SUPPORTED" || status === "UNKNOWN") return "warn";
  if (status === "CONFLICTED" || status === "NO_EVIDENCE_FOUND") return "danger";
  return "neutral";
}

export function ProsecutionCaseNav({ caseId, active }: { caseId: string; active: string }) {
  return (
    <nav
      className="mb-4 flex gap-1 overflow-x-auto border-b border-line pb-px"
      aria-label="Prosecution sections"
    >
      {PROSECUTION_SECTIONS.map((section) => {
        const href = section.segment
          ? `/app/prosecution/${caseId}/${section.segment}`
          : `/app/prosecution/${caseId}`;
        const current = active === section.segment;
        return (
          <Link
            key={section.label}
            href={href}
            aria-current={current ? "page" : undefined}
            className={
              current
                ? "whitespace-nowrap border-b-2 border-accent px-3 py-2 text-sm font-semibold text-accent"
                : "whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-semibold text-ink/60 hover:text-ink"
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
  if (!overview) {
    return <EmptyState title="Case unavailable" description="This criminal case is not available in your office." />;
  }

  return (
    <div>
      <ProsecutionCaseNav caseId={caseId} active={section} />
      <p className="text-xs uppercase tracking-[0.16em] text-accent">Nyaya Prosecution</p>
      <h1 className="font-display text-2xl text-ink">
        {overview.case.caseNumber}
        <span className="ml-2 align-middle">
          <StatusLabel label={humanizeKey(overview.case.caseStatus)} tone="info" />
        </span>
      </h1>
      <p className="mt-1 text-sm text-ink/70">
        {overview.case.jurisdiction} · {overview.case.court}
      </p>
      {overview.case.summary ? <p className="mt-2 max-w-3xl text-sm text-ink/80">{overview.case.summary}</p> : null}
      <p className="mt-2 text-xs text-ink/55">Nyaya does not return a guilt verdict or recommend charging decisions.</p>

      {section === "" ? <OverviewBody overview={overview} /> : null}
      {section === "charges" ? <ChargesBody overview={overview} /> : null}
      {section === "elements" ? <ElementsMatrixBody overview={overview} /> : null}
      {section === "evidence" ? (
        <CountBody
          title="Evidence"
          count={overview.evidenceCount}
          emptyTitle="No evidence items yet"
          emptyDescription="Add evidence items linked to this criminal case. Evidence stays case-scoped."
        />
      ) : null}
      {section === "witnesses" ? (
        <CountBody
          title="Witnesses"
          count={overview.witnessCount}
          emptyTitle="No witnesses yet"
          emptyDescription="Record witnesses and statements for this case. Nyaya does not label truthfulness."
        />
      ) : null}
      {section === "discovery" ? <DiscoveryBody overview={overview} /> : null}
      {section === "disclosure" ? <DisclosureBody overview={overview} /> : null}
      {section === "warrants" ? (
        <EmptyState
          title="Warrants"
          description="Warrant, affidavit, and execution records are stored on this case. Nyaya does not auto-validate warrants."
        />
      ) : null}
      {section === "subpoenas" ? <SubpoenasBody overview={overview} /> : null}
      {section === "motions" ? <MotionsBody overview={overview} /> : null}
      {section === "hearings" ? <HearingsBody overview={overview} /> : null}
      {section === "pleas" ? (
        <EmptyState
          title="Pleas"
          description="Plea terms and history are human-controlled. Nyaya does not recommend accept or reject."
        />
      ) : null}
      {section === "timeline" ? (
        <EmptyState
          title="Prosecution timeline"
          description="Timeline events use prosecution event types and stay tied to this case. Open a large case to page through events."
        />
      ) : null}
      {section === "research" ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-ink/80">
            Authority lookup uses the shared Nyaya Research workspace. Results remain organization-scoped.
          </p>
          <Link className="font-semibold text-accent underline" href="/app/research">
            Open Nyaya Research
          </Link>
        </div>
      ) : null}
      {section === "tasks" ? <TasksBody overview={overview} /> : null}
    </div>
  );
}

function OverviewBody({ overview }: { overview: Overview }) {
  const weak = overview.elementGaps.slice(0, 8);
  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Defendants</h2>
        <RecordList empty="No defendants recorded." rows={overview.defendants.map((p) => p.displayName)} />
      </section>
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Case snapshot</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink/80">
          <li>Charges: {overview.charges.length}</li>
          <li>Evidence items: {overview.evidenceCount}</li>
          <li>Discovery items: {overview.discoveryCount}</li>
          <li>Witnesses: {overview.witnessCount}</li>
          <li>Open tasks: {overview.openTasks.length}</li>
        </ul>
      </section>
      <section className="rounded-md border border-line p-3 md:col-span-2">
        <h2 className="text-sm font-semibold text-ink">Separated issues</h2>
        <p className="mt-1 text-sm text-ink/70">
          Charges, procedure issues, and element gaps stay separate. This list is not a guilt finding, and earlier
          analysis is not current when new evidence or a contradiction appears.
        </p>
        <RecordList
          empty="No separated issues recorded."
          rows={(overview.issueSeparation ?? []).map((issue) =>
            issue.status ? `${issue.label} — ${humanizeKey(issue.status)}` : issue.label,
          )}
        />
      </section>
      <section className="rounded-md border border-line p-3 md:col-span-2">
        <h2 className="text-sm font-semibold text-ink">Evidence scope</h2>
        <p className="mt-1 text-sm text-ink/70">
          Joint evidence is shared by more than one defendant. Defendant-specific evidence is listed apart from it.
        </p>
        {overview.evidenceScope ? (
          <ul className="mt-2 space-y-1 text-sm text-ink/80">
            <li>Joint items: {overview.evidenceScope.jointEvidenceIds.length}</li>
            <li>Unassigned items: {overview.evidenceScope.unassignedEvidenceIds.length}</li>
            {overview.evidenceScope.byDefendant.map((row) => (
              <li key={row.defendantId}>
                {row.displayName}: {row.specificEvidenceIds.length} specific, {row.jointEvidenceIds.length} joint
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink/60">Evidence scope is not available for this case.</p>
        )}
      </section>
      <section className="rounded-md border border-line p-3 md:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Element gaps</h2>
          <Link className="text-sm font-semibold text-accent underline" href={`/app/prosecution/${overview.case.id}/elements`}>
            Open Elements Matrix
          </Link>
        </div>
        {weak.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">No element gaps recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {weak.map((gap) => (
              <li key={`${gap.elementText}-${gap.status}`} className="flex flex-wrap items-center gap-2 text-sm">
                <StatusLabel label={humanizeKey(gap.status)} tone={elementTone(gap.status)} />
                <span className="text-ink/80">{gap.elementText}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Upcoming hearings</h2>
        <RecordList
          empty="No hearings scheduled."
          rows={overview.hearings.map((h) => `${humanizeKey(h.hearingType)}${h.outcome ? ` — ${h.outcome}` : ""}`)}
        />
      </section>
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Procedure issues</h2>
        <RecordList
          empty="No procedure issues flagged."
          rows={overview.issueFlags.map((issue) => `${humanizeKey(issue.issueType)} (${humanizeKey(issue.status)})`)}
        />
      </section>
    </div>
  );
}

function ChargesBody({ overview }: { overview: Overview }) {
  if (overview.charges.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="No charges yet"
          description="Add counts with statute, offense, and provenance. Elements appear on the Elements Matrix."
        />
      </div>
    );
  }
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="min-w-full text-left text-sm">
        <caption className="sr-only">Charges for this criminal case</caption>
        <thead className="border-b border-line text-xs uppercase tracking-wide text-ink/55">
          <tr>
            <th className="px-2 py-2 font-semibold">Count</th>
            <th className="px-2 py-2 font-semibold">Offense</th>
            <th className="px-2 py-2 font-semibold">Statute</th>
            <th className="px-2 py-2 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {overview.charges.map((charge) => (
            <tr key={charge.id} className="border-b border-line/70">
              <td className="px-2 py-2 font-semibold">{charge.countNumber}</td>
              <td className="px-2 py-2">{charge.offenseName}</td>
              <td className="px-2 py-2 text-ink/70">{charge.statuteCitation ?? "—"}</td>
              <td className="px-2 py-2">
                <StatusLabel label={humanizeKey(charge.status)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ElementsMatrixBody({ overview }: { overview: Overview }) {
  const rows = overview.matrix ?? [];
  const [filter, setFilter] = useState<"all" | "weak">("all");
  const visible = filter === "weak" ? rows.filter((row) => row.status !== "SUPPORTED") : rows;

  if (rows.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="No charge elements yet"
          description="When charges have elements, this matrix shows supporting evidence, contrary evidence, missing items, and review status — without a guilt score."
        />
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-ink/70">
          {rows.length} elements · {rows.filter((r) => r.status !== "SUPPORTED").length} need attention
        </p>
        <div className="ml-auto flex gap-1" role="group" aria-label="Element filter">
          <button
            type="button"
            className={filter === "all" ? "rounded border border-accent px-2 py-1 text-xs font-semibold text-accent" : "rounded border border-line px-2 py-1 text-xs"}
            onClick={() => setFilter("all")}
            aria-pressed={filter === "all"}
          >
            All
          </button>
          <button
            type="button"
            className={filter === "weak" ? "rounded border border-accent px-2 py-1 text-xs font-semibold text-accent" : "rounded border border-line px-2 py-1 text-xs"}
            onClick={() => setFilter("weak")}
            aria-pressed={filter === "weak"}
          >
            Gaps only
          </button>
        </div>
      </div>
      <div className="overflow-x-auto rounded-md border border-line">
        <table className="min-w-[720px] w-full text-left text-sm">
          <caption className="sr-only">Elements matrix — no guilt probability</caption>
          <thead className="bg-black/[0.02] text-xs uppercase tracking-wide text-ink/55">
            <tr>
              <th className="px-3 py-2 font-semibold">Charge</th>
              <th className="px-3 py-2 font-semibold">Element</th>
              <th className="px-3 py-2 font-semibold">Status</th>
              <th className="px-3 py-2 font-semibold">Supporting</th>
              <th className="px-3 py-2 font-semibold">Contrary</th>
              <th className="px-3 py-2 font-semibold">Missing</th>
              <th className="px-3 py-2 font-semibold">Review</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr key={row.elementId} className="border-t border-line/70 align-top">
                <td className="px-3 py-2 text-ink/80">{row.offenseName}</td>
                <td className="px-3 py-2">{row.elementText}</td>
                <td className="px-3 py-2">
                  <StatusLabel label={humanizeKey(row.status)} tone={elementTone(row.status)} />
                </td>
                <td className="px-3 py-2 tabular-nums">{row.supportingEvidenceIds.length}</td>
                <td className="px-3 py-2 tabular-nums">{row.contraryEvidenceIds.length}</td>
                <td className="px-3 py-2 tabular-nums">{row.missingEvidenceIds.length}</td>
                <td className="px-3 py-2">
                  <StatusLabel label={humanizeKey(row.humanReviewStatus)} tone="neutral" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/55">Guilt conclusion: none. Statuses describe evidence coverage, not probability of guilt.</p>
    </div>
  );
}

function DiscoveryBody({ overview }: { overview: Overview }) {
  const dash = overview.discoveryDashboard;
  if (!dash || overview.discoveryCount === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="No discovery items yet"
          description="Track received, flagged, produced, and pending discovery for this case."
        />
      </div>
    );
  }
  const cards = [
    { label: "Total", value: dash.totalItems },
    { label: "Unreviewed", value: dash.unreviewed },
    { label: "Flagged", value: dash.flagged },
    { label: "Disclosure review", value: dash.potentialDisclosureReview },
    { label: "Produced", value: dash.produced },
    { label: "Pending production", value: dash.pendingProduction },
    { label: "Missing / expected", value: dash.missingOrExpected },
  ];
  return (
    <div className="mt-4 space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <div key={card.label} className="rounded-md border border-line p-3">
            <p className="text-xs uppercase tracking-wide text-ink/55">{card.label}</p>
            <p className="mt-1 font-display text-2xl tabular-nums text-ink">{card.value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-ink/55">Disclosure decisions require human confirmation. Nyaya does not make the final disclosure call.</p>
    </div>
  );
}

function DisclosureBody({ overview }: { overview: Overview }) {
  const pending = overview.discoveryDashboard?.potentialDisclosureReview ?? 0;
  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Disclosure review queue</h2>
        <p className="mt-2 text-sm text-ink/80">
          {pending === 0
            ? "No disclosure candidates currently require review."
            : `${pending} candidate${pending === 1 ? "" : "s"} flagged for human review.`}
        </p>
        <p className="mt-2 text-xs text-ink/55">
          Final disclose / do-not-disclose determinations are attorney actions with audit history. Confirm before changing status.
        </p>
      </div>
      {pending === 0 ? (
        <EmptyState
          title="No disclosure reviews pending"
          description="When contradictory evidence, witness conflicts, or element weaknesses are flagged, candidates appear here."
        />
      ) : null}
    </div>
  );
}

function SubpoenasBody({ overview }: { overview: Overview }) {
  if (overview.subpoenas.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState title="No subpoenas" description="Issued subpoenas and return deadlines for this case will appear here." />
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {overview.subpoenas.map((item) => (
        <li key={item.id} className="rounded border border-line px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{item.recipient}</span>
            <StatusLabel label={humanizeKey(item.status)} />
          </div>
          {item.requestScope ? <p className="mt-1 text-ink/70">{item.requestScope}</p> : null}
        </li>
      ))}
    </ul>
  );
}

function MotionsBody({ overview }: { overview: Overview }) {
  if (overview.motions.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState title="No motions" description="Motions filed on this case appear here. Filing still requires a person." />
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {overview.motions.map((motion) => (
        <li key={motion.id} className="flex flex-wrap items-center gap-2 rounded border border-line px-3 py-2">
          <span className="font-semibold">{humanizeKey(motion.motionType)}</span>
          <StatusLabel label={humanizeKey(motion.status)} />
          {motion.filingParty ? <span className="text-ink/60">· {humanizeKey(motion.filingParty)}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function HearingsBody({ overview }: { overview: Overview }) {
  if (overview.hearings.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState title="No hearings" description="Schedule hearings to track court dates, participants, and outcomes." />
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {overview.hearings.map((hearing) => (
        <li key={hearing.id} className="rounded border border-line px-3 py-2">
          <span className="font-semibold">{humanizeKey(hearing.hearingType)}</span>
          {hearing.outcome ? <span className="ml-2 text-ink/70">{hearing.outcome}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function TasksBody({ overview }: { overview: Overview }) {
  if (overview.openTasks.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState title="No open tasks" description="Create case tasks for follow-ups, disclosures, and hearing prep." />
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {overview.openTasks.map((task) => (
        <li key={task.id} className="flex flex-wrap items-center gap-2 rounded border border-line px-3 py-2">
          <span>{task.title}</span>
          <StatusLabel label={humanizeKey(task.status)} />
        </li>
      ))}
    </ul>
  );
}

function CountBody({
  title,
  count,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  count: number;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (count === 0) {
    return (
      <div className="mt-4">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-md border border-line p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <p className="mt-2 font-display text-3xl tabular-nums text-ink">{count}</p>
      <p className="mt-1 text-sm text-ink/65">Records on this criminal case.</p>
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

/** Exported for tests — keeps warning formatter wired to prosecution surfaces. */
export function prosecutionCoverageCopy(code: string): string {
  return formatCoverageWarning(code);
}
