"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { EmptyState, ErrorState, LoadingState } from "@/components/ux";
import { userFacingLoadError } from "@/lib/case-intelligence-ux";

type Party = { partyId: string; displayName: string };
type RequestSet = {
  id: string;
  label: string;
  discoveryType: string;
  requestingPartyId: string;
  respondingPartyId: string;
  servedAt: string | null;
  responseDueAt: string | null;
  isCurrent: boolean;
  sourceDocumentId: string | null;
};
type RequestItem = {
  id: string;
  setId: string;
  requestNumber: string;
  title: string;
  requestText: string;
  status: string;
  requestingPartyId: string;
  respondingPartyId: string;
  servedAt: string | null;
  responseDueAt: string | null;
};
type ResponseRow = {
  id: string;
  itemId: string;
  label: string;
  respondedAt: string | null;
  isSupplemental: boolean;
  supplementsResponseId: string | null;
  substantiveText: string | null;
  objectionIds: string[];
  productionIds: string[];
  sourceDocumentId: string | null;
};
type ObjectionRow = { id: string; itemId: string; responseId: string; basis: string; text: string };
type BatesRange = {
  id: string;
  productionId: string;
  prefix: string;
  start: number | null;
  end: number | null;
  rawText: string;
};
type Production = {
  id: string;
  label: string;
  producingPartyId: string;
  receivingPartyId: string;
  producedAt: string | null;
  isSupplemental: boolean;
  supplementsProductionId: string | null;
  documentIds: string[];
  evidenceIds: string[];
  custodianIds: string[];
  batesRanges: BatesRange[];
  requestItemIds: string[];
  notes: string | null;
};
type Deficiency = {
  id: string;
  kind: string;
  itemId: string | null;
  productionId: string | null;
  description: string;
  status: string;
  openedAt: string | null;
  responsiblePartyId: string | null;
  communicationId: string | null;
  meetAndConferId: string | null;
  motionId: string | null;
  isReviewSignal: boolean;
};
type PrivilegeRow = {
  id: string;
  status: string;
  assertedBasis: string;
  assertingPartyId: string;
  assertedAt: string | null;
  documentId: string | null;
  evidenceId: string | null;
  reviewNotes: string | null;
  courtRulingReferenced: boolean;
};
type MeetAndConfer = {
  id: string;
  label: string;
  deficiencyIds: string[];
  communicationId: string | null;
  occurredAt: string | null;
  outcomeNotes: string | null;
};
type MotionLink = {
  id: string;
  motionId: string;
  motionLabel: string;
  motionType: string;
  deficiencyIds: string[];
  documentId: string | null;
};
type BatesSignal = {
  kind: string;
  productionId: string;
  description: string;
  legalDeficiencyConclusion: null;
};

type DiscoveryPayload = {
  parties: Party[];
  requestSets: RequestSet[];
  items: RequestItem[];
  responses: ResponseRow[];
  objections: ObjectionRow[];
  productions: Production[];
  deficiencies: Deficiency[];
  privilegeAssertions: PrivilegeRow[];
  meetAndConferIssues: MeetAndConfer[];
  motionLinks: MotionLink[];
  batesSignals: BatesSignal[];
  unanswered: RequestItem[];
  objectionOnly: RequestItem[];
  openDeficiencies: Deficiency[];
  whole: {
    unansweredCount: number;
    objectionOnlyCount: number;
    openDeficiencyCount: number;
    productionCount: number;
    supplementalProductionCount: number;
    batesSignalCount: number;
    privilegeAssertionsUnderReview: number;
    outstandingItemIds: string[];
    claimSupportGapsNoted: string[];
    sanctionsConclusion: null;
    privilegeLegalConclusion: null;
  };
  sanctionsConclusion: null;
  privilegeLegalConclusion: null;
};

type PanelTab =
  | "overview"
  | "sets"
  | "items"
  | "responses"
  | "productions"
  | "bates"
  | "deficiencies"
  | "privilege"
  | "meetings"
  | "deadlines";

function partyName(parties: Party[], id: string): string {
  return parties.find((party) => party.partyId === id)?.displayName ?? id;
}

function statusTone(status: string): string {
  if (status === "RESPONDED" || status === "PRODUCED" || status === "RESOLVED") {
    return "text-emerald-800 bg-emerald-50 border-emerald-200";
  }
  if (status === "PARTIALLY_RESPONDED" || status === "SUPPLEMENT_REQUIRED" || status === "MEET_AND_CONFER") {
    return "text-amber-900 bg-amber-50 border-amber-200";
  }
  if (status === "OBJECTED" || status === "DEFICIENT" || status === "OPEN") {
    return "text-rose-900 bg-rose-50 border-rose-200";
  }
  return "text-ink/70 bg-white border-line";
}

export default function DiscoveryLedgerPage() {
  const params = useParams<{ matterId: string }>();
  const matterId = params.matterId;
  const [data, setData] = useState<DiscoveryPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<PanelTab>("overview");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`/api/v1/matters/${matterId}/discovery-ledger`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(userFacingLoadError("discovery", res.status));
        if (!cancelled) {
          setData(json);
          const firstOpen = (json.unanswered as RequestItem[] | undefined)?.[0];
          setSelectedItemId((prev) => prev ?? firstOpen?.id ?? json.items?.[0]?.id ?? null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : userFacingLoadError("discovery"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [matterId]);

  const selectedItem = useMemo(
    () => data?.items.find((item) => item.id === selectedItemId) ?? null,
    [data, selectedItemId],
  );
  const selectedResponses = useMemo(
    () =>
      (data?.responses ?? [])
        .filter((row) => row.itemId === selectedItemId)
        .sort((a, b) => (a.respondedAt ?? "").localeCompare(b.respondedAt ?? "")),
    [data, selectedItemId],
  );

  if (loading) return <LoadingState label="Loading discovery ledger…" />;
  if (error) return <ErrorState message={error} />;
  if (!data) {
    return (
      <EmptyState
        title="No discovery ledger"
        description="No discovery / production ledger is available for this matter."
      />
    );
  }

  const tabs: Array<{ id: PanelTab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "sets", label: "Request Sets" },
    { id: "items", label: "Requests" },
    { id: "responses", label: "Responses" },
    { id: "productions", label: "Production Ledger" },
    { id: "bates", label: "Bates Ranges" },
    { id: "deficiencies", label: "Outstanding / Deficient" },
    { id: "privilege", label: "Privilege Review" },
    { id: "meetings", label: "Meet-and-Confer" },
    { id: "deadlines", label: "Deadlines" },
  ];

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.16em] text-accent">Legal Practice</p>
        <h2 className="font-display text-2xl text-ink">Discovery / Production Ledger</h2>
        <p className="max-w-3xl text-sm text-ink/70">
          Request, response, production, Bates, deficiency, and privilege-review tracking are database-backed.
          Statuses are operational only — Nyaya does not decide sanctions, privilege, or discovery violations.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {tabs.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${
              tab === entry.id ? "border-accent bg-accent-soft/60 text-ink" : "border-line bg-white text-ink/80"
            }`}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Unanswered", data.whole.unansweredCount],
            ["Objection-only", data.whole.objectionOnlyCount],
            ["Open deficiencies", data.whole.openDeficiencyCount],
            ["Productions", data.whole.productionCount],
            ["Supplemental productions", data.whole.supplementalProductionCount],
            ["Bates review signals", data.whole.batesSignalCount],
            ["Privilege under review", data.whole.privilegeAssertionsUnderReview],
            ["Request items", data.items.length],
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-md border border-line bg-white p-4">
              <p className="text-xs uppercase tracking-[0.14em] text-ink/50">{label}</p>
              <p className="mt-2 font-display text-2xl text-ink">{value}</p>
            </div>
          ))}
          {data.whole.claimSupportGapsNoted.length > 0 ? (
            <div className="md:col-span-2 xl:col-span-4 rounded-md border border-line bg-white p-4">
              <p className="text-sm font-semibold text-ink">Whole-matter discovery follow-ups</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
                {data.whole.claimSupportGapsNoted.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-ink/50">
                SANCTIONS_CONCLUSION: null · PRIVILEGE_LEGAL_CONCLUSION: null
              </p>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "sets" ? (
        <section className="space-y-3">
          {data.requestSets.length === 0 ? (
            <EmptyState title="No request sets" description="No discovery request sets are recorded yet." />
          ) : (
            data.requestSets.map((set) => {
              const setItems = data.items.filter((item) => item.setId === set.id);
              const openCount = setItems.filter((item) =>
                data.unanswered.some((row) => row.id === item.id),
              ).length;
              const deficiencyCount = data.deficiencies.filter((row) =>
                setItems.some((item) => item.id === row.itemId),
              ).length;
              return (
                <article key={set.id} className="rounded-md border border-line bg-white p-4 space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="font-semibold text-ink">{set.label}</h3>
                      <p className="text-sm text-ink/70">{set.discoveryType}</p>
                    </div>
                    <span className={`rounded border px-2 py-0.5 text-xs ${set.isCurrent ? statusTone("RESPONDED") : statusTone("UNKNOWN")}`}>
                      {set.isCurrent ? "CURRENT" : "HISTORICAL"}
                    </span>
                  </div>
                  <p className="text-sm text-ink/80">
                    {partyName(data.parties, set.requestingPartyId)} → {partyName(data.parties, set.respondingPartyId)}
                  </p>
                  <p className="text-sm text-ink/70">
                    Served {set.servedAt ?? "unknown"} · Response due {set.responseDueAt ?? "unknown"} ·{" "}
                    {setItems.length} items · {openCount} outstanding · {deficiencyCount} deficiencies
                  </p>
                  {set.sourceDocumentId ? (
                    <p className="text-xs text-ink/50">Source document: {set.sourceDocumentId}</p>
                  ) : null}
                </article>
              );
            })
          )}
        </section>
      ) : null}

      {tab === "items" || tab === "responses" ? (
        <section className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-2">
            {data.items.length === 0 ? (
              <EmptyState title="No requests" description="No discovery request items are recorded yet." />
            ) : (
              data.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedItemId(item.id)}
                  className={`w-full rounded-md border px-3 py-2 text-left ${
                    selectedItemId === item.id ? "border-accent bg-accent-soft/50" : "border-line bg-white"
                  }`}
                >
                  <p className="text-sm font-semibold text-ink">{item.requestNumber}</p>
                  <p className="text-xs text-ink/70">{item.title}</p>
                  <span className={`mt-1 inline-block rounded border px-1.5 py-0.5 text-[11px] ${statusTone(item.status)}`}>
                    {item.status}
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="rounded-md border border-line bg-white p-4 space-y-4">
            {!selectedItem ? (
              <EmptyState title="Select a request" description="Choose a request item to inspect response history." />
            ) : (
              <>
                <div>
                  <h3 className="font-display text-xl text-ink">
                    {selectedItem.requestNumber}: {selectedItem.title}
                  </h3>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-ink/80">{selectedItem.requestText}</p>
                  <p className="mt-2 text-sm text-ink/70">
                    Due {selectedItem.responseDueAt ?? "unknown"} ·{" "}
                    {partyName(data.parties, selectedItem.respondingPartyId)} responding
                  </p>
                </div>
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink/50">
                    Response history
                  </h4>
                  {selectedResponses.length === 0 ? (
                    <p className="text-sm text-ink/70">No responses recorded.</p>
                  ) : (
                    selectedResponses.map((response, index) => {
                      const objections = data.objections.filter((row) => row.responseId === response.id);
                      const isLatest = index === selectedResponses.length - 1;
                      return (
                        <article key={response.id} className="rounded border border-line p-3 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-ink">{response.label}</p>
                            {isLatest ? (
                              <span className="rounded border border-accent px-1.5 py-0.5 text-[11px]">LATEST</span>
                            ) : (
                              <span className="rounded border border-line px-1.5 py-0.5 text-[11px]">PRIOR</span>
                            )}
                            {response.isSupplemental ? (
                              <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px]">
                                SUPPLEMENT
                              </span>
                            ) : null}
                            {!response.substantiveText && objections.length > 0 ? (
                              <span className="rounded border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[11px]">
                                OBJECTION-ONLY
                              </span>
                            ) : null}
                          </div>
                          <p className="text-xs text-ink/50">Responded {response.respondedAt ?? "unknown"}</p>
                          {response.substantiveText ? (
                            <p className="text-sm text-ink/80">{response.substantiveText}</p>
                          ) : (
                            <p className="text-sm text-ink/60">No substantive response text recorded.</p>
                          )}
                          {objections.map((objection) => (
                            <p key={objection.id} className="text-sm text-rose-900">
                              Objection ({objection.basis}): {objection.text}
                            </p>
                          ))}
                          <p className="text-xs text-ink/50">
                            Productions: {response.productionIds.join(", ") || "(none)"} · Source:{" "}
                            {response.sourceDocumentId ?? "(none)"}
                          </p>
                        </article>
                      );
                    })
                  )}
                </div>
                <div>
                  <h4 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink/50">
                    Linked productions / deficiencies / motions
                  </h4>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
                    {data.productions
                      .filter((row) => row.requestItemIds.includes(selectedItem.id))
                      .map((row) => (
                        <li key={row.id}>
                          Production {row.label}
                          {row.isSupplemental ? " (supplemental)" : ""}
                        </li>
                      ))}
                    {data.deficiencies
                      .filter((row) => row.itemId === selectedItem.id)
                      .map((row) => (
                        <li key={row.id}>
                          Deficiency [{row.kind}] {row.description}
                        </li>
                      ))}
                    {data.motionLinks
                      .filter((row) =>
                        row.deficiencyIds.some((id) =>
                          data.deficiencies.some((def) => def.id === id && def.itemId === selectedItem.id),
                        ),
                      )
                      .map((row) => (
                        <li key={row.id}>
                          {row.motionType}: {row.motionLabel}
                        </li>
                      ))}
                  </ul>
                </div>
              </>
            )}
          </div>
        </section>
      ) : null}

      {tab === "productions" ? (
        <section className="space-y-3">
          {data.productions.length === 0 ? (
            <EmptyState title="No productions" description="No productions are recorded yet." />
          ) : (
            data.productions.map((production) => (
              <article key={production.id} className="rounded-md border border-line bg-white p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold text-ink">{production.label}</h3>
                  {production.isSupplemental ? (
                    <span className="rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[11px]">
                      SUPPLEMENTAL
                    </span>
                  ) : null}
                </div>
                <p className="text-sm text-ink/80">
                  {partyName(data.parties, production.producingPartyId)} →{" "}
                  {partyName(data.parties, production.receivingPartyId)} · Produced{" "}
                  {production.producedAt ?? "unknown"}
                </p>
                <p className="text-sm text-ink/70">
                  Bates:{" "}
                  {production.batesRanges.length
                    ? production.batesRanges.map((range) => range.rawText).join(" · ")
                    : "(no Bates)"}
                </p>
                <p className="text-xs text-ink/50">
                  Documents: {production.documentIds.join(", ") || "(none)"} · Evidence:{" "}
                  {production.evidenceIds.join(", ") || "(none)"} · Custodians:{" "}
                  {production.custodianIds.join(", ") || "(none)"}
                </p>
                {production.notes ? <p className="text-sm text-ink/70">{production.notes}</p> : null}
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "bates" ? (
        <section className="space-y-4">
          <div className="space-y-2">
            {data.productions.flatMap((production) =>
              production.batesRanges.map((range) => (
                <article key={range.id} className="rounded-md border border-line bg-white p-3 text-sm">
                  <p className="font-semibold text-ink">{range.rawText}</p>
                  <p className="text-ink/70">
                    Prefix {range.prefix || "(none)"} · Start {range.start ?? "unknown"} · End{" "}
                    {range.end ?? "unknown"} · Production {production.label}
                  </p>
                </article>
              )),
            )}
            {data.productions.every((row) => row.batesRanges.length === 0) ? (
              <EmptyState title="No Bates ranges" description="Productions may exist without Bates numbering." />
            ) : null}
          </div>
          <div className="rounded-md border border-line bg-white p-4">
            <h3 className="font-semibold text-ink">Bates review signals</h3>
            <p className="mt-1 text-xs text-ink/50">
              Overlap, duplicate, and apparent-gap signals are for human review only and do not alone establish
              legal deficiency.
            </p>
            {data.batesSignals.length === 0 ? (
              <p className="mt-3 text-sm text-ink/70">No Bates review signals.</p>
            ) : (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink/80">
                {data.batesSignals.map((signal) => (
                  <li key={`${signal.productionId}-${signal.kind}-${signal.description}`}>
                    [{signal.kind}] {signal.description}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {tab === "deficiencies" ? (
        <section className="space-y-3">
          {data.deficiencies.length === 0 ? (
            <EmptyState title="No deficiencies" description="No structured discovery deficiencies are recorded." />
          ) : (
            data.deficiencies.map((row) => (
              <article key={row.id} className="rounded-md border border-line bg-white p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-xs ${statusTone(row.status)}`}>{row.status}</span>
                  <span className="text-sm font-semibold text-ink">{row.kind}</span>
                  {row.isReviewSignal ? (
                    <span className="rounded border border-line px-1.5 py-0.5 text-[11px]">REVIEW SIGNAL</span>
                  ) : null}
                </div>
                <p className="text-sm text-ink/80">{row.description}</p>
                <p className="text-xs text-ink/50">
                  Opened {row.openedAt ?? "unknown"} · Request {row.itemId ?? "(none)"} · Communication{" "}
                  {row.communicationId ?? "(none)"} · Meet-and-confer {row.meetAndConferId ?? "(none)"} · Motion{" "}
                  {row.motionId ?? "(none)"}
                </p>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "privilege" ? (
        <section className="space-y-3">
          {data.privilegeAssertions.length === 0 ? (
            <EmptyState title="No privilege assertions" description="No privilege-review rows are recorded." />
          ) : (
            data.privilegeAssertions.map((row) => (
              <article key={row.id} className="rounded-md border border-line bg-white p-4 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded border px-2 py-0.5 text-xs ${statusTone(row.status)}`}>{row.status}</span>
                  <span className="text-sm font-semibold text-ink">Asserted basis: {row.assertedBasis}</span>
                </div>
                <p className="text-sm text-ink/80">
                  Asserting party: {partyName(data.parties, row.assertingPartyId)} · Date{" "}
                  {row.assertedAt ?? "unknown"}
                </p>
                <p className="text-xs text-ink/50">
                  Document {row.documentId ?? "(none)"} · Evidence {row.evidenceId ?? "(none)"} · Court ruling
                  referenced: {String(row.courtRulingReferenced)}
                </p>
                {row.reviewNotes ? <p className="text-sm text-ink/70">{row.reviewNotes}</p> : null}
                <p className="text-xs text-ink/50">
                  Privilege review state only — not a determination that a document is privileged.
                </p>
              </article>
            ))
          )}
        </section>
      ) : null}

      {tab === "meetings" ? (
        <section className="space-y-3">
          {data.meetAndConferIssues.length === 0 ? (
            <EmptyState title="No meet-and-confer issues" description="No meet-and-confer records are linked." />
          ) : (
            data.meetAndConferIssues.map((row) => (
              <article key={row.id} className="rounded-md border border-line bg-white p-4 space-y-2">
                <h3 className="font-semibold text-ink">{row.label}</h3>
                <p className="text-sm text-ink/70">Occurred {row.occurredAt ?? "unknown"}</p>
                {row.outcomeNotes ? <p className="text-sm text-ink/80">{row.outcomeNotes}</p> : null}
                <p className="text-xs text-ink/50">
                  Deficiencies: {row.deficiencyIds.join(", ") || "(none)"} · Communication{" "}
                  {row.communicationId ?? "(none)"}
                </p>
              </article>
            ))
          )}
          {data.motionLinks.length > 0 ? (
            <div className="rounded-md border border-line bg-white p-4">
              <h3 className="font-semibold text-ink">Related motions</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink/80">
                {data.motionLinks.map((row) => (
                  <li key={row.id}>
                    {row.motionType}: {row.motionLabel} · deficiencies {row.deficiencyIds.join(", ")}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "deadlines" ? (
        <section className="space-y-3">
          {data.requestSets.map((set) => (
            <article key={set.id} className="rounded-md border border-line bg-white p-4 text-sm">
              <p className="font-semibold text-ink">{set.label}</p>
              <p className="text-ink/70">
                Served {set.servedAt ?? "unknown"} · Response due {set.responseDueAt ?? "unknown"}
              </p>
            </article>
          ))}
          {data.items
            .filter((item) => item.responseDueAt)
            .map((item) => (
              <article key={item.id} className="rounded-md border border-line bg-white p-4 text-sm">
                <p className="font-semibold text-ink">
                  {item.requestNumber} response due {item.responseDueAt}
                </p>
                <p className="text-ink/70">Status {item.status}</p>
              </article>
            ))}
          {data.meetAndConferIssues.map((row) => (
            <article key={row.id} className="rounded-md border border-line bg-white p-4 text-sm">
              <p className="font-semibold text-ink">Meet-and-confer: {row.label}</p>
              <p className="text-ink/70">Occurred / scheduled {row.occurredAt ?? "unknown"}</p>
            </article>
          ))}
          <p className="text-xs text-ink/50">
            Deadlines shown are source-backed from discovery records. Nyaya does not invent procedural deadlines.
          </p>
        </section>
      ) : null}
    </div>
  );
}
