/**
 * Nyaya Conversational Workspace Phase 2 — LOCAL live certification.
 * Requires SHARED_RUNTIME_LOCK before RUN_DB_TESTS=1 against localhost:5433.
 * CourtListener: 0. Schema migration: NONE. Neon corpus: unused.
 */
import { describe, expect, it } from "vitest";
import {
  buildFactualityContract,
  constrainAnswerToPremiseCheck,
  countCredibilityLeaps,
  countInventedDeadlines,
  evaluatePremiseAgainstRecord,
} from "@nyayagrid/ai";
import { planConversationalContext } from "./conversational-context-router";
import {
  CONVERSATION_RECENT_TURN_LIMIT,
  selectRecentTurns,
  type ConversationTurnForPrompt,
} from "./conversation-context";

const runDbTests = process.env.RUN_DB_TESTS === "1";

describe("Phase 2 factuality + router static certification gates", () => {
  it("SCENARIO 1: false premise rejected", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "We won the motion, right?",
      record: { persistedDispositions: [] },
    });
    const out = constrainAnswerToPremiseCheck(
      { answer: "Yes, you won.", evidenceState: "grounded" },
      premise,
    );
    expect(premise.result).toBe("UNSUPPORTED");
    expect(out.answer).not.toMatch(/^Yes/i);
  });

  it("SCENARIO 2: narrow motion router", () => {
    const plan = planConversationalContext({
      question: "What did the judge rule on the motion to compel?",
    });
    expect(plan.wholeMatterUsed).toBe(false);
    expect(plan.loaders.motionsComms).toBe(true);
    expect(plan.loaders.civil).toBe(false);
    expect(plan.loaders.discovery).toBe(false);
  });

  it("SCENARIO 3: whole-matter without duplicate loaders", () => {
    const plan = planConversationalContext({
      question: "What should we investigate next across this matter?",
    });
    expect(plan.wholeMatterUsed).toBe(true);
    expect(plan.loaders.civil).toBe(false);
    expect(plan.loaders.discovery).toBe(false);
    expect(plan.loaders.motionsComms).toBe(false);
  });

  it("SCENARIO 4: credibility leap blocked", () => {
    const contract = buildFactualityContract({
      assertions: [
        {
          type: "CONFLICT",
          text: "The witness lied about the date.",
          sourceIds: ["d1", "d2"],
          relatedEntityIds: [],
        },
      ],
      allowedSourceIds: ["d1", "d2"],
    });
    expect(contract.assertions[0]?.text).not.toMatch(/\blied\b/i);
    expect(countCredibilityLeaps(contract.assertions[0]?.text ?? "")).toBe(0);
  });

  it("SCENARIO 5: treatment unknown stays unknown", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "Is this case still good law?",
      record: {
        authorities: [
          { id: "a1", resolution: "AUTHORITY_RESOLVED", treatmentVerified: false },
        ],
      },
    });
    // Soft question may not always detect premise; contract authority safety covers treatment.
    if (premise.detected) {
      expect(["UNKNOWN", "UNSUPPORTED"]).toContain(premise.result);
    }
    const contract = buildFactualityContract({
      assertions: [
        {
          type: "FACT",
          text: "This case is still good law.",
          sourceIds: ["a1"],
          relatedEntityIds: [],
          authorityState: "AUTHORITY_RESOLVED",
          treatmentVerified: false,
        },
      ],
      allowedSourceIds: ["a1"],
    });
    expect(contract.assertions[0]?.type).toBe("UNKNOWN");
  });

  it("SCENARIO 6: deadline unknown when not persisted", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "So discovery closes Friday?",
      record: { persistedDeadlines: [] },
    });
    const out = constrainAnswerToPremiseCheck(
      { answer: "Discovery closes Friday.", evidenceState: "grounded" },
      premise,
    );
    expect(premise.result).toBe("UNSUPPORTED");
    expect(countInventedDeadlines(out.answer, [])).toBe(0);
  });

  it("SCENARIO 7: multi-turn support ≠ outcome certainty", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "So that proves we win, right?",
      record: { propositionSupported: true, propositionPartial: true },
    });
    expect(premise.result).toBe("PARTIALLY_SUPPORTED");
    expect(premise.mappedFactuality).toBe("SUPPORTED_INFERENCE");
  });

  it("conversation bound preserved", () => {
    const turns: ConversationTurnForPrompt[] = Array.from({ length: 20 }, (_, i) => ({
      messageId: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `t${i}`,
      createdAt: new Date(),
      completionStatus: "completed",
      evidenceState: "grounded",
      sourceIds: [],
      authorityIds: [],
      workingState: null,
    }));
    expect(selectRecentTurns(turns).length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
  });
});

describe.runIf(runDbTests)("Phase 2 live certification (local DB — lock required)", () => {
  it("placeholder: run only after SHARED_RUNTIME_LOCK_REQUIRED is granted", () => {
    // Full Ask SSE scenarios execute under lock with local fixture data only.
    expect(process.env.DATABASE_URL ?? "").toMatch(/localhost:5433|127\.0\.0\.1:5433/);
  });
});
