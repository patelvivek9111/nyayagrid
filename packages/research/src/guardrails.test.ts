import { describe, expect, it } from "vitest";
import { validateQuoteAgainstText, validateQuoteCandidates } from "./quotes";
import { classifyAuthorityWeight } from "./weight";
import {
  TREATMENT_UNVERIFIED_NOTICE,
  assertTreatmentClaimIsSourced,
  getTreatmentDisplay,
  rewriteUnsourcedEditorialTreatment,
} from "./treatment";
import {
  SYNTHETIC_FABRICATED_QUOTE,
  SYNTHETIC_VALID_QUOTE,
  syntheticStatuteAuthority,
} from "./fixtures";

describe("validateQuoteAgainstText", () => {
  const source = syntheticStatuteAuthority.content;

  it("accepts a verbatim quote and tolerates whitespace and typography differences", () => {
    expect(validateQuoteAgainstText(SYNTHETIC_VALID_QUOTE, source).valid).toBe(true);
    expect(
      validateQuoteAgainstText(`  “${SYNTHETIC_VALID_QUOTE.replace(/ /g, "   ")}”  `, source).valid,
    ).toBe(true);
  });

  it("rejects fabricated and unverifiable quotes", () => {
    expect(validateQuoteAgainstText(SYNTHETIC_FABRICATED_QUOTE, source)).toMatchObject({
      valid: false,
    });
    expect(validateQuoteAgainstText("harm", source).valid).toBe(false);
    expect(validateQuoteAgainstText(SYNTHETIC_VALID_QUOTE, "").valid).toBe(false);
  });

  it("splits candidates into accepted and rejected by chunk source", () => {
    const result = validateQuoteCandidates(
      [
        { quote: SYNTHETIC_VALID_QUOTE, chunkId: "chunk-1" },
        { quote: SYNTHETIC_FABRICATED_QUOTE, chunkId: "chunk-1" },
        { quote: SYNTHETIC_VALID_QUOTE, chunkId: "missing" },
      ],
      new Map([["chunk-1", source]]),
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(2);
  });
});

describe("classifyAuthorityWeight", () => {
  it("only reaches potentially_binding with matching jurisdiction and a court", () => {
    expect(
      classifyAuthorityWeight({
        authorityJurisdiction: "Synthetic Federal",
        authorityCourt: "Synthetic Court of Appeals",
        queryJurisdiction: "synthetic federal",
      }).label,
    ).toBe("potentially_binding");
  });

  it("falls back to unknown when metadata is missing or a court is a placeholder", () => {
    expect(
      classifyAuthorityWeight({
        authorityJurisdiction: "Synthetic Federal",
        queryJurisdiction: "Synthetic Federal",
      }).label,
    ).toBe("unknown");
    expect(
      classifyAuthorityWeight({
        authorityJurisdiction: "Synthetic Federal",
        authorityCourt: "unknown",
        queryJurisdiction: "Synthetic Federal",
      }).label,
    ).toBe("unknown");
    expect(classifyAuthorityWeight({ authorityCourt: "Some Court" }).label).toBe("unknown");
  });

  it("labels other jurisdictions persuasive", () => {
    expect(
      classifyAuthorityWeight({
        authorityJurisdiction: "Other Jurisdiction",
        authorityCourt: "Some Court",
        queryJurisdiction: "Synthetic Federal",
      }).label,
    ).toBe("persuasive");
  });
});

describe("getTreatmentDisplay", () => {
  it("always warns that treatment is unverified without source-reported data", () => {
    expect(getTreatmentDisplay({ treatmentStatus: "unknown" }).notes).toContain(
      TREATMENT_UNVERIFIED_NOTICE,
    );
    expect(
      getTreatmentDisplay({ treatmentStatus: "source_reported", relationships: [] }).notes,
    ).toContain(TREATMENT_UNVERIFIED_NOTICE);
    expect(
      getTreatmentDisplay({
        treatmentStatus: "source_reported",
        relationships: [{ relationshipType: "supersedes", origin: "parsed" }],
      }).status,
    ).toBe("unknown");
  });

  it("passes through source-reported relationships without editorializing", () => {
    const display = getTreatmentDisplay({
      treatmentStatus: "source_reported",
      sourceProvider: "synthetic-fixtures",
      relationships: [
        { relationshipType: "supersedes", origin: "source_metadata", label: "superseded by" },
      ],
    });
    expect(display.status).toBe("source_reported");
    expect(display.notes).not.toContain(TREATMENT_UNVERIFIED_NOTICE);
    expect(display.reportedRelationships).toHaveLength(1);
  });

  it("blocks editorial treatment conclusions that no source reported", () => {
    expect(() => assertTreatmentClaimIsSourced("This decision was overruled", false)).toThrow();
    expect(() => assertTreatmentClaimIsSourced("This decision was overruled", true)).not.toThrow();
  });

  it("rewrites unsourced good-law and overruling claims without using original R009 wording", () => {
    const rewritten = rewriteUnsourcedEditorialTreatment(
      "Has Northgate v. Harbor been overruled, and is it still good law?",
    );
    expect(rewritten.toLowerCase()).not.toMatch(/\bis still good law\b/);
    expect(rewritten.toLowerCase()).not.toMatch(/\bwas overruled\b/);
    expect(rewritten.toLowerCase()).not.toMatch(/\bhas been overruled\b/);
  });
});
