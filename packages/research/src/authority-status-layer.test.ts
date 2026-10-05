import { describe, expect, it } from "vitest";
import { labelResearchHits } from "./jurisdiction-layer";
import type { AuthoritySearchHit } from "./provider";
import type { MatterJurisdictionContext } from "@nyayagrid/jurisdiction";

function hit(overrides: Partial<AuthoritySearchHit> & { currentnessStatus?: string }): AuthoritySearchHit {
  return {
    authorityId: overrides.authorityId ?? "11111111-1111-1111-1111-111111111111",
    authorityVersionId: "22222222-2222-2222-2222-222222222222",
    chunkId: overrides.chunkId ?? "33333333-3333-3333-3333-333333333333",
    title: "Example",
    citation: "SYNTHETIC-1",
    authorityType: "case",
    jurisdiction: "US",
    court: null,
    decisionDate: null,
    score: 0.5,
    snippet: "snippet",
    ...overrides,
  };
}

const forum: MatterJurisdictionContext = {
  matterId: "m",
  organizationId: "o",
  jurisdictionMode: "federal",
  forumType: "federal",
  primaryState: "PA",
  courtId: "us-d-pa-ed",
  courtName: "Eastern District of Pennsylvania",
  federalDistrict: "pa-ed",
  federalCircuit: "3",
  practiceArea: "Criminal",
  asOfDate: "2026-08-19",
  governingLawState: null,
  choiceOfLawStatus: "none_known",
  relatedJurisdictions: [],
  source: "user_metadata",
  legacyJurisdiction: null,
  legacyCourt: null,
  coverage: "unvalidated",
  coverageByPracticeArea: true,
  choiceOfLawDistinctFromForum: false,
  summary: "EDPA",
  promptBlock: "",
};

describe("labelResearchHits authority status", () => {
  it("abstains when the issue type is missing", () => {
    const ranked = labelResearchHits(forum, [hit({ courtId: "us-ca-3", score: 0.2 })]);
    expect(ranked[0]?.authorityStatus).toBe("UNKNOWN");
    expect(ranked[0]?.reasonCode).toBe("ISSUE_TYPE_UNKNOWN");
  });

  it("labels Third Circuit authority binding in EDPA and does not let hierarchy bury a relevant sister circuit", () => {
    const ranked = labelResearchHits(
      forum,
      [
        hit({ chunkId: "third", authorityId: "third", courtId: "us-ca-3", score: 0.2 }),
        hit({ chunkId: "second", authorityId: "second", courtId: "us-ca-2", score: 0.95 }),
      ],
      { issueType: "FEDERAL_STATUTORY", questionJurisdiction: "US", forumCourtId: "us-d-pa-ed" },
    );
    expect(ranked.find((row) => row.chunkId === "third")?.authorityStatus).toBe("BINDING");
    expect(ranked.find((row) => row.chunkId === "second")?.authorityStatus).toBe("PERSUASIVE");
    expect(ranked[0]?.chunkId).toBe("second");
  });

  it("marks unknown jurisdiction and out-of-state authority explicitly", () => {
    const unknown = labelResearchHits(
      null,
      [hit({ courtId: "us-scotus" })],
      { issueType: "STATE_LAW" },
    );
    expect(unknown[0]?.authorityStatus).toBe("UNKNOWN");
    const stateForum: MatterJurisdictionContext = { ...forum, courtId: "st-pa-trial", jurisdictionMode: "state", forumType: "state", governingLawState: "PA" };
    const ranked = labelResearchHits(
      stateForum,
      [
        hit({ chunkId: "pa", courtId: "st-pa-high", authorityState: "PA", score: 0.4 }),
        hit({ chunkId: "nj", courtId: "st-nj-high", authorityState: "NJ", score: 0.7 }),
        hit({ chunkId: "district", courtId: "us-d-pa-ed", score: 0.6 }),
        hit({ chunkId: "scotus", courtId: "us-scotus", score: 0.5 }),
      ],
      { issueType: "STATE_LAW", questionJurisdiction: "PA", forumCourtId: "st-pa-trial", subjectMatter: "criminal" },
    );
    expect(ranked.find((row) => row.chunkId === "pa")?.authorityStatus).toBe("BINDING");
    expect(ranked.find((row) => row.chunkId === "nj")?.authorityStatus).toBe("OUT_OF_JURISDICTION");
    expect(ranked.find((row) => row.chunkId === "scotus")?.authorityStatus).toBe("NONCONTROLLING");
  });
});
