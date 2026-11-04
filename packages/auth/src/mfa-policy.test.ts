import { describe, expect, it } from "vitest";
import {
  MfaRequiredError,
  assertClerkMfaSatisfied,
  evaluateClerkMfaPolicy,
  isClerkMfaRequired,
} from "./mfa-policy";

describe("Clerk MFA policy", () => {
  it("is off by default", () => {
    expect(isClerkMfaRequired({})).toBe(false);
    expect(isClerkMfaRequired({ REQUIRE_CLERK_MFA: "0" })).toBe(false);
  });

  it("recognizes REQUIRE_CLERK_MFA / FEATURE_REQUIRE_CLERK_MFA", () => {
    expect(isClerkMfaRequired({ REQUIRE_CLERK_MFA: "1" })).toBe(true);
    expect(isClerkMfaRequired({ FEATURE_REQUIRE_CLERK_MFA: "true" })).toBe(true);
  });

  it("rejects users without MFA enrolled when required", () => {
    expect(() =>
      assertClerkMfaSatisfied({
        userId: "user_1",
        twoFactorEnabled: false,
      }),
    ).toThrow(MfaRequiredError);
  });

  it("rejects enrolled users without verified second factor this session", () => {
    try {
      assertClerkMfaSatisfied({
        userId: "user_1",
        twoFactorEnabled: true,
        factorVerificationAge: null,
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(MfaRequiredError);
      expect((error as MfaRequiredError).code).toBe("MFA_CHALLENGE_REQUIRED");
    }
  });

  it("accepts verified MFA sessions", () => {
    expect(() =>
      assertClerkMfaSatisfied({
        userId: "user_1",
        twoFactorEnabled: true,
        factorVerificationAge: 5,
      }),
    ).not.toThrow();
  });

  it("fail-closes when MFA status is unknown under required policy", () => {
    const result = evaluateClerkMfaPolicy({
      env: { REQUIRE_CLERK_MFA: "1" },
      session: { userId: "user_1" },
    });
    expect(result).toEqual({ required: true, satisfied: false, code: "MFA_STATUS_UNKNOWN" });
  });

  it("skips enforcement when policy is off", () => {
    const result = evaluateClerkMfaPolicy({
      env: {},
      session: { userId: "user_1", twoFactorEnabled: false },
    });
    expect(result).toEqual({ required: false, satisfied: true });
  });
});
