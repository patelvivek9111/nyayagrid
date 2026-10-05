import { evaluateAuthorityStatus } from "@nyayagrid/jurisdiction";
import { linkIssueToAuthority, relationForStatus } from "./issues";
import { createLegalIssue } from "./issues";
import { createLegalStandard } from "./standards";
import type { LawToEvidenceRecord } from "./types";

const PROV = {
  authorityId: "00000000-0000-4000-8000-0000000000a1",
  sourceSpan: "Synthetic span: the rule is stated in the source text.",
  extractionOrigin: "deterministic_fixture" as const,
  humanEntered: false,
};

/** Law-firm demo. Synthetic identifiers only. No guilt or merits conclusion. */
export function buildLawFirmDemo(): LawToEvidenceRecord {
  const binding = evaluateAuthorityStatus({
    questionJurisdiction: "US",
    forumCourtId: "us-d-pa-ed",
    issueType: "FEDERAL_STATUTORY",
    authorityCourtId: "us-ca-3",
    currentness: "unknown",
    sourceMetadata: { citation: "SYNTHETIC-3D-2020-001" },
  });
  const persuasive = evaluateAuthorityStatus({
    questionJurisdiction: "US",
    forumCourtId: "us-d-pa-ed",
    issueType: "FEDERAL_STATUTORY",
    authorityCourtId: "us-ca-2",
    sourceMetadata: { citation: "SYNTHETIC-2D-2019-014" },
  });
  const issue = createLegalIssue({
    id: "issue-firm-1",
    issueType: "FEDERAL_STATUTORY",
    jurisdiction: "US",
    matterId: "matter-synthetic-1",
    caseId: null,
    description: "Whether the synthetic notice requirement was met.",
    relatedFactIds: ["fact-1"],
    relatedEvidenceIds: ["ev-support", "ev-contrary"],
    authorityIds: ["auth-3d", "auth-2d"],
    standardIds: ["std-1"],
    conflictIds: [],
    status: "open",
    confidence: "medium",
    provenance: PROV,
  });
  const standard = createLegalStandard({
    id: "std-1",
    authorityId: "auth-3d",
    issueId: issue.id,
    ruleText: "Synthetic rule: notice must be written and timely.",
    standardType: "RULE",
    elements: ["written notice", "timely delivery"],
    sourceSpan: "Synthetic source span at page 4.",
    sourcePage: 4,
    sourceCitation: "SYNTHETIC-3D-2020-001",
    confidence: "medium",
    status: "canonical",
    provenance: { ...PROV, authorityId: "auth-3d" },
  });
  return {
    issue,
    standard,
    requirement: "written notice",
    facts: [{ id: "fact-1", text: "A letter was sent on day 10.", provenance: { ...PROV, documentId: "doc-letter" } }],
    supportingEvidence: [
      { id: "ev-support", text: "Letter exhibit states the notice.", provenance: { ...PROV, documentId: "doc-letter", sourcePage: 1 } },
    ],
    contraryEvidence: [
      { id: "ev-contrary", text: "Recipient log has no delivery entry.", provenance: { ...PROV, documentId: "doc-log", sourcePage: 2 } },
    ],
    missingEvidence: [],
    authorities: [
      linkIssueToAuthority({
        issueId: issue.id,
        authorityId: "auth-3d",
        relation: relationForStatus(binding.classification),
        authorityStatus: binding.classification,
        provenance: { ...PROV, sourceSpan: binding.explanation },
      }),
      linkIssueToAuthority({
        issueId: issue.id,
        authorityId: "auth-2d",
        relation: relationForStatus(persuasive.classification),
        authorityStatus: persuasive.classification,
        provenance: { ...PROV, sourceSpan: persuasive.explanation },
      }),
    ],
    analysisState: "structured",
    guiltConclusion: null,
  };
}
