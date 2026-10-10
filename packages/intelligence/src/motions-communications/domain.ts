import {
  MATTER_COMMUNICATION_DIRECTIONS,
  MATTER_COMMUNICATION_LINK_TYPES,
  MATTER_COMMUNICATION_STATUSES,
  MATTER_COMMUNICATION_TYPES,
  MATTER_MOTION_DISPOSITIONS,
  MATTER_MOTION_DOCUMENT_ROLES,
  MATTER_MOTION_LINK_TYPES,
  MATTER_MOTION_STATUSES,
  MATTER_MOTION_TYPES,
  type MatterCommunicationDirection,
  type MatterCommunicationLinkType,
  type MatterCommunicationStatus,
  type MatterCommunicationType,
  type MatterMotionDisposition,
  type MatterMotionDocumentRole,
  type MatterMotionLinkType,
  type MatterMotionStatus,
  type MatterMotionType,
} from "@nyayagrid/database";

export class MotionsCommunicationsError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "MotionsCommunicationsError";
  }
}

const EMPTY_PROVENANCE = {
  humanEntered: true,
  extractionOrigin: "human" as const,
};

export function defaultMcProvenance(overrides?: Record<string, unknown>) {
  return { ...EMPTY_PROVENANCE, ...overrides };
}

export function assertMotionType(value: string): asserts value is MatterMotionType {
  if (!(MATTER_MOTION_TYPES as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError("INVALID_TYPE", `Invalid motion type: ${value}`);
  }
}

export function assertMotionStatus(value: string): asserts value is MatterMotionStatus {
  if (!(MATTER_MOTION_STATUSES as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError("INVALID_STATUS", `Invalid motion status: ${value}`);
  }
}

export function assertMotionDisposition(
  value: string | null | undefined,
): asserts value is MatterMotionDisposition | null | undefined {
  if (value == null || value === "") return;
  if (!(MATTER_MOTION_DISPOSITIONS as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError("INVALID_DISPOSITION", `Invalid disposition: ${value}`);
  }
}

export function assertMotionDocumentRole(value: string): asserts value is MatterMotionDocumentRole {
  if (!(MATTER_MOTION_DOCUMENT_ROLES as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError("INVALID_ROLE", `Invalid motion document role: ${value}`);
  }
}

export function assertMotionLinkType(value: string): asserts value is MatterMotionLinkType {
  if (!(MATTER_MOTION_LINK_TYPES as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError("INVALID_LINK_TYPE", `Invalid motion link type: ${value}`);
  }
}

export function assertCommunicationType(value: string): asserts value is MatterCommunicationType {
  if (!(MATTER_COMMUNICATION_TYPES as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError("INVALID_TYPE", `Invalid communication type: ${value}`);
  }
}

export function assertCommunicationDirection(
  value: string,
): asserts value is MatterCommunicationDirection {
  if (!(MATTER_COMMUNICATION_DIRECTIONS as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError("INVALID_DIRECTION", `Invalid direction: ${value}`);
  }
}

export function assertCommunicationStatus(
  value: string,
): asserts value is MatterCommunicationStatus {
  if (!(MATTER_COMMUNICATION_STATUSES as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError("INVALID_STATUS", `Invalid communication status: ${value}`);
  }
}

export function assertCommunicationLinkType(
  value: string,
): asserts value is MatterCommunicationLinkType {
  if (!(MATTER_COMMUNICATION_LINK_TYPES as readonly string[]).includes(value)) {
    throw new MotionsCommunicationsError(
      "INVALID_LINK_TYPE",
      `Invalid communication link type: ${value}`,
    );
  }
}

export function assertSameMatter(expectedMatterId: string, actualMatterId: string | null | undefined) {
  if (!actualMatterId || expectedMatterId !== actualMatterId) {
    throw new MotionsCommunicationsError("CROSS_MATTER", "Cross-matter relation denied.", 403);
  }
}

export function assertSameOrg(expectedOrgId: string, actualOrgId: string | null | undefined) {
  if (!actualOrgId || expectedOrgId !== actualOrgId) {
    throw new MotionsCommunicationsError("CROSS_ORG", "Cross-organization relation denied.", 403);
  }
}

/** Pending = not terminal disposition labels. */
export const TERMINAL_MOTION_STATUSES = new Set<string>([
  "GRANTED",
  "DENIED",
  "GRANTED_IN_PART",
  "WITHDRAWN",
  "MOOT",
]);

export function isPendingMotionStatus(status: string): boolean {
  return !TERMINAL_MOTION_STATUSES.has(status);
}
