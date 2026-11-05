"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProfessionalShell } from "@/components/shell";
import { useActiveOrganization } from "@/components/use-active-organization";
import { useOrgCapability } from "@/components/use-org-capability";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { Button } from "@nyayagrid/ui";
import { humanizeKey } from "@/lib/plain-labels";

type AuditEvent = {
  id: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  actorUserId: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export default function ProsecutionAuditPage() {
  const { organizationId } = useActiveOrganization();
  const auditCap = useOrgCapability(organizationId, "audit.view");
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const pageSize = 25;

  useEffect(() => {
    if (!organizationId) return;
    if (auditCap.loading) return;
    if (!auditCap.allowed) {
      setLoading(false);
      setError("Office audit requires the audit.view capability.");
      setEvents([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      organizationId,
      page: String(page),
      pageSize: String(pageSize),
    });
    if (actionFilter.trim()) params.set("action", actionFilter.trim());
    fetch(`/api/v1/prosecution/audit?${params.toString()}`)
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error?.message ?? "Could not load office audit.");
        if (!cancelled) {
          setEvents(data.events ?? []);
          setTotal(Number(data.total ?? 0));
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load office audit.");
          setEvents([]);
          setTotal(0);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, auditCap.loading, auditCap.allowed, page, actionFilter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <ProfessionalShell title="Prosecution audit">
      <p className="mb-4 max-w-2xl text-sm text-ink/70">
        Authorized office audit trail for prosecution actions. Events are tenant-scoped. Guilt
        scores, charging decisions, and autonomous disclosure finalization are never recorded here
        as automated outcomes.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link className="text-sm text-accent underline" href="/app/prosecution">
          Back to caseload
        </Link>
        <label className="text-sm text-ink/80">
          Action filter
          <input
            value={actionFilter}
            onChange={(event) => {
              setPage(1);
              setActionFilter(event.target.value);
            }}
            className="ml-2 rounded border border-line px-2 py-1"
            placeholder="case_created or prosecution.case_created"
            aria-label="Filter audit actions"
          />
        </label>
      </div>

      {loading ? <LoadingState label="Loading prosecution audit" /> : null}
      {error ? <ErrorState message={error} /> : null}

      {!loading && !error && events.length === 0 ? (
        <EmptyState
          title="No audit events"
          description="Prosecution case actions for this office will appear here after authorized users make changes."
        />
      ) : null}

      {events.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="min-w-full text-left text-sm">
            <caption className="sr-only">Prosecution office audit events</caption>
            <thead className="border-b border-line bg-black/[0.02] text-xs uppercase tracking-wide text-ink/55">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Target</th>
                <th className="px-3 py-2">Actor</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => {
                const caseHref =
                  event.targetType === "criminal_case" && event.targetId
                    ? `/app/prosecution/${event.targetId}`
                    : null;
                return (
                  <tr key={event.id} className="border-b border-line/70">
                    <td className="px-3 py-2 whitespace-nowrap text-ink/70">
                      {new Date(event.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-medium text-ink">{humanizeKey(event.action)}</td>
                    <td className="px-3 py-2 text-ink/80">
                      {humanizeKey(event.targetType ?? "target")}
                      {caseHref ? (
                        <>
                          {" · "}
                          <Link className="text-accent underline" href={caseHref}>
                            Open case
                          </Link>
                        </>
                      ) : event.targetId ? (
                        <> · {event.targetId.slice(0, 8)}…</>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-ink/60">
                      {event.actorUserId ? `${event.actorUserId.slice(0, 8)}…` : "system"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      {total > pageSize ? (
        <div className="mt-4 flex items-center gap-3">
          <Button
            type="button"
            variant="secondary"
            disabled={page <= 1 || loading}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm text-ink/65">
            Page {page} of {totalPages} · {total} events
          </span>
          <Button
            type="button"
            variant="secondary"
            disabled={page >= totalPages || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </ProfessionalShell>
  );
}
