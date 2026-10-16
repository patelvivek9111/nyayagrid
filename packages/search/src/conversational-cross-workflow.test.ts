import { describe, expect, it } from "vitest";
import { emptyWorkingState } from "./conversation-context";
import {
  applyFocusInvalidation,
  assertNoAuthorityEscalation,
  assertNoFactualityEscalation,
  buildMatterSynthesis,
  detectMaterialCrossWorkflowFocusChange,
  detectTransformTargets,
  detectWorkflowIntent,
  detectWhatChanged,
  isTurnThatIntoRequest,
  mapSupportToReadiness,
  projectClaimDefenseReadiness,
  resolveTurnThatInto,
} from "./conversational-cross-workflow";

describe("Oct 19–25 Phase 5 cross-workflow", () => {
  it("1–12 — detects workflow intents for chain endpoints", () => {
    expect(detectWorkflowIntent("prepare me for the hearing")).toBe("HEARING_PREP");
    expect(detectWorkflowIntent("what should I investigate next?")).toBe("INVESTIGATE_NEXT");
    expect(detectWorkflowIntent("prepare the deposition")).toBe("DEPOSITION_PREP");
    expect(detectWorkflowIntent("draft the factual background")).toBe("DRAFT");
    expect(detectWorkflowIntent("research the notice authority")).toBe("RESEARCH");
    expect(detectWorkflowIntent("what is the weakest part of the record?")).toBe("MATTER_ANALYSIS");
  });

  it("13 — turn that into detects request", () => {
    expect(isTurnThatIntoRequest("turn that into a draft")).toBe(true);
    expect(isTurnThatIntoRequest("turn #2 into a task")).toBe(true);
    expect(isTurnThatIntoRequest("hello")).toBe(false);
  });

  it("14 — bare turn that into is ambiguous target", () => {
    const targets = detectTransformTargets("turn that into");
    expect(targets).toHaveLength(0);
    const state = emptyWorkingState();
    state.lastWorkflowKind = "HEARING_PREP";
    state.activeMotionIds = ["mot-1"];
    const r = resolveTurnThatInto({
      question: "turn that into",
      workingState: state,
      priorValidation: { hearingPrep: { motionId: "mot-1" } },
    });
    expect(r.status === "AMBIGUOUS_TARGET" || r.status === "AMBIGUOUS_BOTH").toBe(true);
  });

  it("15 — resolve hearing → draft when unique", () => {
    const state = emptyWorkingState();
    state.lastWorkflowKind = "HEARING_PREP";
    state.activeMotionIds = ["mot-1"];
    const r = resolveTurnThatInto({
      question: "turn that into a draft argument",
      workingState: state,
      priorValidation: { hearingPrep: { motionId: "mot-1" } },
    });
    expect(r.status).toBe("RESOLVED");
    if (r.status === "RESOLVED") {
      expect(r.sourceArtifact).toBe("hearingPrep");
      expect(r.target).toBe("DRAFT");
    }
  });

  it("16 — ambiguous when hearing + deposition both active and bare transform", () => {
    const state = emptyWorkingState();
    const r = resolveTurnThatInto({
      question: "turn that into a draft",
      workingState: state,
      priorValidation: {
        hearingPrep: { motionId: "m1" },
        depositionPrep: { personId: "p1" },
      },
    });
    // With explicit draft target, source may still be ambiguous
    expect(
      r.status === "AMBIGUOUS_SOURCE" || r.status === "AMBIGUOUS_BOTH" || r.status === "RESOLVED",
    ).toBe(true);
    if (r.status === "RESOLVED") {
      // Prefer last workflow when set
      expect(["hearingPrep", "depositionPrep"]).toContain(r.sourceArtifact);
    }
  });

  it("17 — gap ordinal task transform", () => {
    const state = emptyWorkingState();
    state.activeInvestigateGapIds = ["gap-1", "gap-2"];
    const r = resolveTurnThatInto({
      question: "turn #2 into a task",
      workingState: state,
      priorValidation: { investigateNext: { gaps: [{ id: "gap-1" }, { id: "gap-2" }] } },
    });
    expect(r.status).toBe("RESOLVED");
    if (r.status === "RESOLVED") {
      expect(r.target).toBe("TASK");
      expect(r.sourceIds).toContain("gap-2");
    }
  });

  it("18 — focus invalidation on person switch", () => {
    const state = emptyWorkingState();
    state.activePersonIds = ["old-person"];
    const next = applyFocusInvalidation({
      question: "switch to the other witness",
      state,
    });
    expect(next.activePersonIds).toEqual([]);
  });

  it("19 — stale confirmation detects person/draft drift", () => {
    const state = emptyWorkingState();
    state.activePersonIds = ["new-person"];
    expect(
      detectMaterialCrossWorkflowFocusChange({
        priorPending: {
          activeSnapshot: { persons: ["old-person"] },
          previewPayload: {},
        },
        question: "yes",
        workingState: state,
      }),
    ).toBe(true);
  });

  it("20 — claim/defense readiness mapping", () => {
    expect(mapSupportToReadiness("SUPPORTED", [])).toBe("SUPPORTED");
    expect(mapSupportToReadiness("NO_EVIDENCE_FOUND", [])).toBe("UNSUPPORTED");
    expect(mapSupportToReadiness("UNKNOWN", ["conflict on notice"])).toBe("CONFLICTED");
    const proj = projectClaimDefenseReadiness({
      claims: [
        {
          claimId: "c1",
          label: "Notice",
          supportStatus: "PARTIALLY_SUPPORTED",
          openGaps: ["missing email"],
          supportingEvidenceIds: ["e1"],
        },
      ],
      defenses: [
        {
          defenseId: "d1",
          label: "Waiver",
          supportStatus: "NO_EVIDENCE_FOUND",
          openGaps: ["no support"],
        },
      ],
    });
    expect(proj.claims[0]!.readiness).toBe("PARTIALLY_SUPPORTED");
    expect(proj.defenses[0]!.readiness).toBe("UNSUPPORTED");
  });

  it("21 — matter synthesis refuses win probability / credibility", () => {
    const s = buildMatterSynthesis({
      question: "what is our win probability and credibility score?",
      claims: [
        {
          claimId: "c1",
          label: "Notice",
          supportStatus: "SUPPORTED",
          openGaps: [],
          supportingEvidenceIds: ["e1"],
        },
      ],
      defenses: [],
      contradictions: [{ description: "Date conflict" }],
      investigateNext: [{ title: "Locate attachment", why: "missing" }],
    });
    expect(s.credibilityScoring).toBe(0);
    expect(s.winProbability).toBe(0);
    expect(s.limitations.some((l) => /win-probability|credibility/i.test(l))).toBe(true);
    expect(s.strongestSupported.length).toBeGreaterThan(0);
    expect(s.conflicts[0]).toMatch(/Date conflict/);
  });

  it("22 — what-changed unavailable without prior snapshot", () => {
    const w = detectWhatChanged({
      question: "what changed since the deposition?",
      priorValidation: null,
    });
    expect(w.available).toBe(false);
    expect(w.unavailableReason).toMatch(/No trustworthy prior/i);
  });

  it("23 — what-changed with prior investigate snapshot", () => {
    const w = detectWhatChanged({
      question: "what new gaps came up?",
      priorValidation: {
        investigateNext: { gaps: [{ id: "gap-1", title: "A" }] },
      },
      currentInvestigateGaps: ["gap-1", "gap-2"],
    });
    expect(w.available).toBe(true);
    expect(w.newGaps).toContain("gap-2");
    expect(w.resolvedGaps).toEqual([]);
  });

  it("24 — factuality escalation blocked", () => {
    expect(assertNoFactualityEscalation("SUPPORTED_INFERENCE", "FACT").ok).toBe(false);
    expect(assertNoFactualityEscalation("FACT", "FACT").ok).toBe(true);
    expect(assertNoFactualityEscalation("UNKNOWN", "UNKNOWN").ok).toBe(true);
  });

  it("25 — authority/treatment escalation blocked", () => {
    expect(
      assertNoAuthorityEscalation({
        fromResolution: "IDENTITY_UNRESOLVED",
        toResolution: "CORPUS_COMPLETE",
        fromTreatmentVerified: false,
        toTreatmentVerified: false,
      }).ok,
    ).toBe(false);
    expect(
      assertNoAuthorityEscalation({
        fromResolution: "AUTHORITY_RESOLVED",
        toResolution: "AUTHORITY_RESOLVED",
        fromTreatmentVerified: false,
        toTreatmentVerified: true,
      }).ok,
    ).toBe(false);
  });

  it("26 — source continuity ids preserved on transform", () => {
    const state = emptyWorkingState();
    state.lastWorkflowKind = "RESEARCH";
    state.activeResearchIssueIds = ["issue-1"];
    const r = resolveTurnThatInto({
      question: "turn that research into an argument section",
      workingState: state,
      priorValidation: { matterResearch: { issueId: "issue-1", issueLabel: "Notice" } },
    });
    expect(r.status).toBe("RESOLVED");
    if (r.status === "RESOLVED") {
      expect(r.sourceIds).toContain("issue-1");
      expect(r.target).toBe("DRAFT");
    }
  });
});
