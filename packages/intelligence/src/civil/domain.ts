import {
  CIVIL_AUTHORITY_RELATIONS,
  CIVIL_CLAIM_KINDS,
  CIVIL_DEFENSE_KINDS,
  CIVIL_ELEMENT_STATUSES,
  CIVIL_EVIDENCE_ROLES,
  CIVIL_PARTY_ROLES,
  CIVIL_PROCEDURAL_STATUSES,
  assertCivilElementStatus,
  type CivilAuthorityRelation,
  type CivilClaimKind,
  type CivilDefenseKind,
  type CivilElementStatus,
  type CivilEvidenceRole,
  type CivilPartyRole,
  type CivilProceduralStatus,
} from "./claims-model";

export class CivilError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "CivilError";
  }
}

const EMPTY_PROVENANCE = {
  humanEntered: true,
  extractionOrigin: "human" as const,
};

export function defaultCivilProvenance(overrides?: Record<string, unknown>) {
  return { ...EMPTY_PROVENANCE, ...overrides };
}

export function assertClaimKind(kind: string): asserts kind is CivilClaimKind {
  if (!(CIVIL_CLAIM_KINDS as readonly string[]).includes(kind)) {
    throw new CivilError("INVALID_KIND", `Invalid civil claim kind: ${kind}`);
  }
}

export function assertDefenseKind(kind: string): asserts kind is CivilDefenseKind {
  if (!(CIVIL_DEFENSE_KINDS as readonly string[]).includes(kind)) {
    throw new CivilError("INVALID_KIND", `Invalid civil defense kind: ${kind}`);
  }
}

export function assertSupportStatus(status: string): asserts status is CivilElementStatus {
  assertCivilElementStatus(status);
}

export function assertProceduralStatus(status: string): asserts status is CivilProceduralStatus {
  if (!(CIVIL_PROCEDURAL_STATUSES as readonly string[]).includes(status)) {
    throw new CivilError("INVALID_STATUS", `Invalid procedural status: ${status}`);
  }
}

export function assertPartyRole(role: string): asserts role is CivilPartyRole {
  if (!(CIVIL_PARTY_ROLES as readonly string[]).includes(role)) {
    throw new CivilError("INVALID_ROLE", `Invalid civil party role: ${role}`);
  }
}

export function assertEvidenceRole(role: string): asserts role is CivilEvidenceRole {
  if (!(CIVIL_EVIDENCE_ROLES as readonly string[]).includes(role)) {
    throw new CivilError("INVALID_ROLE", `Invalid civil evidence role: ${role}`);
  }
}

export function assertAuthorityRelation(relation: string): asserts relation is CivilAuthorityRelation {
  if (!(CIVIL_AUTHORITY_RELATIONS as readonly string[]).includes(relation)) {
    throw new CivilError("INVALID_RELATION", `Invalid authority relation: ${relation}`);
  }
}

export function assertSameMatter(expectedMatterId: string, actualMatterId: string) {
  if (expectedMatterId !== actualMatterId) {
    throw new CivilError("CROSS_MATTER", "Cross-matter civil relation denied.", 403);
  }
}

export function assertSameOrg(expectedOrgId: string, actualOrgId: string) {
  if (expectedOrgId !== actualOrgId) {
    throw new CivilError("CROSS_ORG", "Cross-organization civil relation denied.", 403);
  }
}

export {
  CIVIL_ELEMENT_STATUSES,
  CIVIL_PROCEDURAL_STATUSES,
  CIVIL_PARTY_ROLES,
  CIVIL_EVIDENCE_ROLES,
  CIVIL_CLAIM_KINDS,
  CIVIL_DEFENSE_KINDS,
  CIVIL_AUTHORITY_RELATIONS,
};
