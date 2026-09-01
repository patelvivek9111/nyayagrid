/**
 * User-facing authentication and invitation copy. API codes stay machine-stable; these strings are
 * what humans see. Never interpolate provider or token details.
 */
export const USER_FACING_AUTH = {
  unauthenticated: "Please sign in to continue.",
  sessionExpired: "Your session has ended. Please sign in to continue.",
  forbidden: "You don’t have access to this workspace or case.",
  unavailable: "We couldn’t sign you in. Try again.",
} as const;

export function userFacingInviteMessage(code: string): string {
  switch (code) {
    case "EXPIRED":
    case "REVOKED":
    case "NOT_FOUND":
      return "This invitation is no longer valid. Ask your firm administrator for a new invitation.";
    case "ALREADY_ACCEPTED":
      return "This invitation has already been used. Sign in to continue.";
    case "EMAIL_MISMATCH":
      return "This invitation was sent to a different email address. Sign in with the invited account.";
    default:
      return "We couldn’t accept this invitation. Ask your administrator for a new one.";
  }
}

export function userFacingAuthMessage(status: number, code?: string | null): string {
  if (status === 401 || code === "UNAUTHENTICATED") return USER_FACING_AUTH.unauthenticated;
  if (status === 403 || code === "FORBIDDEN") return USER_FACING_AUTH.forbidden;
  if (code === "SESSION_EXPIRED") return USER_FACING_AUTH.sessionExpired;
  return USER_FACING_AUTH.unavailable;
}
