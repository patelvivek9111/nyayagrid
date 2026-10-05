import type { AuthorityStatusClassification } from "@nyayagrid/jurisdiction";
import { assertProvenance } from "./standards";
import {
  ISSUE_AUTHORITY_RELATIONS,
  type IssueAuthorityLink,
  type IssueAuthorityRelation,
  type LegalIssue,
} from "./types";

export function createLegalIssue(input: LegalIssue): LegalIssue {
  assertProvenance(input.provenance);
  if (!input.description.trim()) {
    throw new Error("A legal issue needs a description.");
  }
  return {
    ...input,
    relatedFactIds: input.relatedFactIds ?? [],
    relatedEvidenceIds: input.relatedEvidenceIds ?? [],
    authorityIds: input.authorityIds ?? [],
    standardIds: input.standardIds ?? [],
    conflictIds: input.conflictIds ?? [],
  };
}

export function linkIssueToAuthority(input: {
  issueId: string;
  authorityId: string;
  relation: IssueAuthorityRelation;
  authorityStatus?: AuthorityStatusClassification | null;
  provenance: IssueAuthorityLink["provenance"];
}): IssueAuthorityLink {
  assertProvenance(input.provenance);
  if (!ISSUE_AUTHORITY_RELATIONS.includes(input.relation)) {
    throw new Error("Unsupported issue-authority relation.");
  }
  return {
    issueId: input.issueId,
    authorityId: input.authorityId,
    relation: input.relation,
    authorityStatus: input.authorityStatus ?? null,
    provenance: input.provenance,
  };
}

/** Storage relation only. This does not generate a legal conclusion. */
export function relationForStatus(
  status: AuthorityStatusClassification | null,
): IssueAuthorityRelation {
  switch (status) {
    case "BINDING":
      return "BINDING_RELEVANT";
    case "PERSUASIVE":
      return "PERSUASIVE_RELEVANT";
    case "NONCONTROLLING":
    case "OUT_OF_JURISDICTION":
      return "BACKGROUND";
    default:
      return "UNKNOWN";
  }
}
