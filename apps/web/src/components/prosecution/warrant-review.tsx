import { StatusLabel } from "@/components/ux";
import { humanizeKey } from "@/lib/plain-labels";

export type SuppressionAuthorityView = {
  authorityId: string;
  citation: string | null;
  title: string | null;
  authorityStatus: string;
  treatment: string;
  proposition: string | null;
  sourceSpan: string | null;
  coverageWarning: string | null;
};

export type SuppressionIssueView = {
  id: string;
  warrantId: string | null;
  dimension: string;
  defendantScope: string;
  defendantIds: string[];
  knownFacts: string[];
  disputedFacts: string[];
  missingFacts: string[];
  factsSupportingConcern: string[];
  factsReducingConcern: string[];
  legalStandard: string | null;
  applicationQuestions: string[];
  authorities: SuppressionAuthorityView[];
  linkedEvidence: Array<{
    evidenceId: string;
    evidenceType: string;
    documentId: string | null;
    storageReference: string | null;
  }>;
  officerIds: string[];
  uncertainty: string[];
  reviewStatus: string;
  humanDecision: { text: string; actorId: string } | null;
};

export type SuppressionWarrantCard = {
  id: string;
  warrantType: string;
  issuingCourt: string | null;
  issuingJudge: string | null;
  applicationDate: string | null;
  issueDate: string | null;
  executionDate: string | null;
  scope: string | null;
  affidavitStatements: string[];
  executionNotes: string[];
  returnInventory: string[];
  returnNotes: string | null;
  evidence: SuppressionIssueView["linkedEvidence"];
  officerNames: string[];
  timelineEvents: Array<{ id: string; eventType: string; title: string; eventDate: string | null }>;
  missingFacts: string[];
  unassignedMissingFacts: string[];
  reviewStatus: string;
};

export type SuppressionReviewView = {
  doctrine: string;
  doctrineWarning: string | null;
  warrants: SuppressionWarrantCard[];
  issues: SuppressionIssueView[];
  conflictPair: "NO_VERIFIED_CONFLICT_PAIR" | { kind: string; authorityIds: string[] };
  coverageWarnings: string[];
  suppressionConclusion: null;
  validityConclusion: null;
  guiltConclusion: null;
};

export type SuppressionAnswerView = {
  question: string;
  issues: Array<{
    issueId: string;
    warrantId: string | null;
    dimension: string;
    knownFacts: string[];
    disputedFacts: string[];
    missingFacts: string[];
    legalStandard: string | null;
    bindingAuthorities: SuppressionAuthorityView[];
    persuasiveAuthorities: SuppressionAuthorityView[];
    applicationQuestions: string[];
    uncertainty: string[];
  }>;
  limitations: string[];
  suppressionConclusion: null;
  validityConclusion: null;
  guiltConclusion: null;
};

function FactList({ label, rows }: { label: string; rows: string[] }) {
  if (rows.length === 0) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/55">{label}</h4>
      <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink/80">
        {rows.map((row) => (
          <li key={row}>{row}</li>
        ))}
      </ul>
    </div>
  );
}

function IssueBlock({ issue }: { issue: SuppressionIssueView }) {
  return (
    <section className="rounded-md border border-line p-3" aria-labelledby={`issue-${issue.id}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 id={`issue-${issue.id}`} className="text-sm font-semibold text-ink">
          {humanizeKey(issue.dimension)}
        </h3>
        <StatusLabel label={humanizeKey(issue.reviewStatus)} tone={issue.reviewStatus === "needs_review" ? "warn" : "info"} />
        <StatusLabel label={humanizeKey(issue.defendantScope)} tone="neutral" />
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <FactList label="Known facts" rows={issue.knownFacts} />
        <FactList label="Disputed facts" rows={issue.disputedFacts} />
        <FactList label="Facts supporting concern" rows={issue.factsSupportingConcern} />
        <FactList label="Facts reducing concern" rows={issue.factsReducingConcern} />
        <FactList label="Missing facts" rows={issue.missingFacts} />
        <FactList label="Application questions" rows={issue.applicationQuestions} />
      </div>
      <p className="mt-3 text-sm text-ink/80">
        <span className="font-semibold">Legal standard: </span>
        {issue.legalStandard ?? "Not extracted from a source span."}
      </p>
      {issue.authorities.length > 0 ? (
        <ul className="mt-2 space-y-2 text-sm">
          {issue.authorities.map((authority) => (
            <li key={`${issue.id}-${authority.authorityId}`}>
              <span className="font-semibold">{authority.citation ?? authority.title ?? authority.authorityId}</span>
              {" · "}
              {humanizeKey(authority.authorityStatus)}
              {" · "}
              {authority.treatment === "VERIFIED" ? "Treatment verified" : "Treatment unverified"}
              {authority.proposition ? <span className="block text-ink/75">{authority.proposition}</span> : null}
              {authority.coverageWarning ? <span className="block text-ink/70">{authority.coverageWarning}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-ink/60">No source-supported authority is attached to this issue.</p>
      )}
      {issue.linkedEvidence.length > 0 ? (
        <p className="mt-2 text-sm text-ink/75">
          Linked evidence:{" "}
          {issue.linkedEvidence
            .map((item) => `${item.evidenceType}${item.documentId ? ` (${item.documentId})` : ""}`)
            .join("; ")}
        </p>
      ) : null}
      {issue.humanDecision ? (
        <p className="mt-2 text-sm text-ink/80">
          <span className="font-semibold">Human-entered decision: </span>
          {issue.humanDecision.text}
        </p>
      ) : null}
      <FactList label="Uncertainty" rows={issue.uncertainty} />
    </section>
  );
}

export function WarrantReviewPanel({
  review,
  answer,
}: {
  review: SuppressionReviewView | null | undefined;
  answer: SuppressionAnswerView | null | undefined;
}) {
  if (!review || (review.warrants.length === 0 && review.issues.length === 0)) {
    return (
      <div className="mt-4 rounded-md border border-line p-4">
        <h2 className="text-sm font-semibold text-ink">Warrants</h2>
        <p className="mt-2 text-sm text-ink/75">
          Warrant, affidavit, and execution records are stored on this case. Nyaya does not decide whether a warrant is
          valid, whether evidence should be suppressed, or guilt.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-ink/75">
        Nyaya organizes warrant and suppression review into separate questions. It does not decide suppression, warrant
        validity, or guilt.
      </p>
      {review.coverageWarnings.map((warning) => (
        <p key={warning} className="text-sm text-ink/70">
          {warning}
        </p>
      ))}
      <p className="text-xs uppercase tracking-wide text-ink/50">
        Conflict pair:{" "}
        {review.conflictPair === "NO_VERIFIED_CONFLICT_PAIR" ? "No verified conflict pair" : review.conflictPair.kind}
      </p>
      {review.warrants.map((warrant) => {
        const issues = review.issues.filter((issue) => issue.warrantId === warrant.id);
        return (
          <article key={warrant.id} className="space-y-3 rounded-md border border-line p-3">
            <header>
              <h2 className="text-base font-semibold text-ink">{humanizeKey(warrant.warrantType)} warrant</h2>
              <p className="mt-1 text-sm text-ink/70">
                {[warrant.issuingCourt, warrant.issuingJudge].filter(Boolean).join(" · ") || "Issuing court not recorded"}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-ink/80">
                <li>Application date: {warrant.applicationDate ?? "Not recorded"}</li>
                <li>Issue date: {warrant.issueDate ?? "Not recorded"}</li>
                <li>Execution date: {warrant.executionDate ?? "Not recorded"}</li>
                <li>Scope / target: {warrant.scope ?? "Not recorded"}</li>
              </ul>
            </header>
            <section>
              <h3 className="text-sm font-semibold text-ink">Affidavit and source</h3>
              {warrant.affidavitStatements.length === 0 ? (
                <p className="mt-1 text-sm text-ink/60">Affidavit text is not on this warrant record.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink/80">
                  {warrant.affidavitStatements.map((statement) => (
                    <li key={statement}>{statement}</li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="text-sm font-semibold text-ink">Execution</h3>
              <p className="mt-1 text-sm text-ink/80">
                {warrant.returnInventory.length > 0
                  ? `Inventory: ${warrant.returnInventory.join("; ")}`
                  : "Execution inventory is absent."}
              </p>
              {warrant.returnNotes ? <p className="text-sm text-ink/75">{warrant.returnNotes}</p> : null}
              {warrant.executionNotes.map((note) => (
                <p key={note} className="text-sm text-ink/75">
                  {note}
                </p>
              ))}
            </section>
            <section>
              <h3 className="text-sm font-semibold text-ink">Evidence</h3>
              {warrant.evidence.length === 0 ? (
                <p className="mt-1 text-sm text-ink/60">No evidence is linked to this warrant.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink/80">
                  {warrant.evidence.map((item) => (
                    <li key={item.evidenceId}>
                      {humanizeKey(item.evidenceType)}
                      {item.storageReference ? ` · ${item.storageReference}` : ""}
                      {item.documentId ? ` · document ${item.documentId}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h3 className="text-sm font-semibold text-ink">Officers</h3>
              <p className="mt-1 text-sm text-ink/80">
                {warrant.officerNames.length > 0 ? warrant.officerNames.join(", ") : "Officer basis is not recorded."}
              </p>
            </section>
            <section>
              <h3 className="text-sm font-semibold text-ink">Timeline</h3>
              {warrant.timelineEvents.length === 0 ? (
                <p className="mt-1 text-sm text-ink/60">No warrant timeline event is linked.</p>
              ) : (
                <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-ink/80">
                  {warrant.timelineEvents.map((event) => (
                    <li key={event.id}>
                      {humanizeKey(event.eventType)}: {event.title}
                      {event.eventDate ? ` (${event.eventDate})` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {warrant.unassignedMissingFacts.length > 0 ? (
              <FactList label="Missing facts not assigned to one issue" rows={warrant.unassignedMissingFacts} />
            ) : null}
            <div className="space-y-3">
              {issues.map((issue) => (
                <IssueBlock key={issue.id} issue={issue} />
              ))}
            </div>
          </article>
        );
      })}
      {review.issues.some((issue) => issue.warrantId === null) ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-ink">Other procedure issues</h2>
          {review.issues
            .filter((issue) => issue.warrantId === null)
            .map((issue) => (
              <IssueBlock key={issue.id} issue={issue} />
            ))}
        </div>
      ) : null}
      {answer ? (
        <section className="rounded-md border border-line p-3" aria-label="Ask Nyaya suppression review">
          <h2 className="text-sm font-semibold text-ink">Ask Nyaya</h2>
          <p className="mt-1 text-sm text-ink/70">{answer.question}</p>
          <ul className="mt-2 space-y-2 text-sm text-ink/80">
            {answer.issues.map((issue) => (
              <li key={issue.issueId}>
                <span className="font-semibold">{humanizeKey(issue.dimension)}</span>
                {issue.missingFacts.length > 0 ? ` — missing: ${issue.missingFacts[0]}` : ""}
                {issue.bindingAuthorities.length > 0
                  ? ` — binding: ${issue.bindingAuthorities
                      .map(
                        (authority) =>
                          `${authority.citation ?? authority.authorityId} (${authority.treatment === "VERIFIED" ? "treatment verified" : "treatment unverified"})`,
                      )
                      .join(", ")}`
                  : ""}
              </li>
            ))}
          </ul>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-ink/70">
            {answer.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
