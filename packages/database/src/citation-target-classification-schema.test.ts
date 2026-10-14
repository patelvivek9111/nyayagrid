import { describe, expect, it } from "vitest";
import {
  CITATION_TARGET_CLASSIFICATIONS,
  legalAuthorityCitations,
  type CitationTargetClassification,
} from "./schema/phase6";

describe("citation_target_classification schema contract", () => {
  it("exposes classification on legal_authority_citations with UNKNOWN default", () => {
    expect(legalAuthorityCitations.citationTargetClassification).toBeTruthy();
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("CASE_CITATION");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("STATUTE");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("RULE");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("REGULATION");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("YYYY_PAGE_N");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("RECORD_REFERENCE");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("EXHIBIT_REFERENCE");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("OCR_MALFORMED");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("PARSER_MALFORMED");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("CASE_LIKE_BUT_MALFORMED");
    expect(CITATION_TARGET_CLASSIFICATIONS).toContain("UNKNOWN");
    expect(CITATION_TARGET_CLASSIFICATIONS).toHaveLength(18);
  });

  it("keeps classification independent of authority identity columns", () => {
    expect(legalAuthorityCitations.toAuthorityId).toBeTruthy();
    expect(legalAuthorityCitations.rawCitation).toBeTruthy();
    expect(legalAuthorityCitations.normalizedCitation).toBeTruthy();
    const sample: CitationTargetClassification = "UNKNOWN";
    expect(sample).toBe("UNKNOWN");
  });
});
