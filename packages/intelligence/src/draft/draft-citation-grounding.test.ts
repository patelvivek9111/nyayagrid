import { describe, expect, it } from "vitest";
import { buildPass5CitationFixture, resolveCitationsForProduct } from "@nyayagrid/research";
import { applyDraftCitationResolveOrAbstain } from "./helpers";

describe("draft citation resolve-or-abstain", () => {
  it("flags ambiguous and unresolved legal citations without inventing substitutes", () => {
    const fixture = buildPass5CitationFixture();
    const resolutions = resolveCitationsForProduct({
      citations: [
        { rawCitation: fixture.citations.ambiguous },
        { rawCitation: fixture.citations.unresolved },
        { rawCitation: fixture.citations.resolvedCorpusComplete },
      ],
      authorities: fixture.authorities,
    });
    const grounded = applyDraftCitationResolveOrAbstain({
      content: `Rely on ${fixture.citations.ambiguous}.`,
      assumptions: [],
      resolutions,
    });
    expect(grounded.suppressedCitations).toEqual(
      expect.arrayContaining([fixture.citations.ambiguous, fixture.citations.unresolved]),
    );
    expect(grounded.content).toMatch(/Attorney review required/i);
    expect(grounded.assumptions.some((row) => /not yet available in the local corpus|Treatment/i.test(row))).toBe(
      true,
    );
  });
});
