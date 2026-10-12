import { isClientGuestRole } from "./first-run";

/** API/error code for client_guest Command Center / professional Ask denial. */
export const DENY_GUEST_ASK = "DENY_GUEST_ASK" as const;

export const GUEST_COMMAND_CENTER_MESSAGE =
  "This workspace is not available for client guest access.";

/**
 * Thrown when a client_guest attempts professional Command Center Ask or
 * matter conversation APIs. Distinct from generic FORBIDDEN so UI can show
 * a clear guest-policy message without leaking conversation metadata.
 */
export class GuestCommandCenterError extends Error {
  readonly code = DENY_GUEST_ASK;
  constructor(message = GUEST_COMMAND_CENTER_MESSAGE) {
    super(message);
    this.name = "GuestCommandCenterError";
  }
}

/** Fail closed: client_guest must not use professional Ask / Command Center APIs. */
export function assertProfessionalCommandCenterAccess(
  roleKey: string | null | undefined,
): void {
  if (isClientGuestRole(roleKey)) {
    throw new GuestCommandCenterError();
  }
}
