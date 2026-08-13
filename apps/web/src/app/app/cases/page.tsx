"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { Button } from "@nyayagrid/ui";

type CaseRow = {
  id: string;
  title: string;
  matterNumber: string;
  status: string;
  clientDisplayName: string;
  practiceArea: string | null;
  jurisdiction: string | null;
};

export default function CasesListPage() {
  const { organizationId, loading: orgLoading } = useActiveOrganization();
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    fetch(`/api/v1/matters?organizationId=${organizationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load cases");
        setCases(data.matters ?? []);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [organizationId]);

  return (
    <ProfessionalShell title="Cases">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink/60">Select a Case to open its workspace and chats.</p>
        <Link href="/app/cases/new">
          <Button type="button">New Case</Button>
        </Link>
      </div>
      {orgLoading || loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && cases.length === 0 ? (
        <EmptyState
          title="No cases yet"
          description="Create a Case to organize documents, chats, and Case intelligence."
          action={
            <Link href="/app/cases/new" className="text-sm font-semibold text-accent underline">
              Create Case
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {cases.map((c) => (
            <li key={c.id}>
              <Link href={`/app/cases/${c.id}`} className="block px-4 py-3 hover:bg-accent-soft/30">
                <p className="font-semibold text-ink">{c.title}</p>
                <p className="text-xs text-ink/55">
                  {c.matterNumber} · {c.clientDisplayName} · {c.status}
                  {c.jurisdiction ? ` · ${c.jurisdiction}` : ""}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ProfessionalShell>
  );
}
