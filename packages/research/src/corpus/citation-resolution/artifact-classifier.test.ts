import { describe, expect, it } from "vitest";
import { classifyCitationArtifact } from "./artifact-classifier.js";

describe("artifact-classifier", () => {
  it("classifies statutes", () => {
    expect(classifyCitationArtifact("42 U.S.C. § 1983").category).toBe("STATUTE");
  });

  it("classifies rules", () => {
    expect(classifyCitationArtifact("Fed. R. Civ. P. 56").category).toBe("RULE");
  });

  it("classifies regulations", () => {
    expect(classifyCitationArtifact("21 C.F.R. § 314.80").category).toBe("REGULATION");
  });

  it("classifies bare / pin pages", () => {
    expect(classifyCitationArtifact("at 321").category).toBe("PIN_CITE_ONLY");
    expect(classifyCitationArtifact("2026 Page 2").category).toBe("YYYY_PAGE_N");
  });

  it("classifies exhibit and docket references", () => {
    expect(classifyCitationArtifact("Ex. 14").category).toBe("EXHIBIT_REFERENCE");
    expect(classifyCitationArtifact("ECF No. 12").category).toBe("DOCKET_REFERENCE");
  });

  it("classifies OCR malformations", () => {
    expect(classifyCitationArtifact("814 U.S. 726").category).toBe("OCR_MALFORMED");
  });

  it("does not classify real case cites as artifacts", () => {
    const r = classifyCitationArtifact("573 U.S. 373");
    expect(r.category).toBe("NOT_ARTIFACT_CASE_LIKE");
    expect(r.eligibleForCaseLookup).toBe(true);
  });

  it("keeps F.4th case-like", () => {
    expect(classifyCitationArtifact("175 F.4th 34").category).toBe("NOT_ARTIFACT_CASE_LIKE");
  });
});
