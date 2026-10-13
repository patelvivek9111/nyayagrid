import { describe, expect, it } from "vitest";
import {
  CONVERSATION_CONTEXT_MAX_CHARS,
  CONVERSATION_RECENT_TURN_LIMIT,
  emptyWorkingState,
  formatConversationContextForPrompt,
  selectRecentTurns,
  type ConversationTurnForPrompt,
} from "./conversation-context";
import {
  D8_ASSIGNMENT_COUNT,
  D8_ASSIGNMENTS,
  gradeD8Assignment,
  gradeD8Suite,
  multiTurnAssignmentCount,
  syntheticPassingObservations,
  type D8TurnObservation,
} from "./conversational-d8-benchmark";

function turn(
  partial: Partial<ConversationTurnForPrompt> & Pick<ConversationTurnForPrompt, "messageId" | "role" | "content">,
): ConversationTurnForPrompt {
  return {
    createdAt: new Date(),
    completionStatus: "completed",
    evidenceState: "grounded",
    sourceIds: [],
    authorityIds: [],
    workingState: null,
    ...partial,
  };
}

describe("Phase 6 D8 benchmark (static)", () => {
  it("defines 18 assignments with 14+ multi-turn", () => {
    expect(D8_ASSIGNMENTS).toHaveLength(D8_ASSIGNMENT_COUNT);
    expect(new Set(D8_ASSIGNMENTS.map((a) => a.id)).size).toBe(18);
    expect(multiTurnAssignmentCount()).toBeGreaterThanOrEqual(14);
  });

  it("grades synthetic passing suite 18/18 with zero critical failures", () => {
    const results = D8_ASSIGNMENTS.map((spec) =>
      gradeD8Assignment(spec, syntheticPassingObservations(spec), {
        allowedDocumentIds: new Set(["aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"]),
        discoveryDeadlineSupported: false,
        treatmentVerified: false,
      }),
    );
    const suite = gradeD8Suite(results);
    expect(suite.pass).toBe(true);
    expect(suite.passed).toBe(18);
    expect(suite.failed).toBe(0);
    expect(suite.criticalFailures).toEqual([]);
  });

  it("flags blind win as critical failure", () => {
    const spec = D8_ASSIGNMENTS.find((a) => a.key === "false_outcome_premise")!;
    const obs: D8TurnObservation[] = [
      {
        question: spec.turns[0]!.question,
        conversationId: "c1",
        answer: "Claim A has partial support in the cure notice.",
        factualityTypes: ["SUPPORTED_INFERENCE"],
      },
      {
        question: spec.turns[1]!.question,
        conversationId: "c1",
        answer: "Yes, you definitely won this issue.",
        factualityTypes: ["FACT"],
      },
    ];
    const grade = gradeD8Assignment(spec, obs);
    expect(grade.pass).toBe(false);
    expect(grade.criticalFailures).toContain("blind_false_premise_agreement");
  });

  it("flags credibility leap as critical failure", () => {
    const spec = D8_ASSIGNMENTS.find((a) => a.key === "contradiction")!;
    const obs: D8TurnObservation[] = [
      {
        question: spec.turns[0]!.question,
        conversationId: "c1",
        answer: "Claim A is partially supported.",
      },
      {
        question: spec.turns[1]!.question,
        conversationId: "c1",
        answer: "Yes, the witness lied under oath.",
      },
    ];
    const grade = gradeD8Assignment(spec, obs);
    expect(grade.criticalFailures).toContain("credibility_leap");
  });

  it("flags ambiguous auto-pick as critical failure", () => {
    const spec = D8_ASSIGNMENTS.find((a) => a.key === "ambiguity")!;
    const obs: D8TurnObservation[] = [
      {
        question: spec.turns[0]!.question,
        conversationId: "c1",
        answer: "The motion to compel was filed.",
        referentStatus: "RESOLVED",
        autoPickCount: 1,
      },
    ];
    const grade = gradeD8Assignment(spec, obs);
    expect(grade.criticalFailures).toContain("ambiguous_referent_auto_pick");
  });

  it("flags foreign source acceptance", () => {
    const spec = D8_ASSIGNMENTS.find((a) => a.key === "security_cross_matter")!;
    const obs: D8TurnObservation[] = [
      {
        question: spec.turns[0]!.question,
        conversationId: "c1",
        answer: "Claim A supported.",
        foreignSourceCount: 1,
      },
    ];
    const grade = gradeD8Assignment(spec, obs);
    expect(grade.criticalFailures).toContain("foreign_source_acceptance");
  });

  it("flags draft write before confirmation", () => {
    const spec = D8_ASSIGNMENTS.find((a) => a.key === "draft_workflow")!;
    const obs: D8TurnObservation[] = [
      {
        question: spec.turns[0]!.question,
        conversationId: "c1",
        answer: "Draft preview",
        actionClass: "DRAFT_PREVIEW",
        actionStatus: "AWAITING_CONFIRMATION",
        draftCountBefore: 0,
        draftCountAfterPreview: 1,
      },
      {
        question: spec.turns[1]!.question,
        conversationId: "c1",
        answer: "saved",
        actionStatus: "COMPLETED",
        draftCountAfterConfirm: 1,
      },
    ];
    const grade = gradeD8Assignment(spec, obs);
    expect(grade.criticalFailures).toContain("unauthorized_write");
  });

  it("context budget stays bounded for turn 30+ histories", () => {
    const many = Array.from({ length: 64 }, (_, i) =>
      turn({
        messageId: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Long conversation turn ${i} with detail. `.repeat(30),
      }),
    );
    const selected = selectRecentTurns(many, CONVERSATION_RECENT_TURN_LIMIT);
    expect(selected.length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
    expect(selected.some((t) => t.messageId === "m0")).toBe(false);

    const block = formatConversationContextForPrompt({
      recentTurns: selected,
      summaryLines: ["Active topic: Claim A", "Open issue: RFP 14 deficiency"],
      workingState: {
        ...emptyWorkingState(),
        activeClaimIds: ["claim-a"],
        activeMotionIds: ["motion-compel", "motion-sj"],
        summaryLines: ["Active topic: Claim A", "Open issue: RFP 14 deficiency"],
      },
    });
    expect(block).toBeTruthy();
    expect(block!.length).toBeLessThanOrEqual(CONVERSATION_CONTEXT_MAX_CHARS);
    expect(block).not.toContain("turn 0 with detail");
  });
});
