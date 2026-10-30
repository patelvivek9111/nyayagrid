import { describe, expect, it } from "vitest";
import { PROSECUTION_ROLE_DEFINITIONS, SYSTEM_ROLE_DEFINITIONS } from "./system-roles";

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
    expect(guest?.capabilities).not.toContain("prosecution.view");
  });

  it("prepares prosecution roles on the same capability model", () => {
    expect(PROSECUTION_ROLE_DEFINITIONS.map((role) => role.key)).toEqual([
      "prosecution_office_admin",
      "supervising_prosecutor",
      "prosecutor",
      "investigator",
      "legal_support",
      "prosecution_read_only",
    ]);
    const reader = PROSECUTION_ROLE_DEFINITIONS.find(
      (role) => role.key === "prosecution_read_only",
    );
    expect(reader?.capabilities).not.toContain("prosecution.edit");
    expect(reader?.capabilities).not.toContain("prosecution.review");
    const prosecutor = PROSECUTION_ROLE_DEFINITIONS.find((role) => role.key === "prosecutor");
    expect(prosecutor?.capabilities).toContain("prosecution.charge.manage");
    expect(prosecutor?.capabilities).toContain("drafts.create");
    expect(prosecutor?.capabilities).not.toContain("prosecution.review");
    const support = PROSECUTION_ROLE_DEFINITIONS.find((role) => role.key === "legal_support");
    expect(support?.capabilities).toContain("prosecution.discovery.manage");
    expect(support?.capabilities).not.toContain("prosecution.edit");
    expect(support?.capabilities).not.toContain("prosecution.charge.manage");
    expect(support?.capabilities).not.toContain("prosecution.review");
    const investigator = PROSECUTION_ROLE_DEFINITIONS.find((role) => role.key === "investigator");
    expect(investigator?.capabilities).toContain("prosecution.evidence.manage");
    expect(investigator?.capabilities).not.toContain("prosecution.charge.manage");
  });
});
