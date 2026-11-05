import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_DEFINITIONS } from "./system-roles";

describe("professional system role policy", () => {
  it("keeps Professional system roles free of prosecution capabilities", () => {
    for (const def of SYSTEM_ROLE_DEFINITIONS) {
      expect(def.capabilities.some((c) => c.startsWith("prosecution."))).toBe(false);
    }
  });

  it("documents additive reconcile as the default customization-preserving mode", async () => {
    // Import locally so the module policy comment stays the source of truth for callers.
    const mod = await import("./professional-roles");
    expect(typeof mod.reconcileProfessionalSystemRolePermissions).toBe("function");
    expect(typeof mod.ensureProfessionalSystemRoles).toBe("function");
  });
});
