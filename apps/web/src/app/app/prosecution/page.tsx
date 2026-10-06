"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState, StatusLabel } from "@/components/ux";
import { Button } from "@nyayagrid/ui";
import { humanizeKey } from "@/lib/plain-labels";

type CaseRow = {
  id: string;
  caseNumber: string;
  caseStatus: string;
  jurisdiction: string;
  court: string;
  updatedAt?: string | null;
};

export default function ProsecutionListPage() {
  const router = useRouter();
  const { organizationId } = useActiveOrganization();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [caseNumber, setCaseNumber] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [court, setCourt] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    fetch(`/api/v1/prosecution/cases?organizationId=${organizationId}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? "Could not load prosecution cases.");
        if (!cancelled) setCases(data.cases ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load prosecution cases.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

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
      if (!response.ok) throw new Error(data?.error?.message ?? "Could not open the criminal case.");
      router.push(`/app/prosecution/${data.criminalCase.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not open the criminal case.");
      setSaving(false);
    }
  }

  const filtered = cases.filter((row) => {
    const haystack = `${row.caseNumber} ${row.jurisdiction} ${row.court} ${row.caseStatus}`.toLowerCase();
    const matchesQuery = !query.trim() || haystack.includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === "all" || row.caseStatus === statusFilter;
    return matchesQuery && matchesStatus;
  });

  const statuses = Array.from(new Set(cases.map((row) => row.caseStatus))).sort();

  return (
    <ProfessionalShell title="Prosecution">
      <p className="mb-4 max-w-2xl text-sm text-ink/70">
        Criminal cases for this office. Search and open a case to work charges, the Elements Matrix,
        discovery, and disclosure review — without guilt scoring.
      </p>
      {loading ? <LoadingState label="Loading prosecution cases" /> : null}
      {error ? <ErrorState message={error} /> : null}
      <form className="mb-6 grid gap-2 md:grid-cols-4" onSubmit={onCreate}>
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
            placeholder="PA"
          />
        </label>
        <label className="text-sm text-ink/80">
          Court id
          <input
            required
            value={court}
            onChange={(event) => setCourt(event.target.value)}
            className="mt-1 w-full rounded border border-line px-2 py-1"
            placeholder="st-pa-trial"
          />
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={saving || !organizationId}>
            {saving ? "Opening…" : "Open criminal case"}
          </Button>
        </div>
      </form>

      <div className="mb-3 flex flex-wrap gap-2">
        <label className="text-sm text-ink/80">
          <span className="sr-only">Search cases</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="w-64 rounded border border-line px-2 py-1"
            placeholder="Search case number, court…"
            aria-label="Search criminal cases"
          />
        </label>
        <label className="text-sm text-ink/80">
          Status
          <select
            className="ml-2 rounded border border-line px-2 py-1"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Filter by case status"
          >
            <option value="all">All statuses</option>
            {statuses.map((status) => (
              <option key={status} value={status}>
                {humanizeKey(status)}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!loading && !error && cases.length === 0 ? (
        <EmptyState
          title="No criminal cases"
          description="Open the first criminal case for this office to start charges, evidence, and disclosure review."
        />
      ) : null}
      {!loading && cases.length > 0 && filtered.length === 0 ? (
        <EmptyState
          title="No matching cases"
          description="Clear the search or status filter to see all criminal cases in this office."
          action={
            <Button type="button" variant="secondary" onClick={() => { setQuery(""); setStatusFilter("all"); }}>
              Clear filters
            </Button>
          }
        />
      ) : null}

      {filtered.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Criminal cases</caption>
            <thead className="border-b border-line bg-black/[0.02] text-xs uppercase tracking-wide text-ink/55">
              <tr>
                <th className="px-3 py-2 font-semibold">Case number</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Jurisdiction</th>
                <th className="px-3 py-2 font-semibold">Court</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((criminalCase) => (
                <tr key={criminalCase.id} className="border-b border-line/70">
                  <td className="px-3 py-2">
                    <Link className="font-semibold text-accent underline" href={`/app/prosecution/${criminalCase.id}`}>
                      {criminalCase.caseNumber}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusLabel label={humanizeKey(criminalCase.caseStatus)} tone="info" />
                  </td>
                  <td className="px-3 py-2 text-ink/80">{criminalCase.jurisdiction}</td>
                  <td className="px-3 py-2 text-ink/80">{criminalCase.court}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </ProfessionalShell>
  );
}
