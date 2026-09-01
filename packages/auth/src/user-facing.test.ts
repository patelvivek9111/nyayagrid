import { describe, expect, it } from "vitest";
import { USER_FACING_AUTH, userFacingAuthMessage, userFacingInviteMessage } from "./user-facing";

describe("user-facing auth copy", () => {
  it("maps 401 and 403 without provider jargon", () => {
    expect(userFacingAuthMessage(401)).toBe(USER_FACING_AUTH.unauthenticated);
    expect(userFacingAuthMessage(403)).toBe(USER_FACING_AUTH.forbidden);
    expect(USER_FACING_AUTH.unauthenticated).toMatch(/sign in/i);
    expect(USER_FACING_AUTH.forbidden).toMatch(/access/i);
    expect(JSON.stringify(USER_FACING_AUTH)).not.toMatch(/Clerk|DevAuth|stack|token/i);
  });

  it("maps invite failures to administrator-directed copy", () => {
    expect(userFacingInviteMessage("EXPIRED")).toMatch(/no longer valid/i);
    expect(userFacingInviteMessage("REVOKED")).toMatch(/administrator/i);
    expect(userFacingInviteMessage("EMAIL_MISMATCH")).toMatch(/different email/i);
    expect(userFacingInviteMessage("ALREADY_ACCEPTED")).toMatch(/already been used/i);
    expect(userFacingInviteMessage("NOT_FOUND")).not.toMatch(/token/i);
  });
});
