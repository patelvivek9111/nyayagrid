import {
  DISCOVERY_DEFICIENCY_KINDS,
  DISCOVERY_DEFICIENCY_STATUSES,
  DISCOVERY_ITEM_STATUSES,
  DISCOVERY_REQUEST_TYPES,
  PRIVILEGE_REVIEW_STATUSES,
  type DiscoveryDeficiencyKind,
  type DiscoveryDeficiencyStatus,
  type DiscoveryItemStatus,
  type DiscoveryRequestType,
  type PrivilegeReviewStatus,
} from "./types";

export class DiscoveryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}

const EMPTY_PROVENANCE = {
  humanEntered: true,
  extractionOrigin: "human" as const,
};

export function defaultDiscoveryProvenance(overrides?: Record<string, unknown>) {
  return { ...EMPTY_PROVENANCE, ...overrides };
}

export function assertDiscoveryRequestType(value: string): asserts value is DiscoveryRequestType {
  if (!(DISCOVERY_REQUEST_TYPES as readonly string[]).includes(value)) {
    throw new DiscoveryError("INVALID_TYPE", `Invalid discovery request type: ${value}`);
  }
}

export function assertDiscoveryItemStatus(value: string): asserts value is DiscoveryItemStatus {
  if (!(DISCOVERY_ITEM_STATUSES as readonly string[]).includes(value)) {
    throw new DiscoveryError("INVALID_STATUS", `Invalid discovery item status: ${value}`);
  }
}

export function assertDiscoveryDeficiencyKind(
  value: string,
): asserts value is DiscoveryDeficiencyKind {
  if (!(DISCOVERY_DEFICIENCY_KINDS as readonly string[]).includes(value)) {
    throw new DiscoveryError("INVALID_KIND", `Invalid discovery deficiency kind: ${value}`);
  }
}

export function assertDiscoveryDeficiencyStatus(
  value: string,
): asserts value is DiscoveryDeficiencyStatus {
  if (!(DISCOVERY_DEFICIENCY_STATUSES as readonly string[]).includes(value)) {
    throw new DiscoveryError("INVALID_STATUS", `Invalid discovery deficiency status: ${value}`);
  }
}

export function assertPrivilegeReviewStatus(value: string): asserts value is PrivilegeReviewStatus {
  if (!(PRIVILEGE_REVIEW_STATUSES as readonly string[]).includes(value)) {
    throw new DiscoveryError("INVALID_STATUS", `Invalid privilege review status: ${value}`);
  }
  for (const forbidden of ["PRIVILEGED", "NOT_PRIVILEGED", "PRIVILEGE_ESTABLISHED"]) {
    if (value === forbidden) {
      throw new DiscoveryError(
        "INVALID_STATUS",
        "Privilege legal conclusions are not allowed as review status.",
      );
    }
  }
}

export function assertSameMatter(expectedMatterId: string, actualMatterId: string | null | undefined) {
  if (!actualMatterId || expectedMatterId !== actualMatterId) {
    throw new DiscoveryError("CROSS_MATTER", "Cross-matter discovery relation denied.", 403);
  }
}

export function assertSameOrg(expectedOrgId: string, actualOrgId: string | null | undefined) {
  if (!actualOrgId || expectedOrgId !== actualOrgId) {
    throw new DiscoveryError("CROSS_ORG", "Cross-organization discovery relation denied.", 403);
  }
}

export {
  DISCOVERY_REQUEST_TYPES,
  DISCOVERY_ITEM_STATUSES,
  DISCOVERY_DEFICIENCY_KINDS,
  DISCOVERY_DEFICIENCY_STATUSES,
  PRIVILEGE_REVIEW_STATUSES,
};
