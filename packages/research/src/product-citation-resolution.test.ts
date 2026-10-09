import { describe, expect, it } from "vitest";
import {
  applyResolveOrAbstainPolicy,
  blocksUnsupportedTreatmentMemory,
  buildPass5CitationFixture,
  canLinkAuthorityInGraph,
  extractAndResolveCitationsInText,
  memorySafeResolutionFact,
  resolveCitationsForProduct,
} from "./product-citation-resolution";

describe("product citation resolution service", () => {
  const fixture = buildPass5CitationFixture();

  it("resolves corpus-complete and metadata-only without inventing treatment", () => {
    const [complete, meta] = resolveCitationsForProduct({
      citations: [
        { rawCitation: fixture.citations.resolvedCorpusComplete },
        { rawCitation: fixture.citations.resolvedMetadataOnly },
      ],
      authorities: fixture.authorities,
    });
    expect(complete!.outcome).toBe("RESOLVED_HIGH_CONFIDENCE");
    expect(complete!.corpusComplete).toBe(true);
    expect(complete!.coverage.displayState).toBe("FULL_TEXT_AVAILABLE");
    expect(complete!.coverage.treatmentUnknown).toBe(true);

    expect(meta!.outcome).toBe("RESOLVED_HIGH_CONFIDENCE");
    expect(meta!.corpusComplete).toBe(false);
    expect(meta!.coverage.displayState).toBe("IDENTITY_VERIFIED_TEXT_NOT_IN_CORPUS");
    expect(meta!.coverage.fullOpinionTextUnavailableLocally).toBe(true);
  });

  it("exposes ambiguity and never silently chooses", () => {
    const [ambiguous] = resolveCitationsForProduct({
      citations: [{ rawCitation: fixture.citations.ambiguous }],
      authorities: fixture.authorities,
    });
    expect(ambiguous!.outcome).toBe("AMBIGUOUS");
    expect(ambiguous!.authorityId).toBeNull();
    expect(ambiguous!.ambiguityAuthorityIds.length).toBe(2);
    const policy = applyResolveOrAbstainPolicy({ resolutions: [ambiguous!] });
    expect(policy.suppressedCitations).toContain(fixture.citations.ambiguous);
    expect(policy.allowedIdentityAuthorityIds).toEqual([]);
    expect(canLinkAuthorityInGraph(ambiguous!)).toBe(false);
  });

  it("classifies non-case and malformed outside case-authority semantics", () => {
    const rows = resolveCitationsForProduct({
      citations: [
        { rawCitation: fixture.citations.nonCase },
        { rawCitation: fixture.citations.malformed },
        { rawCitation: fixture.citations.unresolved },
      ],
      authorities: fixture.authorities,
    });
    expect(rows[0]!.outcome).toBe("NOT_CASE_CITATION");
    expect(rows[1]!.outcome).toBe("MALFORMED");
    expect(rows[2]!.authorityId).toBeNull();
    expect(rows[2]!.coverage.displayState).toBe("UNRESOLVED");
  });

  it("applies resolve-or-abstain for Ask/Draft grounding", () => {
    const resolutions = resolveCitationsForProduct({
      citations: [
        { rawCitation: fixture.citations.resolvedCorpusComplete },
        { rawCitation: fixture.citations.resolvedMetadataOnly },
        { rawCitation: fixture.citations.ambiguous },
        { rawCitation: fixture.citations.unresolved },
      ],
      authorities: fixture.authorities,
    });
    const policy = applyResolveOrAbstainPolicy({ resolutions });
    expect(policy.allowedFullTextAuthorityIds).toContain("auth-brown");
    expect(policy.allowedIdentityAuthorityIds).toContain("auth-roe-meta");
    expect(policy.suppressedCitations).toEqual(
      expect.arrayContaining([fixture.citations.ambiguous, fixture.citations.unresolved]),
    );
    expect(policy.qualifications.some((row) => /full opinion text is not yet available/i.test(row))).toBe(
      true,
    );
  });

  it("allows memory resolution facts and blocks unsupported treatment conclusions", () => {
    const [resolved] = resolveCitationsForProduct({
      citations: [{ rawCitation: fixture.citations.resolvedMetadataOnly }],
      authorities: fixture.authorities,
    });
    const fact = memorySafeResolutionFact(resolved!);
    expect(fact.allowed).toBe(true);
    expect(fact.fact).toMatch(/resolved to authority/);
    expect(blocksUnsupportedTreatmentMemory("This case is still good law.")).toBe(true);
    expect(blocksUnsupportedTreatmentMemory(fact.fact!)).toBe(false);
  });

  it("extracts and batch-resolves citations from prose without fabricating authorities", () => {
    const text = `See ${fixture.citations.resolvedCorpusComplete} and ${fixture.citations.ambiguous}.`;
    const resolutions = extractAndResolveCitationsInText({
      text,
      authorities: fixture.authorities,
    });
    expect(resolutions.length).toBeGreaterThanOrEqual(1);
    expect(resolutions.every((row) => row.authorityId !== "invented")).toBe(true);
    expect(resolutions.some((row) => row.outcome === "AMBIGUOUS" || row.authorityId === "auth-brown")).toBe(
      true,
    );
  });

  it("resolves many citations quickly against a shared index snapshot", () => {
    const citations = Array.from({ length: 40 }, (_, index) => ({
      rawCitation: index % 2 === 0 ? fixture.citations.resolvedCorpusComplete : fixture.citations.resolvedMetadataOnly,
    }));
    const started = Date.now();
    const resolutions = resolveCitationsForProduct({
      citations,
      authorities: fixture.authorities,
    });
    const elapsed = Date.now() - started;
    expect(resolutions).toHaveLength(40);
    expect(elapsed).toBeLessThan(500);
  });
});
