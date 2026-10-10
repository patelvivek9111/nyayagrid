"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";

type WholeMatter = {
  status: { flags: string[]; summaryLines: string[] };
  claims: Array<{ claimId: string; label: string; supportStatus: string; openGaps: string[] }>;
  defenses: Array<{ defenseId: string; label: string; supportStatus: string }>;
  openDeficiencyIds: string[];
  motions: Array<{
    motionId: string;
    title: string;
    status: string;
    disposition: string | null;
    pending: boolean;
  }>;
  communications: Array<{ id: string; subject: string; occurredAt: string | null }>;
  contradictions: Array<{ id: string; kind: string; description: string }>;
  tasks: Array<{ id: string; title: string; status: string; dueAt: string | null; overdue: boolean }>;
  deadlines: Array<{ id: string; title: string; dueAt: string | null; overdue: boolean }>;
  authorities: Array<{ id: string; citation: string | null; resolution: string }>;
  investigateNext: Array<{ id: string; title: string; why: string; resolvesIf: string }>;
  limitations: string[];
};

type Section =
  | "status"
  | "claims"
  | "evidence"
  | "discovery"
  | "motions"
  | "communications"
  | "deadlines"
  | "authorities"
  | "investigate";

export default function MatterIntelligencePage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [whole, setWhole] = useState<WholeMatter | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [section, setSection] = useState<Section>("status");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/v1/matters/${matterId}/intelligence`)
      .then(async (res) => {
        if (!res.ok) throw new Error(userFacingLoadError("review", res.status));
        return res.json();
      })
      .then((json) => {
        if (!cancelled) {
          setWhole(json.whole ?? null);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : userFacingLoadError("review"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matterId]);

  if (loading) return <LoadingState label="Loading whole-matter intelligence…" />;
  if (error) return <ErrorState message={error} />;
  if (!whole) {
    return (
      <EmptyState
        title="No whole-matter intelligence"
        description="Persisted matter records are required to assemble the convergence view."
      />
    );
  }

  const tabs: Array<{ id: Section; label: string }> = [
    { id: "status", label: "Matter status" },
    { id: "claims", label: "Claims & defenses" },
    { id: "evidence", label: "Evidence & conflicts" },
    { id: "discovery", label: "Discovery gaps" },
    { id: "motions", label: "Motions & rulings" },
    { id: "communications", label: "Communications" },
    { id: "deadlines", label: "Deadlines/tasks" },
    { id: "authorities", label: "Authorities" },
    { id: "investigate", label: "Investigate next" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-ink">Matter intelligence</h2>
        <p className="mt-1 text-sm text-muted">
          Cross-domain status derived from persisted records. No predictive win/loss conclusions.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setSection(tab.id)}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
              section === tab.id
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-ink hover:bg-accent-soft/50"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {section === "status" ? (
        <section className="space-y-3 border border-line bg-white p-4">
          <h3 className="font-semibold text-ink">Status flags</h3>
          <p className="text-sm text-ink/80">{whole.status.flags.join(" · ") || "(none)"}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">
            {whole.status.summaryLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {section === "claims" ? (
        <section className="space-y-3">
          {whole.claims.map((claim) => (
            <article key={claim.claimId} className="border border-line bg-white p-4">
              <h3 className="font-semibold text-ink">{claim.label}</h3>
              <p className="text-sm text-muted">Support: {claim.supportStatus}</p>
              {claim.openGaps.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
                  {claim.openGaps.map((gap) => (
                    <li key={gap}>{gap}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-muted">No open element gaps recorded.</p>
              )}
              <Link
                href={`/app/cases/${matterId}/claims`}
                className="mt-2 inline-block text-sm text-accent hover:underline"
              >
                Open claims matrix
              </Link>
            </article>
          ))}
          {whole.defenses.map((defense) => (
            <article key={defense.defenseId} className="border border-line bg-white p-4">
              <h3 className="font-semibold text-ink">Defense: {defense.label}</h3>
              <p className="text-sm text-muted">Support: {defense.supportStatus} (not established)</p>
            </article>
          ))}
        </section>
      ) : null}

      {section === "evidence" ? (
        <section className="space-y-3">
          {whole.contradictions.length === 0 ? (
            <EmptyState
              title="No recorded conflicts"
              description="Only source-backed supporting/contradicting evidence pairs appear here."
            />
          ) : (
            whole.contradictions.map((row) => (
              <article key={row.id} className="border border-line bg-white p-4">
                <p className="text-xs uppercase tracking-wide text-muted">{row.kind}</p>
                <p className="text-sm text-ink/80">{row.description}</p>
              </article>
            ))
          )}
          <Link
            href={`/app/cases/${matterId}/evidence`}
            className="inline-block text-sm text-accent hover:underline"
          >
            Open evidence
          </Link>
        </section>
      ) : null}

      {section === "discovery" ? (
        <section className="space-y-3 border border-line bg-white p-4">
          <p className="text-sm text-ink/80">
            Open deficiencies: {whole.openDeficiencyIds.length}
          </p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">
            {whole.openDeficiencyIds.map((id) => (
              <li key={id}>{id}</li>
            ))}
          </ul>
          <Link
            href={`/app/cases/${matterId}/discovery`}
            className="inline-block text-sm text-accent hover:underline"
          >
            Open discovery ledger
          </Link>
        </section>
      ) : null}

      {section === "motions" ? (
        <section className="space-y-3">
          {whole.motions.map((motion) => (
            <article key={motion.motionId} className="border border-line bg-white p-4">
              <Link
                href={`/app/cases/${matterId}/motions/${motion.motionId}`}
                className="font-semibold text-accent hover:underline"
              >
                {motion.title}
              </Link>
              <p className="text-sm text-muted">
                {motion.status}
                {motion.disposition ? ` · ${motion.disposition}` : ""}
                {motion.pending ? " · pending" : ""}
              </p>
              <p className="mt-1 text-xs text-muted">
                A motion linked to a claim does not mean the entire claim was resolved.
              </p>
            </article>
          ))}
        </section>
      ) : null}

      {section === "communications" ? (
        <section className="space-y-3">
          {whole.communications.map((row) => (
            <article key={row.id} className="border border-line bg-white p-4">
              <Link
                href={`/app/cases/${matterId}/communications/${row.id}`}
                className="font-semibold text-accent hover:underline"
              >
                {row.subject}
              </Link>
              <p className="text-sm text-muted">{row.occurredAt ?? "date unknown"}</p>
            </article>
          ))}
        </section>
      ) : null}

      {section === "deadlines" ? (
        <section className="space-y-3 border border-line bg-white p-4">
          <h3 className="font-semibold text-ink">Explicit deadlines</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">
            {whole.deadlines.map((d) => (
              <li key={d.id}>
                {d.title} · {d.dueAt ?? "unknown"}
                {d.overdue ? " · OVERDUE" : ""}
              </li>
            ))}
          </ul>
          <h3 className="mt-4 font-semibold text-ink">Tasks</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-ink/80">
            {whole.tasks.map((t) => (
              <li key={t.id}>
                {t.title} · {t.status}
                {t.overdue ? " · OVERDUE" : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {section === "authorities" ? (
        <section className="space-y-3">
          {whole.authorities.map((a) => (
            <article key={a.id} className="border border-line bg-white p-4">
              <p className="font-semibold text-ink">{a.citation ?? a.id}</p>
              <p className="text-sm text-muted">Resolution: {a.resolution}</p>
            </article>
          ))}
          {whole.authorities.length === 0 ? (
            <EmptyState
              title="No matter authorities linked"
              description="Authority identity/treatment states appear when matter authorities are saved."
            />
          ) : null}
        </section>
      ) : null}

      {section === "investigate" ? (
        <section className="space-y-3">
          {whole.investigateNext.map((item) => (
            <article key={item.id} className="border border-line bg-white p-4">
              <h3 className="font-semibold text-ink">{item.title}</h3>
              <p className="mt-1 text-sm text-ink/80">
                <span className="font-semibold">Why:</span> {item.why}
              </p>
              <p className="mt-1 text-sm text-ink/80">
                <span className="font-semibold">Resolves if:</span> {item.resolvesIf}
              </p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="border border-line bg-canvas p-4 text-xs text-muted">
        {whole.limitations.slice(0, 4).join(" · ")}
      </section>
    </div>
  );
}
