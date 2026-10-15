import { describe, expect, it } from "vitest";
import {
  buildHearingPrepResult,
  compressHearingPrep,
  formatHearingPrepForPrompt,
  hearingPrepRejectsGenericChecklist,
  isHearingCompressionRequest,
  isHearingOutlineRequest,
  isHearingPrepQuestion,
  motionPosture,
  selectHearingMotionTarget,
  type HearingPrepMotionInput,
} from "./conversational-hearing-prep";
import { classifyConversationalAction } from "./conversational-workflow-actions";

const compel: HearingPrepMotionInput = {
  id: "m-compel",
  title: "Motion to Compel — May 4",
  motionType: "MOTION_TO_COMPEL",
  status: "FILED",
  disposition: null,
  filedAt: "2025-05-04T15:00:00.000Z",
  hearingAt: "2025-05-28T15:00:00.000Z",
  rulingAt: null,
  rulingSummary: null,
  relatedClaimIds: ["claim-a"],
  relatedDeficiencyIds: ["def-14"],
  relatedEvidenceIds: ["ev-1"],
  relatedCommunicationIds: ["comm-1"],
  matterId: "matter-a",
};

const sj: HearingPrepMotionInput = {
  id: "m-sj",
  title: "Summary Judgment Motion — June 12",
  motionType: "SUMMARY_JUDGMENT",
  status: "FILED",
  disposition: null,
  filedAt: "2025-06-12T15:00:00.000Z",
  hearingAt: "2025-07-01T15:00:00.000Z",
  rulingAt: null,
  rulingSummary: null,
  relatedClaimIds: ["claim-b"],
  relatedDeficiencyIds: [],
  relatedEvidenceIds: [],
  relatedCommunicationIds: [],
  matterId: "matter-a",
};

const decided: HearingPrepMotionInput = {
  ...compel,
  id: "m-decided",
  status: "DENIED",
  disposition: "DENIED",
  rulingAt: "2025-06-01T15:00:00.000Z",
  rulingSummary: "Denied without prejudice.",
};

describe("Oct 19–25 Phase 1 hearing prep", () => {
  it("1 — prepare hearing from explicit motion", () => {
    const result = buildHearingPrepResult({
      question: "Prepare me for the motion to compel hearing",
      matterId: "matter-a",
      motions: [compel, sj],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A — breach", supportStatus: "PARTIALLY_SUPPORTED" }],
      evidence: [
        {
          id: "ev-1",
          label: "Cure notice",
          supportsClaimIds: ["claim-a"],
          documentId: "doc-1",
        },
      ],
    });
    expect(result.hearingTarget.motionId).toBe("m-compel");
    expect(result.hearingTarget.posture).toBe("HEARING_SCHEDULED");
    expect(result.issuesBeforeCourt[0]?.supportState).toBe("PARTIALLY_SUPPORTED");
  });

  it("2 — prepare hearing from conversational referent (resolved id)", () => {
    const result = buildHearingPrepResult({
      question: "prepare me for this hearing",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
    });
    expect(result.hearingTarget.motionId).toBe("m-compel");
  });

  it("3 — ambiguous motion → no auto-pick", () => {
    const selected = selectHearingMotionTarget({
      motions: [compel, sj],
      ambiguousMotionIds: ["m-compel", "m-sj"],
      question: "prepare me for the hearing",
    });
    expect(selected.posture).toBe("AMBIGUOUS");
    expect(selected.motion).toBeNull();
    const result = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [compel, sj],
      ambiguousMotionIds: ["m-compel", "m-sj"],
    });
    expect(result.hearingTarget.posture).toBe("AMBIGUOUS");
    expect(result.issuesBeforeCourt).toHaveLength(0);
  });

  it("4 — motion pending vs decided distinction", () => {
    expect(motionPosture(compel)).toBe("HEARING_SCHEDULED");
    expect(motionPosture(decided)).toBe("MOTION_DECIDED");
    const pending = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
    });
    expect(pending.hearingTarget.disposition).toBeNull();
    const done = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [decided],
      resolvedMotionId: "m-decided",
    });
    expect(done.hearingTarget.disposition).toBe("DENIED");
    expect(done.limitations.join(" ")).toMatch(/disposition|ruling/i);
  });

  it("5 — strong fact with source", () => {
    const result = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "SUPPORTED" }],
      evidence: [{ id: "ev-1", label: "Lease", supportsClaimIds: ["claim-a"] }],
    });
    expect(result.strongestFacts[0]?.factuality).toBe("FACT");
    expect(result.strongestFacts[0]?.sources.some((s) => s.id === "ev-1")).toBe(true);
  });

  it("6 — weak argument", () => {
    const result = buildHearingPrepResult({
      question: "what's our weakest point?",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "UNKNOWN" }],
    });
    expect(result.weakestPoints.length).toBeGreaterThan(0);
  });

  it("7 — record conflict", () => {
    const result = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "SUPPORTED" }],
      evidence: [
        { id: "ev-1", label: "Affidavit A", supportsClaimIds: ["claim-a"] },
        { id: "ev-2", label: "Affidavit B", contradictsClaimIds: ["claim-a"] },
      ],
    });
    expect(result.conflictsInRecord.length).toBeGreaterThan(0);
    expect(result.conflictsInRecord[0]?.factuality).toBe("CONFLICT");
    expect(result.issuesBeforeCourt[0]?.supportState).toBe("CONFLICTED");
  });

  it("8 — unsupported argument", () => {
    const result = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "UNSUPPORTED" }],
    });
    expect(result.unsupportedOrUnknown.some((u) => u.factuality === "UNSUPPORTED")).toBe(true);
  });

  it("9 — authority treatment NOT VERIFIED", () => {
    const result = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      authorities: [
        {
          id: "auth-1",
          label: "Acme v. Supply",
          resolution: "AUTHORITY_RESOLVED",
          treatmentVerified: false,
        },
      ],
    });
    expect(result.authorities[0]?.treatmentStatus).toBe("NOT_VERIFIED");
    expect(result.authorities[0]?.note).toMatch(/full-opinion analysis is not implied/i);
  });

  it("10 — possible judge questions grounded in gaps", () => {
    const result = buildHearingPrepResult({
      question: "what questions should I expect from the judge?",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "UNKNOWN" }],
    });
    expect(result.possibleJudgeQuestions.length).toBeGreaterThan(0);
    expect(result.possibleJudgeQuestions.join(" ")).not.toMatch(/\bthe judge will ask\b/i);
    expect(result.limitations.join(" ")).toMatch(/not predictions/i);
  });

  it("11/12 — opposing position from record; no fabricated opposing argument", () => {
    const withRecord = buildHearingPrepResult({
      question: "what would opposing counsel say?",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "PARTIAL" }],
      communications: [
        {
          id: "comm-1",
          subject: "Opposition letter",
          summary: "Defense disputes notice adequacy.",
          relatedMotionIds: ["m-compel"],
        },
      ],
    });
    expect(withRecord.issuesBeforeCourt[0]?.opposingPositionFromRecord).toMatch(/notice/i);
    expect(withRecord.issuesBeforeCourt[0]?.opposingFactuality).toBe("SUPPORTED_INFERENCE");

    const none = buildHearingPrepResult({
      question: "what would opposing counsel say?",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "SUPPORTED" }],
    });
    expect(none.issuesBeforeCourt[0]?.opposingPositionFromRecord).toBeNull();
  });

  it("13 — investigate-next from evidence gap", () => {
    const result = buildHearingPrepResult({
      question: "what should I investigate before the hearing?",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "UNSUPPORTED" }],
    });
    expect(result.investigateBeforeHearing.some((i) => /lacks clear record support/i.test(i.whyThisGapMatters))).toBe(
      true,
    );
    expect(hearingPrepRejectsGenericChecklist(result)).toBe(true);
  });

  it("14 — investigate-next from discovery deficiency", () => {
    const result = buildHearingPrepResult({
      question: "what should I investigate before the hearing?",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      deficiencies: [
        {
          id: "def-14",
          description: "Missing attachments on RFP #14",
          status: "OPEN",
          motionId: "m-compel",
        },
      ],
    });
    expect(result.investigateBeforeHearing.some((i) => /discovery deficiency/i.test(i.whyThisGapMatters))).toBe(
      true,
    );
  });

  it("15 — investigate-next from authority gap", () => {
    const result = buildHearingPrepResult({
      question: "what should I investigate before the hearing?",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      authorities: [
        {
          id: "auth-1",
          label: "Acme",
          resolution: "IDENTITY_UNRESOLVED",
          treatmentVerified: false,
        },
      ],
    });
    expect(result.investigateBeforeHearing.some((i) => /treatment is not verified/i.test(i.whyThisGapMatters))).toBe(
      true,
    );
    expect(result.authorities[0]?.note).toMatch(/Identity unresolved/i);
  });

  it("16 — hearing outline preview", () => {
    expect(isHearingOutlineRequest("turn this into an outline")).toBe(true);
    const result = buildHearingPrepResult({
      question: "turn this into a hearing outline",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "PARTIAL" }],
      outlineRequested: true,
    });
    expect(result.outlinePreview).toMatch(/DRAFT PREVIEW/i);
    expect(result.outlinePreview).toMatch(/Claim A/);
  });

  it("17 — save outline requires confirmation (action class)", () => {
    const outline = classifyConversationalAction({
      question: "Draft a hearing outline for the motion to compel",
    });
    expect(outline.actionClass).toBe("DRAFT_PREVIEW");
    const save = classifyConversationalAction({ question: "save it" });
    expect(save.actionClass).toBe("WRITE_CONFIRMATION_REQUIRED");
  });

  it("18 — stale confirmation rejected is workflow concern (classification intact)", () => {
    const confirm = classifyConversationalAction({ question: "confirm" });
    expect(confirm.actionType).toBe("CONFIRM_PENDING");
    expect(confirm.actionClass).toBe("WRITE_CONFIRMATION_REQUIRED");
  });

  it("19 — 5-minute compression preserves grounding", () => {
    expect(isHearingCompressionRequest("make a 5-minute version")).toBe(5);
    const result = buildHearingPrepResult({
      question: "make a 5-minute version",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "SUPPORTED" }],
      compressMinutes: 5,
    });
    expect(result.compressedOralArgument).toMatch(/5-MINUTE/);
    expect(result.compressedOralArgument).toMatch(/Claim A/);
    expect(result.compressedOralArgument).not.toMatch(/\bwe will win\b/i);
  });

  it("20 — cross-matter source rejected", () => {
    const result = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      foreignMatterId: "matter-b",
      motions: [
        compel,
        { ...sj, id: "m-foreign", matterId: "matter-b", title: "Foreign motion" },
      ],
      resolvedMotionId: "m-compel",
    });
    expect(result.sourceMap.some((s) => s.id === "m-foreign")).toBe(false);
  });

  it("21 — guest access denied remains policy outside builder; prep is READ_ONLY", () => {
    expect(isHearingPrepQuestion("prepare me for tomorrow's hearing")).toBe(true);
    const cls = classifyConversationalAction({ question: "prepare me for tomorrow's hearing" });
    // Hearing prep itself is read-only unless drafting outline.
    expect(["READ_ONLY", "LONG_RUNNING_READ"]).toContain(cls.actionClass);
  });

  it("22 — large matter bounded context (selective issues, not full dump)", () => {
    const manyClaims = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      label: `Claim ${i}`,
      supportStatus: i % 2 === 0 ? "SUPPORTED" : "UNKNOWN",
    }));
    const result = buildHearingPrepResult({
      question: "prepare me for the hearing focusing on causation",
      matterId: "matter-a",
      motions: [{ ...compel, relatedClaimIds: ["c1"] }],
      resolvedMotionId: "m-compel",
      claims: manyClaims,
      focusIssue: "Claim 1",
    });
    expect(result.issuesBeforeCourt.length).toBeLessThan(manyClaims.length);
    const prompt = formatHearingPrepForPrompt(result);
    expect(prompt.length).toBeLessThan(20_000);
  });

  it("23 — multi-turn focus shift", () => {
    const all = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [
        { id: "claim-a", label: "Claim A — breach", supportStatus: "PARTIAL" },
        { id: "claim-c", label: "Claim C — causation", supportStatus: "UNKNOWN" },
      ],
    });
    const focused = buildHearingPrepResult({
      question: "focus only on causation",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [
        { id: "claim-a", label: "Claim A — breach", supportStatus: "PARTIAL" },
        { id: "claim-c", label: "Claim C — causation", supportStatus: "UNKNOWN" },
      ],
      focusIssue: "causation",
    });
    expect(all.issuesBeforeCourt.length).toBeGreaterThanOrEqual(focused.issuesBeforeCourt.length);
    expect(focused.issuesBeforeCourt.every((i) => /causation|Claim C/i.test(i.label))).toBe(true);
  });

  it("24 — source traceability", () => {
    const result = buildHearingPrepResult({
      question: "show me what evidence supports each argument",
      matterId: "matter-a",
      motions: [compel],
      resolvedMotionId: "m-compel",
      claims: [{ id: "claim-a", label: "Claim A", supportStatus: "SUPPORTED" }],
      evidence: [{ id: "ev-1", label: "Cure notice", supportsClaimIds: ["claim-a"] }],
    });
    expect(result.sourceMap.some((s) => s.id === "ev-1")).toBe(true);
    expect(result.issuesBeforeCourt[0]?.sources.some((s) => s.id === "ev-1")).toBe(true);
  });

  it("25 — no invented deadline", () => {
    const noDate = { ...compel, hearingAt: null };
    const result = buildHearingPrepResult({
      question: "prepare me for the hearing",
      matterId: "matter-a",
      motions: [noDate],
      resolvedMotionId: "m-compel",
    });
    expect(result.hearingTarget.hearingAt).toBeNull();
    expect(result.hearingTarget.posture).toBe("MOTION_FILED_NO_HEARING_DATE");
    expect(result.investigateBeforeHearing.some((i) => /do not invent a date/i.test(i.whatToLookFor))).toBe(
      true,
    );
    expect(compressHearingPrep({
      minutes: 2,
      motion: noDate,
      issues: [],
      strongestFacts: [],
      weakestPoints: [],
    })).not.toMatch(/Friday|tomorrow at/i);
  });

  it("detects hearing prep / outline / compression intents", () => {
    expect(isHearingPrepQuestion("prepare me for tomorrow's hearing")).toBe(true);
    expect(isHearingPrepQuestion("what is the weather")).toBe(false);
    expect(isHearingOutlineRequest("hearing outline please")).toBe(true);
    expect(isHearingCompressionRequest("2-minute version")).toBe(2);
  });
});
