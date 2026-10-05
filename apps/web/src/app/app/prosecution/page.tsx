"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { Button } from "@nyayagrid/ui";

type CaseRow = { id: string; caseNumber: string; caseStatus: string; jurisdiction: string; court: string };

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

  return (
    <ProfessionalShell title="Prosecution">
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
      {!loading && !error && cases.length === 0 ? (
        <EmptyState title="No criminal cases" description="Criminal cases opened for this office will appear here." />
      ) : null}
      <ul className="space-y-2">
        {cases.map((criminalCase) => (
          <li key={criminalCase.id}>
            <Link className="font-semibold text-accent underline" href={`/app/prosecution/${criminalCase.id}`}>
              {criminalCase.caseNumber}
            </Link>
            <span className="ml-2 text-sm text-ink/60">
              {criminalCase.caseStatus} · {criminalCase.jurisdiction}
            </span>
          </li>
        ))}
      </ul>
    </ProfessionalShell>
  );
}
