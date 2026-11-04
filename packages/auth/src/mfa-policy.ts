/**
 * Server-side Clerk MFA enforcement policy.
 *
 * Clerk Dashboard organization MFA settings remain the primary control and must not be
 * changed by automation. This module is defense-in-depth for NyayaGrid API/routes when
 * REQUIRE_CLERK_MFA=1 (or FEATURE_REQUIRE_CLERK_MFA=1).
 *
 * Live production MFA configuration verification is a separate ops gate — unit tests here
 * do not prove Clerk Dashboard settings.
 */

/** Minimal session fields required for MFA policy (avoids circular import with index). */
export type ClerkMfaSessionView = {
  userId: string | null;
  twoFactorEnabled?: boolean | null;
  factorVerificationAge?: number | null;
};

export class MfaRequiredError extends Error {
  readonly code: "MFA_REQUIRED" | "MFA_CHALLENGE_REQUIRED" | "MFA_STATUS_UNKNOWN";
  constructor(
    code: MfaRequiredError["code"],
    message = "Multi-factor authentication is required.",
  ) {
    super(message);
    this.name = "MfaRequiredError";
    this.code = code;
  }
}

export function isClerkMfaRequired(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): boolean {
  const raw = String(env.REQUIRE_CLERK_MFA ?? env.FEATURE_REQUIRE_CLERK_MFA ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Assert MFA is satisfied for a Clerk session when the env policy requires it.
 * Fail closed when MFA status cannot be determined under a required policy.
 */
export function assertClerkMfaSatisfied(session: ClerkMfaSessionView): void {
  if (!session.userId) {
    throw new MfaRequiredError("MFA_STATUS_UNKNOWN", "No authenticated Clerk session.");
  }

  if (session.twoFactorEnabled === false) {
    throw new MfaRequiredError(
      "MFA_REQUIRED",
      "Multi-factor authentication must be enrolled for this account.",
    );
  }

  if (session.twoFactorEnabled === true) {
    // null/undefined factorVerificationAge means second factor was not verified this session.
    if (session.factorVerificationAge == null) {
      throw new MfaRequiredError(
        "MFA_CHALLENGE_REQUIRED",
        "Complete multi-factor authentication to continue.",
      );
    }
    return;
  }

  // twoFactorEnabled unknown — fail closed under required policy.
  throw new MfaRequiredError(
    "MFA_STATUS_UNKNOWN",
    "Unable to verify multi-factor authentication status for this session.",
  );
}

export function evaluateClerkMfaPolicy(params: {
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  session: ClerkMfaSessionView;
}): { required: boolean; satisfied: boolean; code?: MfaRequiredError["code"] } {
  const required = isClerkMfaRequired(params.env);
  if (!required) return { required: false, satisfied: true };
  try {
    assertClerkMfaSatisfied(params.session);
    return { required: true, satisfied: true };
  } catch (error) {
    if (error instanceof MfaRequiredError) {
      return { required: true, satisfied: false, code: error.code };
    }
    throw error;
  }
}
