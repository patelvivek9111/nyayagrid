import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_DEFINITIONS } from "./system-roles";

describe("system roles", () => {
  it("includes owner, lawyer, staff, and client_guest", () => {
    expect(SYSTEM_ROLE_DEFINITIONS.map((r) => r.key)).toEqual([
      "owner",
      "lawyer",
      "staff",
      "client_guest",
    ]);
  });

  it("gives client guests view-only matter and document access", () => {
    const guest = SYSTEM_ROLE_DEFINITIONS.find((r) => r.key === "client_guest");
    expect(guest?.capabilities).toEqual(["matters.view", "documents.view"]);
    expect(guest?.capabilities).not.toContain("organization.manage");
    expect(guest?.capabilities).not.toContain("documents.upload");
  });
});
