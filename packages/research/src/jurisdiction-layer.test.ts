import { describe, expect, it } from "vitest";
import { labelResearchHits, coverageStatusWarnings, COVERAGE_LIMITED_WARNING } from "./jurisdiction-layer";
import type { AuthoritySearchHit } from "./provider";
import type { MatterJurisdictionContext } from "@nyayagrid/jurisdiction";

function hit(overrides: Partial<AuthoritySearchHit>): AuthoritySearchHit {
  return {
    authorityId: "11111111-1111-1111-1111-111111111111",
    authorityVersionId: "22222222-2222-2222-2222-222222222222",
    chunkId: overrides.chunkId ?? "33333333-3333-3333-3333-333333333333",
    title: "Example",
    citation: "1 Ex. 1",
    authorityType: "case",
    jurisdiction: null,
    court: null,
    decisionDate: null,
    score: 0.5,
    snippet: "snippet",
    ...overrides,
  };
}

const paMatter: MatterJurisdictionContext = {
  matterId: "m",
  organizationId: "o",
  jurisdictionMode: "state",
  forumType: "state",
  primaryState: "PA",
  courtId: "st-pa-high",
  courtName: "Supreme Court of Pennsylvania",
  federalDistrict: null,
  federalCircuit: null,
  practiceArea: "Contract",
  asOfDate: "2026-08-19",
  governingLawState: "PA",
  choiceOfLawStatus: "none_known",
  relatedJurisdictions: [],
  source: "user_metadata",
  legacyJurisdiction: null,
  legacyCourt: null,
  coverage: "unvalidated",
  coverageByPracticeArea: true,
  choiceOfLawDistinctFromForum: false,
  summary: "PA",
  promptBlock: "",
};

describe("labelResearchHits", () => {
  it("ranks Pennsylvania high-court authority above New Jersey authority and never labels NJ controlling", () => {
    const ranked = labelResearchHits(paMatter, [
      hit({
        chunkId: "nj",
        courtId: "st-nj-high",
        authorityState: "NJ",
        score: 0.99,
      }),
      hit({
        chunkId: "pa",
        courtId: "st-pa-high",
        authorityState: "PA",
        score: 0.2,
      }),
    ]);
    expect(ranked[0]?.chunkId).toBe("pa");
    expect(ranked[0]?.hierarchyRelationship).toBe("controlling");
    expect(ranked[1]?.hierarchyRelationship).toBe("out_of_jurisdiction");
    expect(ranked.some((row) => row.hierarchyRelationship === "controlling" && row.courtId === "st-nj-high")).toBe(
      false,
    );
  });

  it("uses asOfDate to downrank an expired effective window and leaves missing dates UNKNOWN", () => {
    const ranked = labelResearchHits(paMatter, [
      hit({
        chunkId: "expired",
        courtId: "st-pa-high",
        authorityState: "PA",
        score: 0.95,
        effectiveStart: "2010-01-01",
        effectiveEnd: "2020-12-31",
      }),
      hit({
        chunkId: "current",
        courtId: "st-pa-high",
        authorityState: "PA",
        score: 0.2,
        effectiveStart: "2021-01-01",
      }),
      hit({
        chunkId: "undated",
        courtId: "st-pa-high",
        authorityState: "PA",
        score: 0.1,
        decisionDate: "2018-06-01",
      }),
    ]);
    expect(ranked[0]?.chunkId).toBe("current");
    expect(ranked[0]?.temporalApplicability).toBe("applicable");
    const expired = ranked.find((row) => row.chunkId === "expired");
    const undated = ranked.find((row) => row.chunkId === "undated");
    expect(expired?.temporalApplicability).toBe("inapplicable");
    expect(undated?.temporalApplicability).toBe("unknown");
    expect(undated?.hierarchyRelationship).toBe("controlling");
  });
});

describe("coverageStatusWarnings", () => {
  it("discloses LIMITED coverage without widening it to VALIDATED", () => {
    expect(coverageStatusWarnings("limited")).toEqual([COVERAGE_LIMITED_WARNING]);
    expect(coverageStatusWarnings("supported")).toEqual([]);
    expect(COVERAGE_LIMITED_WARNING).toMatch(/Limited authority coverage/i);
  });
});
