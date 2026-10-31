import { describe, expect, it } from "vitest";
import {
  assertHumanFinalLegalAction,
  assertPersistedAuthorityGrounded,
  assertSafeLegalWorkflowCopy,
  buildDraftSourcePackage,
  buildHearingPrepView,
  buildSuppressionAnalysisSections,
  classifyDraftCitationMarker,
  comparePleaOffers,
  dateDisplayLabel,
  formatProsecutionLegalWorkflowAskContext,
  normalizeMotionType,
  suggestLegalWorkflowTasks,
} from "./legal-workflow";
import { ProsecutionError } from "./domain";

describe("prosecution legal workflow Stage 5", () => {
  it("normalizes motion types without inventing jurisdiction-specific taxonomy", () => {
    expect(normalizeMotionType("suppress")).toBe("MOTION_TO_SUPPRESS");
    expect(normalizeMotionType("MOTION_IN_LIMINE")).toBe("MOTION_IN_LIMINE");
    expect(normalizeMotionType("custom_local_motion")).toBe("custom_local_motion");
  });

  it("separates suppression analysis sections and never emits automated conclusions", () => {
    const sections = buildSuppressionAnalysisSections({
      knownFacts: ["Affidavit lists a phone number"],
      missingFacts: ["Affiant observation source"],
      legalStandard: "Probable cause under the Fourth Amendment (for review)",
      supportingAuthority: [
        {
          citation: "Synthetic Auth. 1",
          proposition: "Source-backed proposition",
          hierarchyStatus: "BINDING",
        },
      ],
      contraryAuthority: [
        {
          citation: "Synthetic Auth. 2",
          proposition: "Contrary proposition",
          hierarchyStatus: "PERSUASIVE",
        },
      ],
      humanConclusion: null,
    });
    expect(sections.factsFromRecord).toContain("Affidavit lists a phone number");
    expect(sections.missingFacts).toHaveLength(1);
    expect(sections.supportingAuthority).toHaveLength(1);
    expect(sections.contraryAuthority).toHaveLength(1);
    expect(sections.suppressionConclusion).toBeNull();
    expect(sections.validityConclusion).toBeNull();
    expect(sections.probableCauseConclusion).toBeNull();
  });

  it("rejects automated suppression / plea / filing language", () => {
    expect(() => assertSafeLegalWorkflowCopy("suppression required")).toThrow(ProsecutionError);
    expect(() => assertSafeLegalWorkflowCopy("must accept the plea")).toThrow(ProsecutionError);
    expect(() => assertSafeLegalWorkflowCopy("warrant invalid")).toThrow(ProsecutionError);
    expect(() => assertSafeLegalWorkflowCopy("Potential issue requiring review")).not.toThrow();
  });

  it("blocks autonomous filing and subpoena issuance; requires review for final conclusions", () => {
    expect(() =>
      assertHumanFinalLegalAction({
        action: "filing",
        hasReviewCapability: true,
        humanActor: true,
      }),
    ).toThrow(/does not file/i);
    expect(() =>
      assertHumanFinalLegalAction({
        action: "subpoena_issuance",
        hasReviewCapability: true,
        humanActor: true,
      }),
    ).toThrow(/does not .*subpoena/i);
    expect(() =>
      assertHumanFinalLegalAction({
        action: "suppression_conclusion",
        hasReviewCapability: false,
        humanActor: true,
      }),
    ).toThrow(/prosecution\.review/i);
    expect(() =>
      assertHumanFinalLegalAction({
        action: "plea_decision",
        hasReviewCapability: false,
        humanActor: true,
      }),
    ).toThrow(/prosecution\.review/i);
  });

  it("compares plea offers without recommendations or scores", () => {
    const comparison = comparePleaOffers(
      {
        id: "p1",
        versionLabel: "v1",
        terms: "Count 1 reduced; probation",
        conditions: ["community service"],
        relatedChargeIds: ["c1"],
        status: "offered",
        offerDate: "2026-01-01",
        expiration: null,
        defenseResponse: null,
        prosecutorNotes: null,
      },
      {
        id: "p2",
        versionLabel: "v2",
        terms: "Count 1 reduced; probation plus fine",
        conditions: ["community service", "fine"],
        relatedChargeIds: ["c1", "c2"],
        status: "offered",
        offerDate: "2026-02-01",
        expiration: null,
        defenseResponse: null,
        prosecutorNotes: null,
      },
    );
    expect(comparison.changedTerms).toBe(true);
    expect(comparison.addedConditions).toEqual(["fine"]);
    expect(comparison.chargeSetChanged).toBe(true);
    expect(comparison.pleaRecommendation).toBeNull();
    expect(comparison.acceptRejectRecommendation).toBeNull();
    expect(comparison.pleaValueScore).toBeNull();
    expect(comparison.convictionProbability).toBeNull();
    expect(comparison.missingInformation.some((row) => /expiration/i.test(row))).toBe(true);
  });

  it("builds hearing prep without inventing dates or final argument strategy", () => {
    const prep = buildHearingPrepView({
      hearingId: "h1",
      hearingType: "suppression",
      dateTime: null,
      issuesToAddress: ["WARRANT: particularity"],
      unresolvedGaps: ["missing return inventory"],
    });
    expect(prep.dateSource).toBe("UNKNOWN_NOT_PROVIDED");
    expect(prep.argumentStrategyFinal).toBeNull();
    expect(dateDisplayLabel(null)).toBe("UNKNOWN / NOT PROVIDED");
  });

  it("requires grounded authority before persistence", () => {
    expect(() =>
      assertPersistedAuthorityGrounded({
        citation: "Synthetic v. Demo",
        proposition: "Source proposition",
        hierarchyStatus: "BINDING",
        provenance: { extractionOrigin: "deterministic_fixture" },
      }),
    ).toThrow(/SOURCE_INSUFFICIENT|source/i);
    expect(() =>
      assertPersistedAuthorityGrounded({
        citation: "Synthetic v. Demo",
        proposition: "Source proposition",
        hierarchyStatus: "BINDING",
        sourceSpan: "page 12 synthetic span",
        provenance: { extractionOrigin: "deterministic_fixture", sourceSpan: "page 12" },
      }),
    ).not.toThrow();
  });

  it("marks draft citations retrieved or unresolved/unverified", () => {
    expect(
      classifyDraftCitationMarker({
        citationText: "Synthetic v. Demo",
        retrievedAuthorityIds: ["a1"],
        matchedAuthorityId: "a1",
      }),
    ).toBe("RETRIEVED");
    expect(
      classifyDraftCitationMarker({
        citationText: "Unknown Case",
        retrievedAuthorityIds: ["a1"],
      }),
    ).toBe("UNRESOLVED_UNVERIFIED");
  });

  it("keeps drafts as DRAFT with no autonomous filing", () => {
    const pack = buildDraftSourcePackage({
      caseId: "case-1",
      approvedFacts: ["fact"],
      authorityIds: ["a1"],
      motionIds: ["m1"],
    });
    expect(pack.status).toBe("DRAFT");
    expect(pack.autonomousFiling).toBe(false);
  });

  it("formats Ask context distinguishing candidates from conclusions", () => {
    const text = formatProsecutionLegalWorkflowAskContext({
      openProcedureIssues: 1,
      unresolvedSuppressionIssues: 1,
      motions: [{ id: "m1", motionType: "MOTION_TO_SUPPRESS", status: "filed" }],
      hearings: [{ id: "h1", hearingType: "suppression", dateTime: null }],
      subpoenas: [{ id: "s1", recipient: "Lab", status: "prepared", returnStatus: "PENDING" }],
      pleas: [{ id: "p1", versionLabel: "v1", status: "offered" }],
      authorities: [
        { id: "a1", citation: "Synthetic Auth", hierarchyStatus: "BINDING", relation: "RELEVANT" },
      ],
      drafts: [{ id: "d1", title: "Motion outline", status: "DRAFT" }],
    });
    expect(text).toContain("SUPPRESSION_CONCLUSION: null");
    expect(text).toContain("PLEA_RECOMMENDATION: null");
    expect(text).toContain("AUTONOMOUS_FILING: false");
    expect(text).toContain("UNKNOWN / NOT PROVIDED");
    expect(
      suggestLegalWorkflowTasks({
        openProcedureIssues: 1,
        motionsNeedingResponse: 1,
        hearingsWithoutPrep: 0,
        pendingSubpoenaReturns: 1,
        pleaVersions: 2,
        researchOpen: 1,
      }).length,
    ).toBeGreaterThan(0);
  });
});
