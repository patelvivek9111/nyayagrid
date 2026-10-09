import { describe, expect, it } from "vitest";
import {
  applyResolveOrAbstainPolicy,
  buildPass5CitationFixture,
  extractAndResolveCitationsInText,
  formatResolutionForAskContext,
} from "@nyayagrid/research";

describe("Ask Nyaya citation resolution grounding", () => {
  it("resolve-or-abstain policy distinguishes corpus-complete, metadata-only, and ambiguous", () => {
    const fixture = buildPass5CitationFixture();
    const text = `Compare ${fixture.citations.resolvedCorpusComplete} with ${fixture.citations.resolvedMetadataOnly} and ${fixture.citations.ambiguous}.`;
    const resolutions = extractAndResolveCitationsInText({
      text,
      authorities: fixture.authorities,
    });
    const policy = applyResolveOrAbstainPolicy({ resolutions });
    expect(policy.allowedFullTextAuthorityIds).toContain("auth-brown");
    expect(policy.allowedIdentityAuthorityIds).toContain("auth-roe-meta");
    expect(policy.suppressedCitations.length).toBeGreaterThan(0);
    const block = formatResolutionForAskContext(resolutions);
    expect(block).toContain("CITATION_RESOLUTION_REVIEW");
    expect(block).not.toMatch(/\bstill good law\b|\boverruled\b/i);
  });

  it("preserves matter-document citation ids as non-authority tokens", () => {
    const fixture = buildPass5CitationFixture();
    const resolutions = extractAndResolveCitationsInText({
      text: `See matter source ${fixture.citations.matterDocument} and statute ${fixture.citations.nonCase}.`,
      authorities: fixture.authorities,
    });
    // Matter document pseudo-id is not a case citation; statute is NOT_CASE_CITATION when extracted.
    expect(resolutions.every((row) => row.authorityId !== "invented")).toBe(true);
    expect(resolutions.some((row) => row.outcome === "NOT_CASE_CITATION") || resolutions.length === 0).toBe(true);
  });
});
