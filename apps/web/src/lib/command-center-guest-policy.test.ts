import { describe, expect, it } from "vitest";
import {
  DENY_GUEST_ASK,
  GUEST_COMMAND_CENTER_MESSAGE,
  GuestCommandCenterError,
  assertProfessionalCommandCenterAccess,
} from "./command-center-guest-policy";

describe("Phase 5 guest Command Center policy", () => {
  it("L — denies client_guest Ask / Command Center", () => {
    expect(() => assertProfessionalCommandCenterAccess("client_guest")).toThrow(
      GuestCommandCenterError,
    );
    try {
      assertProfessionalCommandCenterAccess("client_guest");
    } catch (err) {
      expect(err).toBeInstanceOf(GuestCommandCenterError);
      expect((err as GuestCommandCenterError).code).toBe(DENY_GUEST_ASK);
      expect((err as GuestCommandCenterError).message).toBe(GUEST_COMMAND_CENTER_MESSAGE);
    }
  });

  it("N — does not deny professional roles (portal surfaces unchanged elsewhere)", () => {
    expect(() => assertProfessionalCommandCenterAccess("lawyer")).not.toThrow();
    expect(() => assertProfessionalCommandCenterAccess("owner")).not.toThrow();
    expect(() => assertProfessionalCommandCenterAccess("paralegal")).not.toThrow();
    expect(() => assertProfessionalCommandCenterAccess(null)).not.toThrow();
  });
});
