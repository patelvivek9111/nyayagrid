import { describe, expect, it } from "vitest";
import {
  applyMatterJurisdictionInput,
  classifyAuthorityRelationship,
  defaultCoverageStatus,
  deriveCircuitFromCourtId,
  formatJurisdictionSummary,
  formatJurisdictionDisclosure,
  formatJurisdictionRoleDisclosure,
  ensureLimitedCoverageDisclosure,
  ensureUnvalidatedCoverageDisclosure,
  InvalidJurisdictionError,
  isAuthorityTemporallyApplicable,
  isCertifiedCoverageLabel,
  listCourts,
  listUsStates,
  normalizeCourtId,
  normalizeStateCode,
  rankAuthoritiesForMatter,
  shouldAbstainForUnknownJurisdiction,
  relationshipRank,
  temporalRank,
} from "./index";

function matter(
  overrides: Partial<Parameters<typeof rankAuthoritiesForMatter>[0]> = {},
) {
  return {
    jurisdictionMode: "state" as const,
    forumType: "state" as const,
    primaryState: "PA",
    governingLawState: null,
    federalCircuit: null,
    relatedJurisdictions: [],
    courtId: null,
    asOfDate: null,
    ...overrides,
  };
}

describe("state and court normalization", () => {
  it("maps all 50 states plus DC by code and name", () => {
    expect(listUsStates()).toHaveLength(51);
    expect(normalizeStateCode("Pennsylvania")).toBe("PA");
    expect(normalizeStateCode("pa")).toBe("PA");
    expect(normalizeStateCode("District of Columbia")).toBe("DC");
  });

  it("maps EDPA aliases to one court and derives the Third Circuit", () => {
    const id = normalizeCourtId("E.D. Pa.");
    expect(id).toBe("us-d-pa-ed");
    expect(normalizeCourtId("EDPA")).toBe("us-d-pa-ed");
    expect(normalizeCourtId("U.S. District Court for the Eastern District of Pennsylvania")).toBe(
      "us-d-pa-ed",
    );
    expect(deriveCircuitFromCourtId("us-d-pa-ed")).toBe("3");
  });

  it("lists PA federal districts without requiring a circuit pick", () => {
    const courts = listCourts({ state: "PA", forumType: "federal" });
    expect(courts.map((court) => court.id).sort()).toEqual([
      "us-d-pa-ed",
      "us-d-pa-md",
      "us-d-pa-wd",
    ]);
  });

  it("does not uniquely map an ambiguous court string", () => {
    expect(normalizeCourtId("Supreme Court")).toBeNull();
  });
});

describe("forum vs governing law", () => {
  it("does not promote forum state to governing law", () => {
    const normalized = applyMatterJurisdictionInput({
      primaryState: "PA",
      forumType: "state",
    });
    expect(normalized.primaryState).toBe("PA");
    expect(normalized.governingLawState).toBeNull();
    expect(normalized.choiceOfLawStatus).toBe("none_known");
    expect(normalized.jurisdictionMode).toBe("state");
  });

  it("keeps Delaware choice of law distinct from an E.D. Pa. forum", () => {
    const normalized = applyMatterJurisdictionInput({
      courtId: "us-d-pa-ed",
      governingLawState: "DE",
      choiceOfLawStatus: "stated",
      relatedJurisdictions: [{ stateCode: "NJ" }],
      practiceArea: "Employment",
    });
    expect(normalized.primaryState).toBe("PA");
    expect(normalized.federalCircuit).toBe("3");
    expect(normalized.forumType).toBe("federal");
    expect(normalized.governingLawState).toBe("DE");
    expect(normalized.jurisdictionMode).toBe("multi_jurisdiction");
    expect(normalized.relatedJurisdictions).toEqual([{ stateCode: "NJ", courtId: null }]);
  });

  it("rejects a Ninth Circuit override on E.D. Pennsylvania", () => {
    expect(() =>
      applyMatterJurisdictionInput({
        courtId: "us-d-pa-ed",
        federalCircuit: "9",
      }),
    ).toThrow(InvalidJurisdictionError);
  });

  it("defaults as-of date to today without inventing jurisdiction", () => {
    const normalized = applyMatterJurisdictionInput({});
    expect(normalized.jurisdictionMode).toBe("unknown");
    expect(normalized.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(normalized.primaryState).toBeNull();
  });

  it("does not invent an as-of date when patching existing metadata", () => {
    const patched = applyMatterJurisdictionInput({ practiceArea: "Employment" }, {
      jurisdictionMode: "state",
      primaryState: "PA",
      asOfDate: null,
      choiceOfLawStatus: "none_known",
    });
    expect(patched.asOfDate).toBeNull();
    expect(patched.primaryState).toBe("PA");
  });
});

describe("authority relationship", () => {
  it("never labels New Jersey high-court authority controlling Pennsylvania law", () => {
    const result = classifyAuthorityRelationship(matter({}), {
      authorityType: "case",
      courtId: "st-nj-high",
      authorityState: "NJ",
    });
    expect(result.relationship).not.toBe("controlling");
    expect(result.relationship).toBe("out_of_jurisdiction");
  });

  it("does not label an unrecognized other-state statute controlling in a named-state case", () => {
    expect(
      classifyAuthorityRelationship(matter({}), {
        authorityType: "statute",
        jurisdiction: "Other State",
      }).relationship,
    ).toBe("out_of_jurisdiction");
  });

  it("does not upgrade semantically relevant out-of-state enacted law for NY/NJ, TX/CA, or PA/DE/OH", () => {
    expect(
      classifyAuthorityRelationship(matter({ primaryState: "NY", governingLawState: "NY" }), {
        authorityType: "statute",
        jurisdiction: "New Jersey",
      }).relationship,
    ).toBe("out_of_jurisdiction");
    expect(
      classifyAuthorityRelationship(matter({ primaryState: "TX", governingLawState: "TX" }), {
        authorityType: "statute",
        jurisdiction: "California",
      }).relationship,
    ).toBe("out_of_jurisdiction");
    expect(
      classifyAuthorityRelationship(
        matter({
          primaryState: "PA",
          governingLawState: "DE",
          relatedJurisdictions: [{ stateCode: "PA" }],
        }),
        { authorityType: "statute", jurisdiction: "Ohio" },
      ).relationship,
    ).toBe("out_of_jurisdiction");
  });

  it("labels the applicable circuit controlling and other circuits persuasive", () => {
    const ctx = matter({
      jurisdictionMode: "federal",
      forumType: "federal",
      courtId: "us-d-pa-ed",
      federalCircuit: "3",
    });
    expect(
      classifyAuthorityRelationship(ctx, { authorityType: "case", courtId: "us-ca-3" }).relationship,
    ).toBe("controlling");
    expect(
      classifyAuthorityRelationship(ctx, { authorityType: "case", courtId: "us-ca-9" }).relationship,
    ).toBe("persuasive");
  });

  it("labels U.S. Supreme Court controlling", () => {
    expect(
      classifyAuthorityRelationship(matter({ forumType: "federal", jurisdictionMode: "federal" }), {
        courtId: "us-scotus",
      }).relationship,
    ).toBe("controlling");
  });

  it("does not treat same-state trial courts as controlling", () => {
    expect(
      classifyAuthorityRelationship(matter({}), {
        authorityType: "case",
        courtId: "st-pa-trial",
      }).relationship,
    ).toBe("persuasive");
  });

  it("returns unknown rather than guessing when Case jurisdiction is unknown", () => {
    expect(
      classifyAuthorityRelationship(
        matter({
          jurisdictionMode: "unknown",
          forumType: null,
          primaryState: null,
          governingLawState: null,
        }),
        { courtId: "st-pa-high" },
      ).relationship,
    ).toBe("unknown");
  });

  it("ranks same-jurisdiction high-court authority above out-of-state authority", () => {
    const ranked = rankAuthoritiesForMatter(matter({ governingLawState: "PA" }), [
      { courtId: "st-nj-high", authorityState: "NJ" },
      { courtId: "st-pa-high", authorityState: "PA" },
    ]);
    expect(ranked[0]?.courtId).toBe("st-pa-high");
    expect(ranked[0]?.hierarchyRelationship).toBe("controlling");
    expect(ranked[1]?.hierarchyRelationship).toBe("out_of_jurisdiction");
    expect(relationshipRank("controlling")).toBeGreaterThan(relationshipRank("persuasive"));
  });

  it("ranks currently effective same-jurisdiction authority above an expired window", () => {
    const ranked = rankAuthoritiesForMatter(
      matter({ governingLawState: "PA", asOfDate: "2026-08-19" }),
      [
        {
          courtId: "st-pa-high",
          authorityState: "PA",
          effectiveStart: "2010-01-01",
          effectiveEnd: "2020-12-31",
        },
        {
          courtId: "st-pa-high",
          authorityState: "PA",
          effectiveStart: "2021-01-01",
        },
      ],
    );
    expect(ranked[0]?.temporalApplicability).toBe("applicable");
    expect(ranked[1]?.temporalApplicability).toBe("inapplicable");
    expect(ranked[0]?.rankingScore).toBeGreaterThan(ranked[1]?.rankingScore ?? 0);
    expect(temporalRank("unknown")).toBe(0);
    expect(temporalRank("inapplicable")).toBeLessThan(temporalRank("unknown"));
  });
});

describe("temporal, coverage, abstention, summary", () => {
  it("returns UNKNOWN when effective dates are missing", () => {
    expect(
      isAuthorityTemporallyApplicable({ decisionDate: "2020-01-01" }, "2026-08-19"),
    ).toBe("unknown");
    expect(
      isAuthorityTemporallyApplicable(
        { effectiveStart: "2025-01-01", effectiveEnd: "2025-12-31" },
        "2026-08-19",
      ),
    ).toBe("inapplicable");
  });

  it("defaults coverage to UNVALIDATED and does not treat that as certified", () => {
    expect(defaultCoverageStatus()).toBe("unvalidated");
    expect(isCertifiedCoverageLabel("unvalidated")).toBe(false);
    expect(isCertifiedCoverageLabel("supported")).toBe(true);
  });

  it("abstains on statute-of-limitations questions when jurisdiction is unknown", () => {
    expect(
      shouldAbstainForUnknownJurisdiction("What is the statute of limitations?", {
        matterId: "m",
        organizationId: "o",
        jurisdictionMode: "unknown",
        forumType: null,
        primaryState: null,
        courtId: null,
        courtName: null,
        federalDistrict: null,
        federalCircuit: null,
        practiceArea: null,
        asOfDate: "2026-08-19",
        governingLawState: null,
        choiceOfLawStatus: "unknown",
        relatedJurisdictions: [],
        source: "legacy_unstructured",
        legacyJurisdiction: null,
        legacyCourt: null,
        coverage: "unvalidated",
        coverageByPracticeArea: false,
        choiceOfLawDistinctFromForum: false,
        summary: "Jurisdiction not set",
        promptBlock: "",
      }),
    ).toBe(true);
  });

  it("formats partial summaries without inventing missing courts", () => {
    expect(
      formatJurisdictionSummary({
        jurisdictionMode: "state",
        primaryState: "PA",
        forumType: "state",
        courtName: null,
        courtId: null,
        federalCircuit: null,
        practiceArea: null,
        governingLawState: null,
      }),
    ).toBe("PA · Court not set");
    expect(
      formatJurisdictionSummary({
        jurisdictionMode: "unknown",
        primaryState: null,
        forumType: null,
        courtName: null,
        courtId: null,
        federalCircuit: null,
        practiceArea: null,
        governingLawState: null,
      }),
    ).toBe("Jurisdiction not set");
    expect(
      formatJurisdictionSummary({
        jurisdictionMode: "federal",
        primaryState: "PA",
        forumType: "federal",
        courtName: "Eastern District of Pennsylvania",
        courtId: "us-d-pa-ed",
        federalCircuit: "3",
        practiceArea: "Employment",
        governingLawState: null,
      }),
    ).toBe("PA · Eastern District of Pennsylvania · Federal · Employment");
  });

  it("names forum and governing law for an unseen TX/NY split without treating related Ohio as law", () => {
    const disclosure = formatJurisdictionRoleDisclosure({
      primaryState: "TX",
      governingLawState: "NY",
      relatedJurisdictions: [{ stateCode: "OH" }],
    });
    expect(disclosure).toMatch(/Forum: Texas/);
    expect(disclosure).toMatch(/Governing law: New York/);
    expect(disclosure).toMatch(/Related jurisdiction: Ohio/);
    expect(disclosure).toMatch(/not the forum/);
    expect(formatJurisdictionDisclosure({
      matterId: "m",
      organizationId: "o",
      jurisdictionMode: "state",
      forumType: "state",
      primaryState: "TX",
      courtId: null,
      courtName: null,
      federalDistrict: null,
      federalCircuit: null,
      practiceArea: "Contract",
      asOfDate: null,
      governingLawState: "NY",
      choiceOfLawStatus: "stated",
      relatedJurisdictions: [{ stateCode: "OH" }],
      source: "user_metadata",
      legacyJurisdiction: null,
      legacyCourt: null,
      coverage: "limited",
      coverageByPracticeArea: false,
      choiceOfLawDistinctFromForum: true,
      summary: "NY law · TX forum",
      promptBlock: "",
    })).toMatch(/Forum: Texas/);
  });

  it("appends a coverage limitation only for UNVALIDATED answers", () => {
    expect(ensureUnvalidatedCoverageDisclosure("Ohio wage rule from the imported statute.", "supported")).toBe(
      "Ohio wage rule from the imported statute.",
    );
    const limited = ensureUnvalidatedCoverageDisclosure("No imported burglary statute.", "unvalidated");
    expect(limited).toMatch(/Coverage is UNVALIDATED/i);
    expect(limited).toMatch(/Coverage is not yet validated/i);
    expect(limited).toMatch(/does not change that recorded status/i);
    expect(ensureUnvalidatedCoverageDisclosure(limited, "unvalidated")).toBe(limited);
    const limitedCoverage = ensureLimitedCoverageDisclosure("Four years under the imported excerpt.", "limited");
    expect(limitedCoverage).toMatch(/Limited authority coverage/i);
    expect(ensureLimitedCoverageDisclosure(limitedCoverage, "limited")).toBe(limitedCoverage);
    expect(ensureLimitedCoverageDisclosure("Already limited coverage noted.", "limited")).toBe(
      "Already limited coverage noted.",
    );
  });
});
