"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";

type CivilMatrixRow = {
  rowKind: "claim" | "counterclaim" | "defense";
  parentId: string;
  parentLabel: string;
  elementId: string;
  elementLabel: string;
  requirementText: string;
  supportStatus: string;
  proceduralStatus: string;
  claimantPartyIds: string[];
  targetPartyIds: string[];
  supportingEvidenceIds: string[];
  contraryEvidenceIds: string[];
  missingEvidence: Array<{ id: string; description: string }>;
  bindingAuthorities: string[];
  persuasiveAuthorities: string[];
  uncertainty: string[];
  isCurrent: boolean;
};

type CivilParty = { id: string; displayName: string; entityType: string };
type CivilPleading = {
  id: string;
  label: string;
  isCurrent: boolean;
  supersededByPleadingId: string | null;
  filedAt: string | null;
};
type CivilStrength = {
  claimId: string;
  claimLabel: string;
  investigationQuestions: string[];
  unresolvedFactualQuestions: string[];
  authorityGaps: string[];
  discoveryOpportunities: string[];
  proceduralConcerns: string[];
};

type CivilPayload = {
  parties: CivilParty[];
  pleadings: CivilPleading[];
  pleadingHistory: CivilPleading[];
  claims: Array<{
    id: string;
    kind: string;
    label: string;
    supportStatus: string;
    proceduralStatus: string;
    isCurrent: boolean;
    parties: Array<{ partyId: string; role: string }>;
    authorities: Array<{ authorityId: string; citation: string | null; relation: string; treatment: string }>;
    standards: Array<{ id: string; label: string }>;
    legalIssueIds: string[];
  }>;
  defenses: Array<{
    id: string;
    kind: string;
    label: string;
    againstClaimIds: string[];
    supportStatus: string;
    proceduralStatus: string;
    assertingPartyIds: string[];
  }>;
  facts: Array<{ id: string; statement?: string; label?: string }>;
  legalIssues: Array<{ issueId: string; label: string }>;
  evidence: Array<{ id: string; label: string; documentId: string | null }>;
  matrix: CivilMatrixRow[];
  strength: CivilStrength[];
  coverageWarnings: string[];
  liabilityConclusion: null;
  outcomeConclusion: null;
};

type PanelTab =
  | "matrix"
  | "claims"
  | "defenses"
  | "pleadings"
  | "evidence"
  | "authorities"
  | "investigation";

function partyName(parties: CivilParty[], id: string): string {
  return parties.find((party) => party.id === id)?.displayName ?? id;
}

function statusTone(status: string): string {
  if (status === "SUPPORTED") return "text-emerald-800 bg-emerald-50 border-emerald-200";
  if (status === "PARTIALLY_SUPPORTED") return "text-amber-900 bg-amber-50 border-amber-200";
  if (status === "CONFLICTED") return "text-rose-900 bg-rose-50 border-rose-200";
  if (status === "NO_EVIDENCE_FOUND") return "text-slate-800 bg-slate-100 border-slate-300";
  return "text-ink/70 bg-white border-line";
}

export default function CivilClaimsPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [data, setData] = useState<CivilPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<PanelTab>("matrix");
  const [showHistory, setShowHistory] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/v1/matters/${matterId}/civil?history=${showHistory ? "1" : "0"}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(userFacingLoadError("claims", res.status));
        if (!cancelled) {
          setData(json);
          const firstCurrent = (json.claims as CivilPayload["claims"])?.find((claim) => claim.isCurrent);
          setSelectedClaimId((prev) => prev ?? firstCurrent?.id ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : userFacingLoadError("claims"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matterId, showHistory]);

  const selectedClaim = useMemo(
    () => data?.claims.find((claim) => claim.id === selectedClaimId) ?? null,
    [data, selectedClaimId],
  );
  const selectedStrength = useMemo(
    () => data?.strength.find((row) => row.claimId === selectedClaimId) ?? null,
    [data, selectedClaimId],
  );
  const claimMatrixRows = useMemo(
    () => (data?.matrix ?? []).filter((row) => !selectedClaimId || row.parentId === selectedClaimId),
    [data, selectedClaimId],
  );

  if (loading) return <LoadingState label="Loading civil claims…" />;
  if (error) return <ErrorState message={error} />;
  if (!data) {
    return <EmptyState title="No civil claims" description="No civil claims review is available for this matter." />;
  }

  const tabs: Array<{ id: PanelTab; label: string }> = [
    { id: "matrix", label: "Claim Matrix" },
    { id: "claims", label: "Claims" },
    { id: "defenses", label: "Defenses" },
    { id: "pleadings", label: "Pleadings" },
    { id: "evidence", label: "Evidence by claim" },
    { id: "authorities", label: "Authorities" },
    { id: "investigation", label: "Investigation" },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.16em] text-accent">Legal Practice</p>
        <h2 className="font-display text-2xl text-ink">Civil Claims</h2>
        <p className="max-w-3xl text-sm text-ink/70">
          Claim Matrix and related panels are database-backed. Support status is evidentiary only — Nyaya does
          not decide liability or win/loss outcomes.
        </p>
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <label className="flex items-center gap-2 text-sm text-ink/80">
            <input
              type="checkbox"
              checked={showHistory}
              onChange={(event) => setShowHistory(event.target.checked)}
            />
            Include superseded / historical rows
          </label>
          {data.coverageWarnings.map((warning) => (
            <span key={warning} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              {warning}
            </span>
          ))}
        </div>
      </header>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
              tab === item.id ? "border-accent bg-accent-soft/60 text-ink" : "border-line bg-white hover:bg-accent-soft/40"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "matrix" ? (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedClaimId(null)}
              className={`rounded border px-2 py-1 text-xs ${selectedClaimId === null ? "border-accent bg-accent-soft/50" : "border-line"}`}
            >
              All rows
            </button>
            {data.claims.map((claim) => (
              <button
                key={claim.id}
                type="button"
                onClick={() => setSelectedClaimId(claim.id)}
                className={`rounded border px-2 py-1 text-xs ${
                  selectedClaimId === claim.id ? "border-accent bg-accent-soft/50" : "border-line"
                }`}
              >
                {claim.kind === "COUNTERCLAIM" ? "Counterclaim" : "Claim"}: {claim.label}
              </button>
            ))}
          </div>
          {claimMatrixRows.length === 0 ? (
            <EmptyState
              title="No matrix rows"
              description="No current claim, counterclaim, or defense elements are available."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line bg-white">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-line bg-paper/70 text-xs uppercase tracking-wide text-ink/60">
                  <tr>
                    <th className="px-3 py-2">Kind</th>
                    <th className="px-3 py-2">Parent</th>
                    <th className="px-3 py-2">Element</th>
                    <th className="px-3 py-2">Parties</th>
                    <th className="px-3 py-2">Support</th>
                    <th className="px-3 py-2">Procedural</th>
                    <th className="px-3 py-2">Evidence</th>
                    <th className="px-3 py-2">Authorities</th>
                  </tr>
                </thead>
                <tbody>
                  {claimMatrixRows.map((row) => (
                    <tr key={`${row.parentId}:${row.elementId}`} className="border-b border-line/70 align-top">
                      <td className="px-3 py-2 capitalize">{row.rowKind}</td>
                      <td className="px-3 py-2 font-medium">{row.parentLabel}</td>
                      <td className="px-3 py-2">
                        <div>{row.elementLabel}</div>
                        <div className="text-xs text-ink/55">{row.requirementText}</div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div>
                          Claimants:{" "}
                          {row.claimantPartyIds.map((id) => partyName(data.parties, id)).join(", ") || "—"}
                        </div>
                        <div>
                          Targets: {row.targetPartyIds.map((id) => partyName(data.parties, id)).join(", ") || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded border px-2 py-0.5 text-xs ${statusTone(row.supportStatus)}`}>
                          {row.supportStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">{row.proceduralStatus}</td>
                      <td className="px-3 py-2 text-xs">
                        <div>Supporting: {row.supportingEvidenceIds.join(", ") || "—"}</div>
                        <div>Contrary: {row.contraryEvidenceIds.join(", ") || "—"}</div>
                        <div>
                          Missing:{" "}
                          {row.missingEvidence.map((item) => item.description).join("; ") || "—"}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <div>Binding: {row.bindingAuthorities.join(", ") || "—"}</div>
                        <div>Persuasive: {row.persuasiveAuthorities.join(", ") || "—"}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {tab === "claims" ? (
        <section className="space-y-3">
          {data.claims.length === 0 ? (
            <EmptyState title="No claims" description="No civil claims are linked to this matter yet." />
          ) : (
            data.claims.map((claim) => (
              <article key={claim.id} className="rounded-lg border border-line bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{claim.label}</h3>
                  <span className="rounded border border-line px-2 py-0.5 text-xs">{claim.kind}</span>
                  <span className={`rounded border px-2 py-0.5 text-xs ${statusTone(claim.supportStatus)}`}>
                    {claim.supportStatus}
                  </span>
                  <span className="rounded border border-line px-2 py-0.5 text-xs">{claim.proceduralStatus}</span>
                  {!claim.isCurrent ? (
                    <span className="rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs">historical</span>
                  ) : null}
                </div>
                <p className="mt-2 text-sm text-ink/70">
                  Parties:{" "}
                  {claim.parties
                    .map((party) => `${party.role}: ${partyName(data.parties, party.partyId)}`)
                    .join(" · ") || "—"}
                </p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Facts</h4>
                    <p className="text-sm text-ink/80">
                      Linked via claim elements; see matrix evidence and investigation panels for gaps.
                    </p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Legal issues</h4>
                    <p className="text-sm text-ink/80">
                      {claim.legalIssueIds
                        .map((id) => data.legalIssues.find((issue) => issue.issueId === id)?.label ?? id)
                        .join("; ") || "—"}
                    </p>
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/50">Standards</h4>
                    <p className="text-sm text-ink/80">
                      {claim.standards.map((standard) => standard.label).join("; ") || "—"}
                    </p>
                  </div>
                </div>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "defenses" ? (
        <section className="space-y-3">
          {data.defenses.length === 0 ? (
            <EmptyState title="No defenses" description="No civil defenses are linked to this matter yet." />
          ) : (
            data.defenses.map((defense) => (
              <article key={defense.id} className="rounded-lg border border-line bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{defense.label}</h3>
                  <span className="rounded border border-line px-2 py-0.5 text-xs">{defense.kind}</span>
                  <span className={`rounded border px-2 py-0.5 text-xs ${statusTone(defense.supportStatus)}`}>
                    {defense.supportStatus}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink/70">
                  Asserted by:{" "}
                  {defense.assertingPartyIds.map((id) => partyName(data.parties, id)).join(", ") || "—"}
                </p>
                <p className="text-sm text-ink/70">
                  Against claims:{" "}
                  {defense.againstClaimIds
                    .map((id) => data.claims.find((claim) => claim.id === id)?.label ?? id)
                    .join("; ") || "—"}
                </p>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "pleadings" ? (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink/50">Current pleadings</h3>
          {data.pleadings.length === 0 ? (
            <EmptyState title="No current pleadings" description="No current civil pleadings are recorded." />
          ) : (
            data.pleadings.map((pleading) => (
              <article key={pleading.id} className="rounded-lg border border-line bg-white p-4 text-sm">
                <div className="font-semibold">{pleading.label}</div>
                <div className="text-ink/60">Filed: {pleading.filedAt ?? "date unknown"}</div>
              </article>
            ))
          )}
          <h3 className="pt-2 text-sm font-semibold uppercase tracking-wide text-ink/50">Pleading history</h3>
          {(data.pleadingHistory ?? []).map((pleading) => (
            <article key={`hist-${pleading.id}`} className="rounded-lg border border-line bg-white p-4 text-sm">
              <div className="font-semibold">
                {pleading.label}{" "}
                {pleading.isCurrent ? (
                  <span className="text-xs text-emerald-800">(current)</span>
                ) : (
                  <span className="text-xs text-ink/50">(superseded)</span>
                )}
              </div>
              <div className="text-ink/60">
                Superseded by: {pleading.supersededByPleadingId ?? "—"}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {tab === "evidence" ? (
        <section className="space-y-3">
          {claimMatrixRows.map((row) => (
            <article key={`ev-${row.parentId}-${row.elementId}`} className="rounded-lg border border-line bg-white p-4 text-sm">
              <h3 className="font-semibold">
                {row.parentLabel} — {row.elementLabel}
              </h3>
              <div className="mt-2 grid gap-2 md:grid-cols-3">
                <div>
                  <h4 className="text-xs uppercase tracking-wide text-ink/50">Supporting</h4>
                  <p>{row.supportingEvidenceIds.map((id) => data.evidence.find((item) => item.id === id)?.label ?? id).join("; ") || "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs uppercase tracking-wide text-ink/50">Contrary</h4>
                  <p>{row.contraryEvidenceIds.map((id) => data.evidence.find((item) => item.id === id)?.label ?? id).join("; ") || "—"}</p>
                </div>
                <div>
                  <h4 className="text-xs uppercase tracking-wide text-ink/50">Missing expected</h4>
                  <p>{row.missingEvidence.map((item) => item.description).join("; ") || "—"}</p>
                </div>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {tab === "authorities" ? (
        <section className="space-y-3">
          {(selectedClaim ? [selectedClaim] : data.claims).map((claim) => (
            <article key={`auth-${claim.id}`} className="rounded-lg border border-line bg-white p-4 text-sm">
              <h3 className="font-semibold">{claim.label}</h3>
              <div className="mt-2 space-y-1">
                <h4 className="text-xs uppercase tracking-wide text-ink/50">Authorities</h4>
                {claim.authorities.length === 0 ? (
                  <p className="text-ink/60">No authorities linked.</p>
                ) : (
                  claim.authorities.map((authority) => (
                    <p key={`${claim.id}-${authority.authorityId}`}>
                      {authority.citation ?? authority.authorityId} · {authority.relation} · treatment=
                      {authority.treatment}
                    </p>
                  ))
                )}
                <h4 className="pt-2 text-xs uppercase tracking-wide text-ink/50">Legal standards</h4>
                <p>{claim.standards.map((standard) => standard.label).join("; ") || "—"}</p>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {tab === "investigation" ? (
        <section className="space-y-3">
          {(selectedStrength ? [selectedStrength] : data.strength).map((row) => (
            <article key={`inv-${row.claimId}`} className="rounded-lg border border-line bg-white p-4 text-sm">
              <h3 className="font-semibold">{row.claimLabel}</h3>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <div>
                  <h4 className="text-xs uppercase tracking-wide text-ink/50">Unresolved factual questions</h4>
                  <ul className="list-disc pl-4">
                    {row.unresolvedFactualQuestions.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                    {row.unresolvedFactualQuestions.length === 0 ? <li>None recorded.</li> : null}
                  </ul>
                </div>
                <div>
                  <h4 className="text-xs uppercase tracking-wide text-ink/50">Investigation / discovery</h4>
                  <ul className="list-disc pl-4">
                    {[...row.investigationQuestions, ...row.discoveryOpportunities].map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                    {row.investigationQuestions.length === 0 && row.discoveryOpportunities.length === 0 ? (
                      <li>None recorded.</li>
                    ) : null}
                  </ul>
                </div>
              </div>
              {row.authorityGaps.length > 0 ? (
                <p className="mt-2 text-ink/70">Authority gaps: {row.authorityGaps.join(" ")}</p>
              ) : null}
              {row.proceduralConcerns.length > 0 ? (
                <p className="mt-1 text-ink/70">Procedural: {row.proceduralConcerns.join(" ")}</p>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}

      <footer className="rounded-lg border border-line bg-paper/50 p-3 text-xs text-ink/60">
        LIABILITY_CONCLUSION: {String(data.liabilityConclusion)} · OUTCOME_CONCLUSION:{" "}
        {String(data.outcomeConclusion)} · Support statuses never encode WIN/LOSE/LIABLE.
      </footer>
    </div>
  );
}
