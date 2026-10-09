import { describe, expect, it } from "vitest";
import {
  RESOLVER_VERSION,
  classifyCaseCitationLookupEligibility,
  resolveCitationForProduct,
  type AuthorityIndexRow,
} from "./citation-resolution-contract";

function authority(partial: Partial<AuthorityIndexRow> & { id: string }): AuthorityIndexRow {
  return {
    citation: null,
    normalizedCitation: null,
    corpusComplete: false,
    ...partial,
  };
}

describe("product citation-resolution contract", () => {
  it("resolves local exact without implying corpus completeness", () => {
    const result = resolveCitationForProduct({
      rawCitation: "410 U.S. 113",
      authorities: [
        authority({
          id: "roe",
          citation: "410 U.S. 113",
          normalizedCitation: "410 U.S. 113",
          corpusComplete: false,
          ingestionStatus: "metadata_only",
        }),
      ],
    });
    expect(result.outcome).toBe("RESOLVED_HIGH_CONFIDENCE");
    expect(result.authorityId).toBe("roe");
    expect(result.authorityState).toBe("AUTHORITY_RESOLVED");
    expect(result.corpusComplete).toBe(false);
    expect(result.resolverVersion).toBe(RESOLVER_VERSION);
  });

  it("returns explicit AMBIGUOUS and never picks a winner", () => {
    const result = resolveCitationForProduct({
      rawCitation: "123 F.3d 456",
      authorities: [
        authority({ id: "a", citation: "123 F.3d 456", normalizedCitation: "123 F.3d 456" }),
        authority({ id: "b", citation: "123 F.3d 456", normalizedCitation: "123 F.3d 456" }),
      ],
    });
    expect(result.outcome).toBe("AMBIGUOUS");
    expect(result.authorityId).toBeNull();
    expect(result.ambiguityAuthorityIds.sort()).toEqual(["a", "b"]);
  });

  it("classifies YYYY Page N and statutes out of case-identity lane", () => {
    expect(classifyCaseCitationLookupEligibility("2026 Page 2").eligible).toBe(false);
    expect(classifyCaseCitationLookupEligibility("2026 Page 2").lane).toBe("MALFORMED_CASE_REFERENCE");
    const statute = resolveCitationForProduct({
      rawCitation: "42 U.S.C. § 1983",
      authorities: [],
    });
    expect(statute.outcome).toBe("NOT_CASE_CITATION");
  });

  it("marks CORPUS_COMPLETE only when corpusComplete flag is true", () => {
    const result = resolveCitationForProduct({
      rawCitation: "347 U.S. 483",
      authorities: [
        authority({
          id: "brown",
          citation: "347 U.S. 483",
          normalizedCitation: "347 U.S. 483",
          corpusComplete: true,
          ingestionStatus: "ready",
        }),
      ],
    });
    expect(result.authorityState).toBe("CORPUS_COMPLETE");
    expect(result.corpusComplete).toBe(true);
  });
});
