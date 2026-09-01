"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { useOrgCapability } from "@/components/use-org-capability";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { Button } from "@nyayagrid/ui";
import { isClientGuestRole } from "@/lib/first-run";

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
  const router = useRouter();
  const { organizationId, organizations, loading: orgLoading } = useActiveOrganization();
  const createCap = useOrgCapability(organizationId, "matters.create");
  const viewCap = useOrgCapability(organizationId, "matters.view");
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (orgLoading) return;
    if (organizations.length === 0) {
      router.replace("/app/onboarding");
      return;
    }
    if (isClientGuestRole(viewCap.roleKey)) {
      router.replace("/portal");
    }
  }, [orgLoading, organizations.length, viewCap.roleKey, router]);

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

  const canCreate = createCap.allowed === true;

  return (
    <ProfessionalShell title="Cases">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-ink/60">Open a case to see its files, chats, and next steps.</p>
        {canCreate ? (
          <Link href="/app/cases/new">
            <Button type="button">New Case</Button>
          </Link>
        ) : null}
      </div>
      {orgLoading || loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && cases.length === 0 ? (
        <EmptyState
          title="No Cases yet"
          description={
            canCreate
              ? "Create your first Case to add documents and start working with Nyaya."
              : "This firm has no Cases yet. A lawyer on the team can create one."
          }
          action={
            canCreate ? (
              <Link href="/app/cases/new" className="text-sm font-semibold text-accent underline">
                Create Case
              </Link>
            ) : undefined
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
