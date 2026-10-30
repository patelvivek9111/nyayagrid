"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState, StatusLabel } from "@/components/ux";
import { formatCoverageWarning, humanizeKey } from "@/lib/plain-labels";
import {
  WarrantReviewPanel,
  type SuppressionAnswerView,
  type SuppressionReviewView,
} from "@/components/prosecution/warrant-review";

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

type AssignableMember = {
  userId: string;
  name: string | null;
  email: string;
  roleKey: string;
  canBeProsecutor: boolean;
  canBeSupervisor: boolean;
};

type EvidenceItemView = {
  id: string;
  evidenceType: string;
  collector: string | null;
  collectionDate: string | null;
  storageReference: string | null;
  sourceAgency: string | null;
  relatedDefendantIds: string[];
  relatedChargeIds: string[];
  relatedElementIds: string[];
  chainOfCustody: string[];
  custodyTransfers: Array<{
    actor: string;
    timestamp: string;
    from: string | null;
    to: string;
    location?: string | null;
  }>;
  custodyFindings: Array<{ code: string; message: string; index: number }>;
  scope: string;
  provenance: { documentId?: string | null; sourceSpan?: string | null; humanEntered?: boolean };
  reviewStatus: string;
};

type WitnessView = {
  id: string;
  displayName: string;
  witnessType: string;
  relationship: string | null;
  notes: string | null;
  statements: Array<{
    id: string;
    statementType: string;
    statementDate: string | null;
    interviewer: string | null;
    sourceSpan: string | null;
    claims: Array<{ key: string; value: string; kind?: string }>;
    provenance: { documentId?: string | null; sourceSpan?: string | null; humanEntered?: boolean };
  }>;
  statementComparison: Array<{ key: string; label: string; detail: string }>;
};

type DisclosureCandidateView = {
  id: string;
  category: string;
  status: string;
  notes: string | null;
  label: string;
  humanActorId: string | null;
  reviewedAt: string | null;
  reviewer: { id: string; name: string | null; email: string } | null;
  provenance: { documentId?: string | null; sourceSpan?: string | null; humanEntered?: boolean };
  createdAt: string;
  updatedAt: string;
};

type Overview = {
  case: {
    id: string;
    caseNumber: string;
    caseStatus: string;
    jurisdiction: string;
    court: string;
    courthouse?: string | null;
    priority?: string;
    summary: string | null;
    notes?: string | null;
    assignedProsecutorId?: string | null;
    supervisingProsecutorId?: string | null;
    investigatingAgencyId?: string | null;
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
  agencies: Array<{ id: string; name: string; agencyType: string }>;
  openTasks: Array<{ id: string; title: string; status: string }>;
  evidenceCount: number;
  discoveryCount: number;
  witnessCount: number;
  evidenceItems?: EvidenceItemView[];
  witnesses?: WitnessView[];
  disclosureCandidates?: DisclosureCandidateView[];
  assignableMembers?: AssignableMember[];
  canReviewDisclosure?: boolean;
  canManageCase?: boolean;
  canManageEvidence?: boolean;
  canManageWitnesses?: boolean;
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
  suppressionReview?: SuppressionReviewView;
  suppressionAnswer?: SuppressionAnswerView;
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

  async function reload() {
    if (!organizationId) return;
    const response = await fetch(
      `/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`,
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error?.message ?? "Could not load this criminal case.");
    setOverview(data.overview);
  }

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/prosecution/cases/${caseId}?organizationId=${organizationId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data?.error?.message ?? "Could not load this criminal case.");
        if (!cancelled) setOverview(data.overview);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Could not load this criminal case.");
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
  if (!overview || !organizationId) {
    return (
      <EmptyState
        title="Case unavailable"
        description="This criminal case is not available in your office."
      />
    );
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
      {overview.case.summary ? (
        <p className="mt-2 max-w-3xl text-sm text-ink/80">{overview.case.summary}</p>
      ) : null}
      <p className="mt-2 text-xs text-ink/55">
        Nyaya does not return a guilt verdict or recommend charging decisions.
      </p>

      {section === "" ? (
        <OverviewBody overview={overview} organizationId={organizationId} onUpdated={reload} />
      ) : null}
      {section === "charges" ? <ChargesBody overview={overview} /> : null}
      {section === "elements" ? <ElementsMatrixBody overview={overview} /> : null}
      {section === "evidence" ? (
        <EvidenceBody
          overview={overview}
          organizationId={organizationId}
          caseId={caseId}
          onUpdated={reload}
        />
      ) : null}
      {section === "witnesses" ? (
        <WitnessesBody
          overview={overview}
          organizationId={organizationId}
          caseId={caseId}
          onUpdated={reload}
        />
      ) : null}
      {section === "discovery" ? <DiscoveryBody overview={overview} /> : null}
      {section === "disclosure" ? (
        <DisclosureBody
          overview={overview}
          organizationId={organizationId}
          caseId={caseId}
          onUpdated={reload}
        />
      ) : null}
      {section === "warrants" ? (
        <WarrantReviewPanel
          review={overview.suppressionReview}
          answer={overview.suppressionAnswer}
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
            Authority lookup uses the shared Nyaya Research workspace. Results remain
            organization-scoped.
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

function memberLabel(member: AssignableMember | undefined): string {
  if (!member) return "Unassigned";
  return member.name?.trim() || member.email;
}

function OverviewBody({
  overview,
  organizationId,
  onUpdated,
}: {
  overview: Overview;
  organizationId: string;
  onUpdated: () => Promise<void>;
}) {
  const weak = overview.elementGaps.slice(0, 8);
  const members = overview.assignableMembers ?? [];
  const prosecutors = members.filter((m) => m.canBeProsecutor);
  const supervisors = members.filter((m) => m.canBeSupervisor);
  const assignedProsecutor = members.find((m) => m.userId === overview.case.assignedProsecutorId);
  const assignedSupervisor = members.find(
    (m) => m.userId === overview.case.supervisingProsecutorId,
  );
  const agency = overview.agencies.find((item) => item.id === overview.case.investigatingAgencyId);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [summary, setSummary] = useState(overview.case.summary ?? "");
  const [priority, setPriority] = useState(overview.case.priority ?? "normal");
  const [prosecutorId, setProsecutorId] = useState(overview.case.assignedProsecutorId ?? "");
  const [supervisorId, setSupervisorId] = useState(overview.case.supervisingProsecutorId ?? "");
  const [agencyId, setAgencyId] = useState(overview.case.investigatingAgencyId ?? "");

  async function saveAssignments(event: FormEvent) {
    event.preventDefault();
    if (!overview.canManageCase) return;
    setBusy(true);
    setFormError("");
    try {
      const response = await fetch(`/api/v1/prosecution/cases/${overview.case.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          organizationId,
          summary: summary || null,
          priority,
          assignedProsecutorId: prosecutorId || null,
          supervisingProsecutorId: supervisorId || null,
          investigatingAgencyId: agencyId || null,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not update case.");
      await onUpdated();
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : "Could not update case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 grid gap-3 md:grid-cols-2">
      <section className="rounded-md border border-line p-3 md:col-span-2">
        <h2 className="text-sm font-semibold text-ink">Assignments</h2>
        <ul className="mt-2 space-y-1 text-sm text-ink/80">
          <li>Assigned prosecutor: {memberLabel(assignedProsecutor)}</li>
          <li>Supervising prosecutor: {memberLabel(assignedSupervisor)}</li>
          <li>Investigating agency: {agency?.name ?? "Unassigned"}</li>
        </ul>
        {overview.canManageCase ? (
          <form className="mt-3 grid gap-2 md:grid-cols-2" onSubmit={saveAssignments}>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Summary</span>
              <textarea
                className="w-full rounded border border-line px-2 py-1"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={2}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Priority</span>
              <select
                className="w-full rounded border border-line px-2 py-1"
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              >
                <option value="low">low</option>
                <option value="normal">normal</option>
                <option value="high">high</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Assigned prosecutor</span>
              <select
                className="w-full rounded border border-line px-2 py-1"
                value={prosecutorId}
                onChange={(e) => setProsecutorId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {prosecutors.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {memberLabel(member)} ({humanizeKey(member.roleKey)})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Supervising prosecutor</span>
              <select
                className="w-full rounded border border-line px-2 py-1"
                value={supervisorId}
                onChange={(e) => setSupervisorId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {supervisors.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {memberLabel(member)} ({humanizeKey(member.roleKey)})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm md:col-span-2">
              <span className="mb-1 block text-ink/70">Investigating agency</span>
              <select
                className="w-full rounded border border-line px-2 py-1"
                value={agencyId}
                onChange={(e) => setAgencyId(e.target.value)}
              >
                <option value="">Unassigned</option>
                {overview.agencies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            {formError ? (
              <p className="text-sm text-[var(--ng-danger)] md:col-span-2">{formError}</p>
            ) : null}
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-60 md:col-span-2"
            >
              {busy ? "Saving…" : "Save case assignments"}
            </button>
          </form>
        ) : null}
      </section>
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Defendants</h2>
        <RecordList
          empty="No defendants recorded."
          rows={overview.defendants.map((p) => p.displayName)}
        />
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
          Charges, procedure issues, and element gaps stay separate. This list is not a guilt
          finding, and earlier analysis is not current when new evidence or a contradiction appears.
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
          Joint evidence is shared by more than one defendant. Defendant-specific evidence is listed
          apart from it.
        </p>
        {overview.evidenceScope ? (
          <ul className="mt-2 space-y-1 text-sm text-ink/80">
            <li>Joint items: {overview.evidenceScope.jointEvidenceIds.length}</li>
            <li>Unassigned items: {overview.evidenceScope.unassignedEvidenceIds.length}</li>
            {overview.evidenceScope.byDefendant.map((row) => (
              <li key={row.defendantId}>
                {row.displayName}: {row.specificEvidenceIds.length} specific,{" "}
                {row.jointEvidenceIds.length} joint
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
          <Link
            className="text-sm font-semibold text-accent underline"
            href={`/app/prosecution/${overview.case.id}/elements`}
          >
            Open Elements Matrix
          </Link>
        </div>
        {weak.length === 0 ? (
          <p className="mt-2 text-sm text-ink/60">No element gaps recorded.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {weak.map((gap) => (
              <li
                key={`${gap.elementText}-${gap.status}`}
                className="flex flex-wrap items-center gap-2 text-sm"
              >
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
          rows={overview.hearings.map(
            (h) => `${humanizeKey(h.hearingType)}${h.outcome ? ` — ${h.outcome}` : ""}`,
          )}
        />
      </section>
      <section className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Suppression review</h2>
        <p className="mt-1 text-sm text-ink/70">
          Open Warrants for the separated review. Nyaya does not decide suppression, warrant
          validity, or guilt.
        </p>
        <RecordList
          empty="No suppression review issues are open."
          rows={
            overview.suppressionReview && overview.suppressionReview.issues.length > 0
              ? overview.suppressionReview.issues.map(
                  (issue) => `${humanizeKey(issue.dimension)} — ${humanizeKey(issue.reviewStatus)}`,
                )
              : overview.issueFlags.map(
                  (issue) => `${humanizeKey(issue.issueType)} (${humanizeKey(issue.status)})`,
                )
          }
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
          {rows.length} elements · {rows.filter((r) => r.status !== "SUPPORTED").length} need
          attention
        </p>
        <div className="ml-auto flex gap-1" role="group" aria-label="Element filter">
          <button
            type="button"
            className={
              filter === "all"
                ? "rounded border border-accent px-2 py-1 text-xs font-semibold text-accent"
                : "rounded border border-line px-2 py-1 text-xs"
            }
            onClick={() => setFilter("all")}
            aria-pressed={filter === "all"}
          >
            All
          </button>
          <button
            type="button"
            className={
              filter === "weak"
                ? "rounded border border-accent px-2 py-1 text-xs font-semibold text-accent"
                : "rounded border border-line px-2 py-1 text-xs"
            }
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
      <p className="text-xs text-ink/55">
        Guilt conclusion: none. Statuses describe evidence coverage, not probability of guilt.
      </p>
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
      <p className="text-xs text-ink/55">
        Disclosure decisions require human confirmation. Nyaya does not make the final disclosure
        call.
      </p>
    </div>
  );
}

function DisclosureBody({
  overview,
  organizationId,
  caseId,
  onUpdated,
}: {
  overview: Overview;
  organizationId: string;
  caseId: string;
  onUpdated: () => Promise<void>;
}) {
  const candidates = overview.disclosureCandidates ?? [];
  const canReview = Boolean(overview.canReviewDisclosure);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [category, setCategory] = useState("POTENTIALLY_EXCULPATORY");
  const [notes, setNotes] = useState("");

  async function reviewCandidate(candidateId: string, status: string) {
    if (status === "REVIEWED_DISCLOSE" || status === "REVIEWED_NOT_DISCLOSE") {
      if (!canReview) {
        setError("Final disclosure determination requires prosecution.review.");
        return;
      }
      const ok = window.confirm(
        "Confirm human final disclosure determination? Nyaya does not make this decision.",
      );
      if (!ok) return;
    }
    setBusyId(candidateId);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/prosecution/cases/${caseId}/disclosure?organizationId=${organizationId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ candidateId, status }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data?.error?.message ?? "Could not update disclosure review.");
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update disclosure review.");
    } finally {
      setBusyId("");
    }
  }

  async function createCandidate(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const response = await fetch(
        `/api/v1/prosecution/cases/${caseId}/disclosure?organizationId=${organizationId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            category,
            status: "REVIEW_REQUIRED",
            notes: notes || null,
            provenance: { humanEntered: true, extractionOrigin: "human" },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data?.error?.message ?? "Could not create disclosure candidate.");
      setNotes("");
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create disclosure candidate.");
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <div className="rounded-md border border-line p-3">
        <h2 className="text-sm font-semibold text-ink">Potential disclosure candidates</h2>
        <p className="mt-2 text-xs text-ink/55">
          These are potential disclosure candidates for human review. They are not final disclosure
          determinations, constitutional findings, or mandatory disclosure orders.
        </p>
      </div>
      <form className="rounded-md border border-line p-3 space-y-2" onSubmit={createCandidate}>
        <h3 className="text-sm font-semibold">Flag candidate</h3>
        <label className="block text-sm">
          <span className="mb-1 block text-ink/70">Category</span>
          <select
            className="w-full rounded border border-line px-2 py-1"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {[
              "POTENTIALLY_EXCULPATORY",
              "POTENTIAL_IMPEACHMENT",
              "PRIOR_INCONSISTENT_STATEMENT",
              "EVIDENCE_WEAKENING_ELEMENT",
              "ALTERNATE_SUSPECT",
              "WITNESS_BENEFIT_OR_PROMISE",
              "CONTRADICTORY_EVIDENCE",
              "OTHER",
              "UNKNOWN",
            ].map((value) => (
              <option key={value} value={value}>
                {humanizeKey(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-ink/70">Reason / detected issue</span>
          <textarea
            className="w-full rounded border border-line px-2 py-1"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
          />
        </label>
        <button
          type="submit"
          className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white"
        >
          Flag for review
        </button>
      </form>
      {error ? <p className="text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {candidates.length === 0 ? (
        <EmptyState
          title="No disclosure candidates"
          description="Flag potential disclosure candidates for human review. Final disclose / not-disclose stays with a reviewer."
        />
      ) : (
        <ul className="space-y-3">
          {candidates.map((candidate) => (
            <li key={candidate.id} className="rounded-md border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{candidate.label}</span>
                <StatusLabel label={humanizeKey(candidate.category)} tone="warn" />
                <StatusLabel label={humanizeKey(candidate.status)} />
              </div>
              {candidate.notes ? <p className="mt-2 text-ink/80">{candidate.notes}</p> : null}
              <p className="mt-2 text-xs text-ink/55">
                Provenance:{" "}
                {candidate.provenance.documentId
                  ? `document ${candidate.provenance.documentId}`
                  : candidate.provenance.sourceSpan
                    ? candidate.provenance.sourceSpan
                    : candidate.provenance.humanEntered
                      ? "human-entered"
                      : "recorded"}
              </p>
              <p className="mt-1 text-xs text-ink/55">
                Reviewer:{" "}
                {candidate.reviewer
                  ? candidate.reviewer.name?.trim() || candidate.reviewer.email
                  : "pending"}
                {candidate.reviewedAt
                  ? ` · ${new Date(candidate.reviewedAt).toLocaleString()}`
                  : ""}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busyId === candidate.id}
                  className="rounded border border-line px-2 py-1 text-xs font-semibold"
                  onClick={() => reviewCandidate(candidate.id, "REVIEW_REQUIRED")}
                >
                  Mark review required
                </button>
                <button
                  type="button"
                  disabled={busyId === candidate.id}
                  className="rounded border border-line px-2 py-1 text-xs font-semibold"
                  onClick={() => reviewCandidate(candidate.id, "ESCALATE")}
                >
                  Escalate
                </button>
                <button
                  type="button"
                  disabled={busyId === candidate.id || !canReview}
                  className="rounded border border-line px-2 py-1 text-xs font-semibold disabled:opacity-50"
                  onClick={() => reviewCandidate(candidate.id, "REVIEWED_DISCLOSE")}
                >
                  Human: disclose
                </button>
                <button
                  type="button"
                  disabled={busyId === candidate.id || !canReview}
                  className="rounded border border-line px-2 py-1 text-xs font-semibold disabled:opacity-50"
                  onClick={() => reviewCandidate(candidate.id, "REVIEWED_NOT_DISCLOSE")}
                >
                  Human: do not disclose
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EvidenceBody({
  overview,
  organizationId,
  caseId,
  onUpdated,
}: {
  overview: Overview;
  organizationId: string;
  caseId: string;
  onUpdated: () => Promise<void>;
}) {
  const items = overview.evidenceItems ?? [];
  const [error, setError] = useState("");
  const [evidenceType, setEvidenceType] = useState("report");
  const [collector, setCollector] = useState("");
  const [collectionDate, setCollectionDate] = useState("");
  const [storageReference, setStorageReference] = useState("");
  const [chain, setChain] = useState("");
  const [defendantId, setDefendantId] = useState("");

  async function createEvidence(event: FormEvent) {
    event.preventDefault();
    if (!overview.canManageEvidence) {
      setError("You do not have evidence management permission.");
      return;
    }
    setError("");
    try {
      const response = await fetch(
        `/api/v1/prosecution/cases/${caseId}/evidence?organizationId=${organizationId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            evidenceType,
            collector: collector || null,
            collectionDate: collectionDate || null,
            storageReference: storageReference || null,
            chainOfCustody: chain
              .split("\n")
              .map((line) => line.trim())
              .filter(Boolean),
            relatedDefendantIds: defendantId ? [defendantId] : [],
            provenance: { humanEntered: true, extractionOrigin: "human" },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not add evidence.");
      setCollector("");
      setCollectionDate("");
      setStorageReference("");
      setChain("");
      setDefendantId("");
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add evidence.");
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-ink/55">
        Evidence records do not prove guilt. Scope stays on this criminal case only.
      </p>
      {overview.canManageEvidence ? (
        <form
          className="rounded-md border border-line p-3 grid gap-2 md:grid-cols-2"
          onSubmit={createEvidence}
        >
          <h3 className="text-sm font-semibold md:col-span-2">Add evidence</h3>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Type / label</span>
            <input
              className="w-full rounded border border-line px-2 py-1"
              value={evidenceType}
              onChange={(e) => setEvidenceType(e.target.value)}
              required
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Collector</span>
            <input
              className="w-full rounded border border-line px-2 py-1"
              value={collector}
              onChange={(e) => setCollector(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Collection date</span>
            <input
              type="date"
              className="w-full rounded border border-line px-2 py-1"
              value={collectionDate}
              onChange={(e) => setCollectionDate(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Storage reference</span>
            <input
              className="w-full rounded border border-line px-2 py-1"
              value={storageReference}
              onChange={(e) => setStorageReference(e.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-ink/70">Defendant scope</span>
            <select
              className="w-full rounded border border-line px-2 py-1"
              value={defendantId}
              onChange={(e) => setDefendantId(e.target.value)}
            >
              <option value="">Joint / unassigned</option>
              {overview.defendants.map((defendant) => (
                <option key={defendant.id} value={defendant.id}>
                  {defendant.displayName}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-ink/70">Chain of custody (one transfer per line)</span>
            <textarea
              className="w-full rounded border border-line px-2 py-1"
              rows={3}
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              placeholder={"Collected by Officer A\nLogged into evidence room"}
            />
          </label>
          <button
            type="submit"
            className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white md:col-span-2"
          >
            Add evidence
          </button>
        </form>
      ) : null}
      {error ? <p className="text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {items.length === 0 ? (
        <EmptyState
          title="No evidence items yet"
          description="Add evidence items linked to this criminal case. Evidence stays case-scoped."
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id} className="rounded-md border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{item.evidenceType}</span>
                <StatusLabel label={humanizeKey(item.scope)} />
                <StatusLabel label={humanizeKey(item.reviewStatus)} tone="neutral" />
              </div>
              <ul className="mt-2 space-y-1 text-ink/80">
                <li>Collector: {item.collector ?? "—"}</li>
                <li>Collected: {item.collectionDate ?? "date unknown"}</li>
                <li>Storage: {item.storageReference ?? "—"}</li>
                <li>Source agency: {item.sourceAgency ?? "—"}</li>
                <li>
                  Provenance:{" "}
                  {item.provenance.documentId
                    ? `document ${item.provenance.documentId}`
                    : item.provenance.humanEntered
                      ? "human-entered"
                      : (item.provenance.sourceSpan ?? "recorded")}
                </li>
                <li>
                  Linked defendants: {item.relatedDefendantIds.length || "none"} · charges:{" "}
                  {item.relatedChargeIds.length} · elements: {item.relatedElementIds.length}
                </li>
              </ul>
              <div className="mt-3">
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/55">
                  Chain of custody
                </h4>
                {item.custodyTransfers.length === 0 ? (
                  <p className="mt-1 text-ink/60">No custody transfers recorded.</p>
                ) : (
                  <ol className="mt-1 list-decimal space-y-1 pl-5">
                    {item.custodyTransfers.map((transfer, index) => (
                      <li key={`${item.id}-${index}`}>
                        {transfer.from ? `${transfer.from} → ` : ""}
                        {transfer.to}
                        {transfer.timestamp ? ` · ${transfer.timestamp}` : ""}
                        {transfer.location ? ` · ${transfer.location}` : ""}
                      </li>
                    ))}
                  </ol>
                )}
                {item.custodyFindings.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {item.custodyFindings.map((finding, index) => (
                      <li key={`${item.id}-finding-${index}`} className="text-xs text-ink/70">
                        <StatusLabel
                          label={humanizeKey(finding.code)}
                          tone={
                            finding.code === "CHAIN_GAP" ||
                            finding.code === "SEQUENCE_INCONSISTENCY"
                              ? "warn"
                              : "neutral"
                          }
                        />{" "}
                        {finding.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 text-xs text-ink/55">
                  Custody warnings are operational. They do not claim tampering, fabrication, or
                  planted evidence.
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function WitnessesBody({
  overview,
  organizationId,
  caseId,
  onUpdated,
}: {
  overview: Overview;
  organizationId: string;
  caseId: string;
  onUpdated: () => Promise<void>;
}) {
  const witnesses = overview.witnesses ?? [];
  const [error, setError] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [witnessType, setWitnessType] = useState("civilian");
  const [selectedWitnessId, setSelectedWitnessId] = useState("");
  const [statementType, setStatementType] = useState("interview");
  const [claimKey, setClaimKey] = useState("location");
  const [claimValue, setClaimValue] = useState("");

  async function createWitness(event: FormEvent) {
    event.preventDefault();
    if (!overview.canManageWitnesses) {
      setError("You do not have witness management permission.");
      return;
    }
    setError("");
    try {
      const response = await fetch(
        `/api/v1/prosecution/cases/${caseId}/witnesses?organizationId=${organizationId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            displayName,
            witnessType,
            provenance: { humanEntered: true, extractionOrigin: "human" },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not add witness.");
      setDisplayName("");
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add witness.");
    }
  }

  async function createStatement(event: FormEvent) {
    event.preventDefault();
    if (!selectedWitnessId) {
      setError("Select a witness before adding a statement.");
      return;
    }
    setError("");
    try {
      const response = await fetch(
        `/api/v1/prosecution/cases/${caseId}/statements?organizationId=${organizationId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            witnessId: selectedWitnessId,
            statementType,
            claims: claimValue ? [{ key: claimKey, value: claimValue, kind: "fact" }] : [],
            provenance: { humanEntered: true, extractionOrigin: "human" },
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not add statement.");
      setClaimValue("");
      await onUpdated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not add statement.");
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <p className="text-xs text-ink/55">
        Statement comparisons are structural labels only. Nyaya does not label a witness as
        dishonest.
      </p>
      {overview.canManageWitnesses ? (
        <>
          <form
            className="rounded-md border border-line p-3 grid gap-2 md:grid-cols-2"
            onSubmit={createWitness}
          >
            <h3 className="text-sm font-semibold md:col-span-2">Add witness</h3>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Name</span>
              <input
                className="w-full rounded border border-line px-2 py-1"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Type</span>
              <input
                className="w-full rounded border border-line px-2 py-1"
                value={witnessType}
                onChange={(e) => setWitnessType(e.target.value)}
                required
              />
            </label>
            <button
              type="submit"
              className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white md:col-span-2"
            >
              Add witness
            </button>
          </form>
          <form
            className="rounded-md border border-line p-3 grid gap-2 md:grid-cols-2"
            onSubmit={createStatement}
          >
            <h3 className="text-sm font-semibold md:col-span-2">Add statement</h3>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Witness</span>
              <select
                className="w-full rounded border border-line px-2 py-1"
                value={selectedWitnessId}
                onChange={(e) => setSelectedWitnessId(e.target.value)}
                required
              >
                <option value="">Select…</option>
                {witnesses.map((witness) => (
                  <option key={witness.id} value={witness.id}>
                    {witness.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Statement type</span>
              <input
                className="w-full rounded border border-line px-2 py-1"
                value={statementType}
                onChange={(e) => setStatementType(e.target.value)}
                required
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Claim key</span>
              <input
                className="w-full rounded border border-line px-2 py-1"
                value={claimKey}
                onChange={(e) => setClaimKey(e.target.value)}
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-ink/70">Claim value</span>
              <input
                className="w-full rounded border border-line px-2 py-1"
                value={claimValue}
                onChange={(e) => setClaimValue(e.target.value)}
              />
            </label>
            <button
              type="submit"
              className="rounded bg-accent px-3 py-2 text-sm font-semibold text-white md:col-span-2"
            >
              Add statement
            </button>
          </form>
        </>
      ) : null}
      {error ? <p className="text-sm text-[var(--ng-danger)]">{error}</p> : null}
      {witnesses.length === 0 ? (
        <EmptyState
          title="No witnesses yet"
          description="Record witnesses and statements for this case. Nyaya does not label truthfulness."
        />
      ) : (
        <ul className="space-y-3">
          {witnesses.map((witness) => (
            <li key={witness.id} className="rounded-md border border-line p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{witness.displayName}</span>
                <StatusLabel label={humanizeKey(witness.witnessType)} />
              </div>
              {witness.notes ? <p className="mt-1 text-ink/70">{witness.notes}</p> : null}
              <h4 className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink/55">
                Statements
              </h4>
              {witness.statements.length === 0 ? (
                <p className="mt-1 text-ink/60">No statements recorded.</p>
              ) : (
                <ul className="mt-1 space-y-2">
                  {witness.statements.map((statement) => (
                    <li key={statement.id} className="rounded border border-line/70 px-2 py-1">
                      <div className="flex flex-wrap gap-2">
                        <span className="font-semibold">
                          {humanizeKey(statement.statementType)}
                        </span>
                        <span className="text-ink/60">
                          {statement.statementDate ?? "date unknown"}
                        </span>
                      </div>
                      <p className="text-xs text-ink/55">
                        Source:{" "}
                        {statement.provenance.documentId
                          ? `document ${statement.provenance.documentId}`
                          : statement.sourceSpan ||
                            statement.provenance.sourceSpan ||
                            "human-entered"}
                      </p>
                      {statement.claims.length > 0 ? (
                        <ul className="mt-1 list-disc pl-4 text-ink/80">
                          {statement.claims.map((claim) => (
                            <li key={`${statement.id}-${claim.key}`}>
                              {claim.key}: {claim.value}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {witness.statementComparison.length > 0 ? (
                <div className="mt-3">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/55">
                    Statement comparison
                  </h4>
                  <ul className="mt-1 space-y-1">
                    {witness.statementComparison.map((row) => (
                      <li
                        key={`${witness.id}-${row.key}-${row.label}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <StatusLabel
                          label={humanizeKey(row.label)}
                          tone={row.label === "CONTRADICTORY" ? "warn" : "neutral"}
                        />
                        <span className="text-ink/80">
                          {row.key}: {row.detail}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-ink/55">
                    Related potential disclosure candidates appear on Disclosure and still require
                    human review.
                  </p>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubpoenasBody({ overview }: { overview: Overview }) {
  if (overview.subpoenas.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="No subpoenas"
          description="Issued subpoenas and return deadlines for this case will appear here."
        />
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
        <EmptyState
          title="No motions"
          description="Motions filed on this case appear here. Filing still requires a person."
        />
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {overview.motions.map((motion) => (
        <li
          key={motion.id}
          className="flex flex-wrap items-center gap-2 rounded border border-line px-3 py-2"
        >
          <span className="font-semibold">{humanizeKey(motion.motionType)}</span>
          <StatusLabel label={humanizeKey(motion.status)} />
          {motion.filingParty ? (
            <span className="text-ink/60">· {humanizeKey(motion.filingParty)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function HearingsBody({ overview }: { overview: Overview }) {
  if (overview.hearings.length === 0) {
    return (
      <div className="mt-4">
        <EmptyState
          title="No hearings"
          description="Schedule hearings to track court dates, participants, and outcomes."
        />
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
        <EmptyState
          title="No open tasks"
          description="Create case tasks for follow-ups, disclosures, and hearing prep."
        />
      </div>
    );
  }
  return (
    <ul className="mt-4 space-y-2 text-sm">
      {overview.openTasks.map((task) => (
        <li
          key={task.id}
          className="flex flex-wrap items-center gap-2 rounded border border-line px-3 py-2"
        >
          <span>{task.title}</span>
          <StatusLabel label={humanizeKey(task.status)} />
        </li>
      ))}
    </ul>
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
