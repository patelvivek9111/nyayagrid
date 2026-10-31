"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState, StatusLabel } from "@/components/ux";
import { Button } from "@nyayagrid/ui";
import { humanizeKey } from "@/lib/plain-labels";

type OfficeOverview = {
  counts: {
    totalActiveCases: number;
    unassignedCases: number;
    highPriorityCases: number;
    casesAwaitingSupervisorReview: number;
    disclosureCandidatesAwaitingFinal: number;
    pendingDiscoveryProduction: number;
    upcomingHearings: number;
    overdueTasks: number;
    openInvestigationGaps: number;
    chainOfCustodyWarnings: number;
    openProcedureIssues: number;
    convictionRate: null;
    prosecutorPerformanceScore: null;
  };
  caseload: {
    rows: Array<{
      id: string;
      caseNumber: string;
      caseStatus: string;
      priority: string;
      assignedProsecutorName: string | null;
      supervisingProsecutorName: string | null;
      openTaskCount: number;
      disclosurePendingCount: number;
      procedureIssueCount: number;
      evidenceGapCount: number;
      nextHearing: string | null;
      custodyWarning: boolean;
    }>;
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  workload: Array<{
    userId: string;
    name: string | null;
    email: string | null;
    activeCaseCount: number;
    highPriorityCaseCount: number;
    openTaskCount: number;
    upcomingHearingCount: number;
    pendingReviewCount: number;
    convictionRate: null;
  }>;
  myWork: {
    cases: Array<{
      id: string;
      caseNumber: string;
      caseStatus: string;
      priority: string;
      role: string;
    }>;
    tasks: Array<{ id: string; title: string; status: string; criminalCaseId: string }>;
    overdueTasks: Array<{ id: string; title: string; criminalCaseId: string }>;
    upcomingHearings: Array<{
      id: string;
      hearingType: string;
      caseNumber: string;
      dateTime: string | null;
    }>;
    disclosurePending: Array<{ id: string; category: string; criminalCaseId: string }>;
  };
  reviewQueues: Record<
    string,
    Array<{ id: string; caseId: string; caseNumber: string; label: string; status: string }>
  >;
  calendarEvents: Array<{
    id: string;
    caseId: string;
    caseNumber: string;
    eventType: string;
    title: string;
    dateTime: string;
    dateOrigin: string;
  }>;
  attentionFlags: Array<{
    caseId: string;
    caseNumber: string;
    kind: string;
    label: string;
    severity: string;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    targetType: string | null;
    createdAt: string;
  }>;
  members: Array<{
    userId: string;
    name: string | null;
    email: string;
    roleKey: string;
    canBeProsecutor: boolean;
    canBeSupervisor: boolean;
  }>;
  assignmentSuggestions: Array<{ userId: string; activeCaseCount: number; suggestionOnly: true }>;
  viewer: { canReview: boolean; canManageCase: boolean; canAudit: boolean };
  safety: {
    convictionRate: null;
    outcomeBasedRanking: false;
    inventedDeadlines: false;
  };
};

type Tab = "command" | "my-work" | "supervisor" | "caseload" | "calendar" | "admin";

export default function ProsecutionOfficePage() {
  const router = useRouter();
  const { organizationId } = useActiveOrganization();
  const [tab, setTab] = useState<Tab>("command");
  const [overview, setOverview] = useState<OfficeOverview | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [caseNumber, setCaseNumber] = useState("");
  const [jurisdiction, setJurisdiction] = useState("PA");
  const [court, setCourt] = useState("st-pa-trial");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  const [searchHits, setSearchHits] = useState<
    Array<{ id: string; caseNumber: string; caseStatus: string }>
  >([]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        organizationId,
        page: "1",
        pageSize: "25",
      });
      if (query.trim()) params.set("q", query.trim());
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (unassignedOnly) params.set("unassignedOnly", "1");
      const response = await fetch(`/api/v1/prosecution/office?${params.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not load office overview.");
      setOverview(data.overview);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load office overview.");
    } finally {
      setLoading(false);
    }
  }, [organizationId, query, statusFilter, unassignedOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    if (!organizationId) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/v1/prosecution/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId, caseNumber, jurisdiction, court }),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data?.error?.message ?? "Could not open the criminal case.");
      router.push(`/app/prosecution/${data.criminalCase.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open the criminal case.");
      setSaving(false);
    }
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!organizationId || !query.trim()) return;
    const response = await fetch(
      `/api/v1/prosecution/office?organizationId=${organizationId}&mode=search&q=${encodeURIComponent(query.trim())}`,
    );
    const data = await response.json();
    if (response.ok) setSearchHits(data.results ?? []);
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "command", label: "Command center" },
    { id: "my-work", label: "My work" },
    { id: "supervisor", label: "Supervisor" },
    { id: "caseload", label: "Caseload" },
    { id: "calendar", label: "Calendar" },
    { id: "admin", label: "Office admin" },
  ];

  return (
    <ProfessionalShell title="Prosecution">
      <p className="mb-4 max-w-3xl text-sm text-ink/70">
        Office operations for caseload, assignments, review queues, deadlines, and supervision.
        Workload visibility only — no conviction rates, guilt scores, or outcome-based prosecutor
        ranking.
      </p>
      {loading ? <LoadingState label="Loading prosecution office" /> : null}
      {error ? <ErrorState message={error} /> : null}

      <form className="mb-4 grid gap-2 md:grid-cols-4" onSubmit={onCreate}>
        <label className="text-sm text-ink/80">
          Case number
          <input
            required
            value={caseNumber}
            onChange={(event) => setCaseNumber(event.target.value)}
            className="mt-1 w-full rounded border border-line px-2 py-1"
          />
        </label>
        <label className="text-sm text-ink/80">
          Jurisdiction
          <input
            required
            value={jurisdiction}
            onChange={(event) => setJurisdiction(event.target.value)}
            className="mt-1 w-full rounded border border-line px-2 py-1"
          />
        </label>
        <label className="text-sm text-ink/80">
          Court id
          <input
            required
            value={court}
            onChange={(event) => setCourt(event.target.value)}
            className="mt-1 w-full rounded border border-line px-2 py-1"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={saving || !organizationId}>
            {saving ? "Opening…" : "Open criminal case"}
          </Button>
        </div>
      </form>

      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`rounded border px-3 py-1 text-sm ${
              tab === item.id ? "border-accent bg-accent/10 font-semibold" : "border-line"
            }`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {overview ? (
        <>
          {tab === "command" ? (
            <div className="space-y-6">
              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["Active cases", overview.counts.totalActiveCases],
                  ["Unassigned", overview.counts.unassignedCases],
                  ["High priority", overview.counts.highPriorityCases],
                  ["Supervisor review", overview.counts.casesAwaitingSupervisorReview],
                  ["Disclosure queue", overview.counts.disclosureCandidatesAwaitingFinal],
                  ["Upcoming hearings", overview.counts.upcomingHearings],
                  ["Overdue tasks", overview.counts.overdueTasks],
                  ["Investigation gaps", overview.counts.openInvestigationGaps],
                  ["Custody warnings", overview.counts.chainOfCustodyWarnings],
                  ["Procedure issues", overview.counts.openProcedureIssues],
                  ["Pending production", overview.counts.pendingDiscoveryProduction],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded border border-line px-3 py-2">
                    <div className="text-xs uppercase tracking-wide text-ink/55">{label}</div>
                    <div className="text-2xl font-semibold text-ink">{value}</div>
                  </div>
                ))}
              </section>
              <p className="text-xs text-ink/55">
                Conviction rate: none · Prosecutor performance score: none · Invented deadlines: no
              </p>
              <section>
                <h2 className="text-sm font-semibold text-ink">Attention items</h2>
                {(overview.attentionFlags ?? []).length === 0 ? (
                  <p className="mt-2 text-sm text-ink/60">No operational attention flags.</p>
                ) : (
                  <ul className="mt-2 space-y-1 text-sm">
                    {overview.attentionFlags.slice(0, 20).map((flag) => (
                      <li
                        key={`${flag.caseId}-${flag.kind}`}
                        className="rounded border border-line/70 px-2 py-1"
                      >
                        <Link
                          className="font-semibold text-accent underline"
                          href={`/app/prosecution/${flag.caseId}`}
                        >
                          {flag.caseNumber}
                        </Link>{" "}
                        · {flag.label} · <StatusLabel label={humanizeKey(flag.severity)} />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
              {overview.viewer.canAudit ? (
                <section>
                  <h2 className="text-sm font-semibold text-ink">Recent activity</h2>
                  <ul className="mt-2 space-y-1 text-sm">
                    {overview.recentActivity.slice(0, 15).map((event) => (
                      <li key={event.id} className="text-ink/75">
                        {humanizeKey(event.action)} · {event.targetType ?? "target"} ·{" "}
                        {new Date(event.createdAt).toLocaleString()}
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </div>
          ) : null}

          {tab === "my-work" ? (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-ink">Assigned to me</h2>
              {overview.myWork.cases.length === 0 ? (
                <EmptyState
                  title="No assigned cases"
                  description="Cases assigned to you appear here."
                />
              ) : (
                <ul className="space-y-1 text-sm">
                  {overview.myWork.cases.map((row) => (
                    <li key={row.id} className="rounded border border-line px-3 py-2">
                      <Link
                        className="font-semibold text-accent underline"
                        href={`/app/prosecution/${row.id}`}
                      >
                        {row.caseNumber}
                      </Link>{" "}
                      <StatusLabel label={humanizeKey(row.caseStatus)} /> · {humanizeKey(row.role)}{" "}
                      · {humanizeKey(row.priority)}
                    </li>
                  ))}
                </ul>
              )}
              <h2 className="text-sm font-semibold text-ink">My tasks</h2>
              <ul className="space-y-1 text-sm">
                {overview.myWork.tasks.slice(0, 20).map((task) => (
                  <li key={task.id}>
                    {task.title} · <StatusLabel label={humanizeKey(task.status)} />
                  </li>
                ))}
              </ul>
              <h2 className="text-sm font-semibold text-ink">Overdue</h2>
              <ul className="space-y-1 text-sm">
                {overview.myWork.overdueTasks.map((task) => (
                  <li key={task.id}>{task.title}</li>
                ))}
              </ul>
              <h2 className="text-sm font-semibold text-ink">Upcoming hearings</h2>
              <ul className="space-y-1 text-sm">
                {overview.myWork.upcomingHearings.map((hearing) => (
                  <li key={hearing.id}>
                    {hearing.caseNumber} · {humanizeKey(hearing.hearingType)} ·{" "}
                    {hearing.dateTime ?? "UNKNOWN / NOT PROVIDED"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {tab === "supervisor" ? (
            <div className="space-y-4">
              {!overview.viewer.canReview ? (
                <p className="text-sm text-ink/70">
                  Supervisor queues require prosecution.review. Your role can still use caseload and
                  My Work.
                </p>
              ) : null}
              <h2 className="text-sm font-semibold text-ink">Workload by prosecutor</h2>
              <p className="text-xs text-ink/55">
                Active cases and open work only. No conviction or plea-efficiency ranking.
              </p>
              <div className="overflow-x-auto rounded border border-line">
                <table className="min-w-full text-left text-sm">
                  <thead className="border-b border-line bg-black/[0.02] text-xs uppercase text-ink/55">
                    <tr>
                      <th className="px-3 py-2">Prosecutor</th>
                      <th className="px-3 py-2">Active</th>
                      <th className="px-3 py-2">High priority</th>
                      <th className="px-3 py-2">Open tasks</th>
                      <th className="px-3 py-2">Hearings</th>
                      <th className="px-3 py-2">Pending review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.workload.map((row) => (
                      <tr key={row.userId} className="border-b border-line/70">
                        <td className="px-3 py-2">{row.name ?? row.email ?? row.userId}</td>
                        <td className="px-3 py-2">{row.activeCaseCount}</td>
                        <td className="px-3 py-2">{row.highPriorityCaseCount}</td>
                        <td className="px-3 py-2">{row.openTaskCount}</td>
                        <td className="px-3 py-2">{row.upcomingHearingCount}</td>
                        <td className="px-3 py-2">{row.pendingReviewCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {Object.entries(overview.reviewQueues).map(([queue, items]) => (
                <section key={queue}>
                  <h3 className="text-sm font-semibold text-ink">{humanizeKey(queue)}</h3>
                  {items.length === 0 ? (
                    <p className="mt-1 text-sm text-ink/60">Empty</p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-sm">
                      {items.slice(0, 10).map((item) => (
                        <li key={`${queue}-${item.id}`}>
                          <Link
                            className="font-semibold text-accent underline"
                            href={`/app/prosecution/${item.caseId}`}
                          >
                            {item.caseNumber}
                          </Link>{" "}
                          · {item.label} · <StatusLabel label={humanizeKey(item.status)} />
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          ) : null}

          {tab === "caseload" ? (
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-64 rounded border border-line px-2 py-1 text-sm"
                  placeholder="Filter case number, court…"
                  aria-label="Filter criminal cases"
                />
                <select
                  className="rounded border border-line px-2 py-1 text-sm"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value)}
                  aria-label="Filter by case status"
                >
                  <option value="all">All statuses</option>
                  <option value="open">open</option>
                  <option value="CLOSED">CLOSED</option>
                  <option value="ACTIVE">ACTIVE</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-ink/80">
                  <input
                    type="checkbox"
                    checked={unassignedOnly}
                    onChange={(event) => setUnassignedOnly(event.target.checked)}
                  />
                  Unassigned only
                </label>
                <Button type="button" variant="secondary" onClick={() => void load()}>
                  Apply
                </Button>
              </div>
              {overview.caseload.rows.length === 0 ? (
                <EmptyState
                  title="No matching cases"
                  description="Adjust filters or open a new case."
                />
              ) : (
                <div className="overflow-x-auto rounded border border-line">
                  <table className="min-w-full text-left text-sm">
                    <thead className="border-b border-line bg-black/[0.02] text-xs uppercase text-ink/55">
                      <tr>
                        <th className="px-3 py-2">Case</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Priority</th>
                        <th className="px-3 py-2">Prosecutor</th>
                        <th className="px-3 py-2">Supervisor</th>
                        <th className="px-3 py-2">Tasks</th>
                        <th className="px-3 py-2">Disclosure</th>
                        <th className="px-3 py-2">Gaps</th>
                        <th className="px-3 py-2">Next hearing</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview.caseload.rows.map((row) => (
                        <tr key={row.id} className="border-b border-line/70">
                          <td className="px-3 py-2">
                            <Link
                              className="font-semibold text-accent underline"
                              href={`/app/prosecution/${row.id}`}
                            >
                              {row.caseNumber}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            <StatusLabel label={humanizeKey(row.caseStatus)} />
                          </td>
                          <td className="px-3 py-2">{humanizeKey(row.priority)}</td>
                          <td className="px-3 py-2">
                            {row.assignedProsecutorName ?? "Unassigned"}
                          </td>
                          <td className="px-3 py-2">{row.supervisingProsecutorName ?? "—"}</td>
                          <td className="px-3 py-2">{row.openTaskCount}</td>
                          <td className="px-3 py-2">{row.disclosurePendingCount}</td>
                          <td className="px-3 py-2">
                            {row.evidenceGapCount}
                            {row.custodyWarning ? " · custody" : ""}
                          </td>
                          <td className="px-3 py-2">
                            {row.nextHearing ?? "UNKNOWN / NOT PROVIDED"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-ink/55">
                Page {overview.caseload.page} of {overview.caseload.totalPages} ·{" "}
                {overview.caseload.total} cases
              </p>
            </div>
          ) : null}

          {tab === "calendar" ? (
            <div className="space-y-3">
              <p className="text-sm text-ink/70">
                Source-backed or human-entered dates only. Nyaya does not invent procedural
                deadlines.
              </p>
              {overview.calendarEvents.length === 0 ? (
                <EmptyState
                  title="No upcoming events"
                  description="Hearings, tasks, and return dates appear here."
                />
              ) : (
                <ul className="space-y-2 text-sm">
                  {overview.calendarEvents.map((event) => (
                    <li key={event.id} className="rounded border border-line px-3 py-2">
                      <Link
                        className="font-semibold text-accent underline"
                        href={`/app/prosecution/${event.caseId}`}
                      >
                        {event.caseNumber}
                      </Link>{" "}
                      · <StatusLabel label={humanizeKey(event.eventType)} /> · {event.title} ·{" "}
                      {event.dateTime} · origin {humanizeKey(event.dateOrigin)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {tab === "admin" ? (
            <div className="space-y-4">
              <form className="flex flex-wrap gap-2" onSubmit={runSearch}>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-72 rounded border border-line px-2 py-1 text-sm"
                  placeholder="Authorized office search"
                  aria-label="Office search"
                />
                <Button type="submit" variant="secondary">
                  Search
                </Button>
              </form>
              {searchHits.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {searchHits.map((hit) => (
                    <li key={hit.id}>
                      <Link
                        className="font-semibold text-accent underline"
                        href={`/app/prosecution/${hit.id}`}
                      >
                        {hit.caseNumber}
                      </Link>{" "}
                      · {humanizeKey(hit.caseStatus)}
                    </li>
                  ))}
                </ul>
              ) : null}
              <h2 className="text-sm font-semibold text-ink">Office members</h2>
              <ul className="space-y-1 text-sm">
                {overview.members.map((member) => (
                  <li key={member.userId} className="rounded border border-line/70 px-2 py-1">
                    {member.name ?? member.email} · {humanizeKey(member.roleKey)}
                    {member.canBeSupervisor ? " · review" : ""}
                    {member.canBeProsecutor ? " · case work" : ""}
                  </li>
                ))}
              </ul>
              <h2 className="text-sm font-semibold text-ink">
                Assignment suggestions (deterministic only)
              </h2>
              <p className="text-xs text-ink/55">
                Suggestions use active-case count only. They are never auto-applied.
              </p>
              <ul className="space-y-1 text-sm">
                {overview.assignmentSuggestions.slice(0, 10).map((row) => {
                  const member = overview.members.find((m) => m.userId === row.userId);
                  return (
                    <li key={row.userId}>
                      {member?.name ?? member?.email ?? row.userId} · active cases{" "}
                      {row.activeCaseCount} · suggestion only
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </ProfessionalShell>
  );
}
