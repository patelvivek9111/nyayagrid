import { describe, expect, it } from "vitest";
import {
  citationsLikelySameAuthority,
  preferredAuthorityType,
  resolveTypeCollision,
  TYPE_COLLISION_POLICY_VERSION,
} from "./authority-type-policy";

describe("authority-type collision policy", () => {
  it("treats NY CPLR as statute, not court rule", () => {
    expect(preferredAuthorityType("N.Y. C.P.L.R. 3211")).toBe("statute");
    expect(preferredAuthorityType("N.Y. CPLR 3211")).toBe("statute");
  });

  it("collapses CPLR punctuation variants as same authority", () => {
    expect(citationsLikelySameAuthority("N.Y. C.P.L.R. 3211", "N.Y. CPLR 3211")).toBe(true);
  });

  it("prefers statute type when CPLR is labeled both statute and rule", () => {
    const r = resolveTypeCollision({
      citationA: "N.Y. CPLR 3211",
      typeA: "statute",
      citationB: "N.Y. C.P.L.R. 3211",
      typeB: "rule",
    });
    expect(r.decision).toBe("prefer_canonical_type");
    expect(r.preferredType).toBe("statute");
  });

  it("keeps distinct rule numbers separate", () => {
    const r = resolveTypeCollision({
      citationA: "Ala. R. Civ. P. 12",
      typeA: "rule",
      citationB: "Ala. R. Civ. P. 56",
      typeB: "rule",
    });
    expect(r.decision).toBe("keep_both_distinct");
  });

  it("exports a stable policy version", () => {
    expect(TYPE_COLLISION_POLICY_VERSION).toMatch(/^wave2i/);
  });
});
