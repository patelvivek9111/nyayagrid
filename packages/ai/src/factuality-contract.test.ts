import { describe, expect, it } from "vitest";
import {
  FACTUALITY_UI_LABELS,
  assertFactProvenance,
  applyAuthoritySafety,
  buildFactualityContract,
  constrainAnswerToPremiseCheck,
  countCredibilityLeaps,
  countInventedDeadlines,
  countInventedDispositions,
  detectUserPremise,
  evaluatePremiseAgainstRecord,
  normalizeSupportedInference,
  sanitizeConflictCredibility,
  validateAssertionSources,
  type FactualityAssertion,
} from "./factuality-contract";

describe("factuality contract (Phase 2)", () => {
  it("A: FACT requires valid source provenance", () => {
    const demoted = assertFactProvenance({
      type: "FACT",
      text: "The court denied the motion.",
      sourceIds: [],
      relatedEntityIds: [],
    });
    expect(demoted.type).toBe("UNKNOWN");

    const kept = assertFactProvenance({
      type: "FACT",
      text: "The court denied the motion.",
      sourceIds: ["doc-1"],
      relatedEntityIds: [],
      matterId: "m1",
      organizationId: "o1",
    });
    expect(kept.type).toBe("FACT");
  });

  it("B/F: unsupported premise is not echoed as fact", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "We won the motion, right?",
      record: { persistedDispositions: [] },
    });
    expect(premise.detected).toBe(true);
    expect(premise.result).toBe("UNSUPPORTED");
    expect(premise.mappedFactuality).toBe("UNSUPPORTED");

    const constrained = constrainAnswerToPremiseCheck(
      { answer: "Yes, you won the motion.", evidenceState: "grounded" },
      premise,
    );
    expect(constrained.answer).toMatch(/Unsupported|does not establish/i);
    expect(constrained.answer).not.toMatch(/^Yes/i);
    expect(constrained.evidenceState).toBe("insufficient");
  });

  it("C: SUPPORTED_INFERENCE remains labeled inference", () => {
    const normalized = normalizeSupportedInference({
      type: "SUPPORTED_INFERENCE",
      text: "Claim A is fully proven.",
      sourceIds: ["doc-1", "doc-2"],
      relatedEntityIds: [],
    });
    expect(normalized.type).toBe("SUPPORTED_INFERENCE");
    expect(normalized.text).toMatch(/inference|supports the inference/i);
  });

  it("D: CONFLICT does not become credibility conclusion", () => {
    const { assertion, credibilityLeapBlocked } = sanitizeConflictCredibility({
      type: "CONFLICT",
      text: "The witness lied about the date.",
      sourceIds: ["doc-a", "doc-b"],
      relatedEntityIds: [],
      conflictKind: "DIRECT_CONFLICT",
    });
    expect(credibilityLeapBlocked).toBe(true);
    expect(assertion.text).toMatch(/conflict/i);
    expect(assertion.text).not.toMatch(/\blied\b/i);
    expect(countCredibilityLeaps(assertion.text)).toBe(0);
  });

  it("E: UNKNOWN when evidence absent", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "The judge dismissed Claim A, correct?",
      record: { persistedDispositions: [] },
    });
    expect(premise.result).toBe("UNSUPPORTED");
    const contract = buildFactualityContract({ premiseCheck: premise });
    expect(contract.summary.unsupportedCount).toBeGreaterThan(0);
    expect(contract.assertions.some((a) => a.type === "UNSUPPORTED" || a.type === "UNKNOWN")).toBe(
      true,
    );
  });

  it("G/H/I: unresolved authority and treatment stay unknown; metadata-only not full text", () => {
    const unresolved = applyAuthoritySafety({
      type: "FACT",
      text: "This authority controls the issue.",
      sourceIds: ["auth:1"],
      relatedEntityIds: [],
      authorityState: "IDENTITY_UNRESOLVED",
      treatmentVerified: false,
    });
    expect(unresolved.type).toBe("UNKNOWN");

    const metadataOnly = applyAuthoritySafety({
      type: "FACT",
      text: "Full opinion analysis shows the holding.",
      sourceIds: ["auth:2"],
      relatedEntityIds: [],
      authorityState: "AUTHORITY_RESOLVED",
      treatmentVerified: false,
    });
    expect(metadataOnly.type).toBe("UNKNOWN");

    const treatment = applyAuthoritySafety({
      type: "FACT",
      text: "This case is still good law.",
      sourceIds: ["auth:3"],
      relatedEntityIds: [],
      authorityState: "CORPUS_COMPLETE",
      treatmentVerified: false,
    });
    expect(treatment.type).toBe("UNKNOWN");

    const premise = evaluatePremiseAgainstRecord({
      question: "This case was overruled, correct?",
      record: {
        authorities: [
          { id: "a1", resolution: "AUTHORITY_RESOLVED", treatmentVerified: false, hasFullText: false },
        ],
      },
    });
    expect(premise.result).toBe("UNKNOWN");
    expect(premise.reason).toMatch(/NOT VERIFIED|UNKNOWN/i);
  });

  it("J: deadline not invented", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "So discovery closes Friday?",
      record: { persistedDeadlines: [] },
    });
    expect(premise.result).toBe("UNSUPPORTED");
    const answer = constrainAnswerToPremiseCheck(
      { answer: "Yes, discovery closes Friday.", evidenceState: "grounded" },
      premise,
    );
    expect(countInventedDeadlines(answer.answer, [])).toBe(0);
    expect(answer.answer).toMatch(/Unsupported|does not establish/i);
  });

  it("K: disposition not invented", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "The judge denied it, right?",
      record: { persistedDispositions: [] },
    });
    expect(["UNSUPPORTED", "UNKNOWN"]).toContain(premise.result);
    const answer = constrainAnswerToPremiseCheck(
      { answer: "Yes, the judge denied the motion.", evidenceState: "grounded" },
      premise,
    );
    expect(countInventedDispositions(answer.answer, [])).toBe(0);
  });

  it("L/M: foreign and cross-matter source IDs rejected", () => {
    const assertion: FactualityAssertion = {
      type: "FACT",
      text: "Quote from foreign matter",
      sourceIds: ["foreign-doc", "matter-doc"],
      relatedEntityIds: [],
      matterId: "m1",
      organizationId: "o1",
    };
    const validated = validateAssertionSources(assertion, ["matter-doc"]);
    expect(validated.sourceIds).toEqual(["matter-doc"]);
    expect(validated.type).toBe("FACT");

    const allForeign = validateAssertionSources(
      { ...assertion, sourceIds: ["foreign-doc"] },
      ["matter-doc"],
    );
    expect(allForeign.sourceIds).toEqual([]);
    expect(allForeign.type).toBe("UNKNOWN");
  });

  it("detects did-the-witness-lie and still-good-law premises", () => {
    expect(detectUserPremise("Did the witness lie about the date?").detected).toBe(true);
    expect(detectUserPremise("Is this case still good law?").detected).toBe(true);
    expect(detectUserPremise("Is that still good law?").detected).toBe(true);
  });

  it("detects credibility-ranking asks without treating them as record facts", () => {
    for (const question of [
      "which witness is lying?",
      "who should we believe?",
      "which testimony is false?",
      "this proves he lied, right?",
    ]) {
      const detected = detectUserPremise(question);
      expect(detected.detected).toBe(true);
      expect(detected.kind).toBe("credibility");
      const premise = evaluatePremiseAgainstRecord({
        question,
        record: {
          persistedDeadlines: [],
          persistedDispositions: [],
          authorities: [],
        },
      });
      expect(premise.result).toBe("UNSUPPORTED");
      expect(premise.mappedFactuality).toBe("UNSUPPORTED");
      const out = constrainAnswerToPremiseCheck(
        { answer: "Yes, the witness is lying.", evidenceState: "grounded" },
        premise,
      );
      expect(out.answer).not.toMatch(/^Yes, the witness is lying/i);
    }
  });

  it("false-premise scenarios reject agreement", () => {
    const prompts = [
      "We won the motion, right?",
      "The witness lied about the date.",
      "Did the witness lie about the date?",
      "This case was overruled, correct?",
      "Is this case still good law?",
      "So discovery closes Friday?",
      "The judge dismissed Claim A.",
    ];
    for (const question of prompts) {
      const detected = detectUserPremise(question);
      expect(detected.detected).toBe(true);
      const premise = evaluatePremiseAgainstRecord({
        question,
        record: {
          persistedDeadlines: [],
          persistedDispositions: [],
          authorities: [
            { id: "a1", resolution: "IDENTITY_UNRESOLVED", treatmentVerified: false },
          ],
        },
      });
      expect(["UNSUPPORTED", "UNKNOWN"]).toContain(premise.result);
      const out = constrainAnswerToPremiseCheck(
        { answer: "Yes, that is correct.", evidenceState: "grounded" },
        premise,
      );
      expect(out.answer).not.toMatch(/^Yes, that is correct/i);
    }
  });

  it("multi-turn: support is not outcome certainty", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "So that proves we win, right?",
      record: {
        propositionSupported: true,
        propositionPartial: true,
      },
    });
    expect(premise.result).toBe("PARTIALLY_SUPPORTED");
    expect(premise.mappedFactuality).toBe("SUPPORTED_INFERENCE");
    expect(premise.reason).toMatch(/not the same as outcome|support/i);
  });

  it("UI labels stay human-readable", () => {
    expect(FACTUALITY_UI_LABELS.FACT).toBe("Record fact");
    expect(FACTUALITY_UI_LABELS.UNSUPPORTED).toMatch(/Unsupported/);
  });
});
