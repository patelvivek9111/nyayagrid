"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { EmptyState, LoadingState, ErrorState } from "@/components/ux";

type Session = {
  id: string;
  title: string;
  status: string;
  matterId: string | null;
  updatedAt: string;
};

export default function ChatsListPage() {
  const { organizationId } = useActiveOrganization();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!organizationId) return;
    setLoading(true);
    fetch(`/api/v1/research/sessions?organizationId=${organizationId}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error?.message ?? "Failed to load chats");
        setSessions((data.sessions ?? []).filter((s: Session) => !s.matterId));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [organizationId]);

  return (
    <ProfessionalShell title="Chats">
      <p className="mb-4 text-sm text-ink/60">
        General chats are not tied to a case, so Nyaya will not read your case files here.
      </p>
      {loading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} /> : null}
      {!loading && sessions.length === 0 ? (
        <EmptyState
          title="No general chats yet"
          description="Start from Ask Nyaya without picking a case."
          action={
            <Link href="/app" className="text-sm font-semibold text-accent underline">
              Ask Nyaya
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-white">
          {sessions.map((s) => (
            <li key={s.id}>
              <Link
                href={`/app/chats/${s.id}`}
                className="block px-4 py-3 text-sm hover:bg-accent-soft/30"
              >
                <span className="font-semibold text-ink">{s.title || "Untitled chat"}</span>
                <span className="mt-0.5 block text-xs text-ink/50">
                  {new Date(s.updatedAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </ProfessionalShell>
  );
}
