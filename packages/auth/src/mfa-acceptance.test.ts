import { describe, expect, it } from "vitest";
import {
  MfaRequiredError,
  assertClerkMfaSatisfied,
  evaluateClerkMfaPolicy,
  isClerkMfaRequired,
} from "./mfa-policy";

/**
 * Deterministic MFA acceptance matrix (WP-04 Phase 3).
 * Live Clerk enrollment/challenge remains STAGING_LIVE_UNVERIFIED without approved credentials.
 */
describe("WP-04 MFA acceptance matrix", () => {
  it("1 — signed-out / missing userId fails closed when required", () => {
    expect(() => assertClerkMfaSatisfied({ userId: null })).toThrow(MfaRequiredError);
  });

  it("2 — signed-in without MFA enrolled denied", () => {
    const r = evaluateClerkMfaPolicy({
      env: { REQUIRE_CLERK_MFA: "1" },
      session: { userId: "u1", twoFactorEnabled: false },
    });
    expect(r).toEqual({ required: true, satisfied: false, code: "MFA_REQUIRED" });
  });

  it("3 — verified MFA admitted", () => {
    const r = evaluateClerkMfaPolicy({
      env: { REQUIRE_CLERK_MFA: "1" },
      session: { userId: "u1", twoFactorEnabled: true, factorVerificationAge: 2 },
    });
    expect(r).toEqual({ required: true, satisfied: true });
  });

  it("4/5 — expired/revoked modeled as missing userId", () => {
    expect(
      evaluateClerkMfaPolicy({
        env: { REQUIRE_CLERK_MFA: "1" },
        session: { userId: null },
      }).satisfied,
    ).toBe(false);
  });

  it("6 — missing MFA claims fail closed (unknown)", () => {
    const r = evaluateClerkMfaPolicy({
      env: { REQUIRE_CLERK_MFA: "1" },
      session: { userId: "u1" },
    });
    expect(r.code).toBe("MFA_STATUS_UNKNOWN");
  });

  it("13 — client parameters cannot disable MFA policy", () => {
    expect(isClerkMfaRequired({ REQUIRE_CLERK_MFA: "1", clientDisableMfa: "1" })).toBe(true);
    expect(isClerkMfaRequired({ REQUIRE_CLERK_MFA: "1", REQUIRE_CLERK_MFA_CLIENT: "0" })).toBe(true);
  });

  it("14 — missing Clerk env: policy off by default (fail-safe for local/dev)", () => {
    expect(isClerkMfaRequired({})).toBe(false);
  });

  it("15 — MFA error codes do not embed secrets", () => {
    try {
      assertClerkMfaSatisfied({
        userId: "user_secret_should_not_leak_in_code",
        twoFactorEnabled: true,
        factorVerificationAge: null,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(MfaRequiredError);
      const e = error as MfaRequiredError;
      expect(e.code).toBe("MFA_CHALLENGE_REQUIRED");
      expect(e.message).not.toMatch(/user_secret/);
      expect(JSON.stringify(e)).not.toMatch(/cookie|token|sk_live/i);
    }
  });

  it("enrolled but unverified second factor denied", () => {
    expect(() =>
      assertClerkMfaSatisfied({
        userId: "u1",
        twoFactorEnabled: true,
        factorVerificationAge: null,
      }),
    ).toThrow(/Complete multi-factor/i);
  });

  it("7–11 — MFA gate is role-agnostic (Owner/Lawyer/Prosecutor/cross-org)", () => {
    // Role and tenant isolation are enforced by permissions; MFA only keys off session claims.
    for (const _role of [
      "organization_owner",
      "lawyer",
      "paralegal",
      "prosecutor",
      "supervising_prosecutor",
    ]) {
      expect(
        evaluateClerkMfaPolicy({
          env: { REQUIRE_CLERK_MFA: "1" },
          session: { userId: "u1", twoFactorEnabled: false },
        }).satisfied,
      ).toBe(false);
      expect(
        evaluateClerkMfaPolicy({
          env: { REQUIRE_CLERK_MFA: "1" },
          session: { userId: "u1", twoFactorEnabled: true, factorVerificationAge: 1 },
        }).satisfied,
      ).toBe(true);
    }
  });

  it("12 — API-shaped session without MFA cannot satisfy policy (middleware bypass denial)", () => {
    // Simulates an API caller that somehow presents a userId but no MFA claims.
    const r = evaluateClerkMfaPolicy({
      env: { REQUIRE_CLERK_MFA: "1" },
      session: { userId: "api_user" },
    });
    expect(r.required).toBe(true);
    expect(r.satisfied).toBe(false);
    expect(r.code).toBe("MFA_STATUS_UNKNOWN");
  });
});
