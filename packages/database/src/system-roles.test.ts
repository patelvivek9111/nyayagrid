import { describe, expect, it } from "vitest";
import { PROSECUTION_ROLE_DEFINITIONS, SYSTEM_ROLE_DEFINITIONS } from "./system-roles";

describe("system roles", () => {
  it("includes Owner/Admin/Partner/Lawyer/Paralegal/Staff/Client Guest", () => {
    expect(SYSTEM_ROLE_DEFINITIONS.map((r) => r.key)).toEqual([
      "owner",
      "admin",
      "partner",
      "lawyer",
      "paralegal",
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

  it("scopes admin, partner, and paralegal without over-privilege", () => {
    const admin = SYSTEM_ROLE_DEFINITIONS.find((r) => r.key === "admin");
    expect(admin?.capabilities).toContain("organization.manage");
    expect(admin?.capabilities).toContain("members.invite");
    expect(admin?.capabilities).not.toContain("prosecution.edit");

    const partner = SYSTEM_ROLE_DEFINITIONS.find((r) => r.key === "partner");
    expect(partner?.capabilities).toContain("matters.close");
    expect(partner?.capabilities).toContain("members.invite");
    expect(partner?.capabilities).not.toContain("organization.manage");

    const paralegal = SYSTEM_ROLE_DEFINITIONS.find((r) => r.key === "paralegal");
    expect(paralegal?.capabilities).toContain("documents.upload");
    expect(paralegal?.capabilities).toContain("drafts.create");
    expect(paralegal?.capabilities).not.toContain("matters.create");
    expect(paralegal?.capabilities).not.toContain("matters.close");
    expect(paralegal?.capabilities).not.toContain("organization.manage");
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
    expect(prosecutor?.capabilities).toContain("prosecution.edit");
    expect(prosecutor?.capabilities).not.toContain("prosecution.review");
    expect(prosecutor?.capabilities).not.toContain("audit.view");
    const supervisor = PROSECUTION_ROLE_DEFINITIONS.find(
      (role) => role.key === "supervising_prosecutor",
    );
    expect(supervisor?.capabilities).toContain("prosecution.review");
    expect(supervisor?.capabilities).toContain("audit.view");
    const officeAdmin = PROSECUTION_ROLE_DEFINITIONS.find(
      (role) => role.key === "prosecution_office_admin",
    );
    expect(officeAdmin?.capabilities).toContain("audit.view");
    const legalSupport = PROSECUTION_ROLE_DEFINITIONS.find((role) => role.key === "legal_support");
    expect(legalSupport?.capabilities).not.toContain("prosecution.edit");
    expect(legalSupport?.capabilities).not.toContain("prosecution.review");
    expect(legalSupport?.capabilities).not.toContain("audit.view");
  });
});
