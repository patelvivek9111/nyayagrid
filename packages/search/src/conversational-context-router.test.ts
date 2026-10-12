import { describe, expect, it } from "vitest";
import {
  CONVERSATION_CONTEXT_MAX_CHARS,
  CONVERSATION_RECENT_TURN_LIMIT,
  formatConversationContextForPrompt,
  emptyWorkingState,
  restrictTurnSourceIds,
  selectRecentTurns,
  type ConversationTurnForPrompt,
} from "./conversation-context";
import {
  WHOLE_MATTER_OVERLAP_DOMAINS,
  planConversationalContext,
} from "./conversational-context-router";

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

describe("conversational context router (Phase 2)", () => {
  it("N: narrow motion question routes only narrow domains", () => {
    const plan = planConversationalContext({
      question: "What did the judge rule on the motion to compel?",
    });
    expect(plan.wholeMatterUsed).toBe(false);
    expect(plan.loaders.wholeMatter).toBe(false);
    expect(plan.loaders.motionsComms).toBe(true);
    expect(plan.loaders.civil).toBe(false);
    expect(plan.loaders.discovery).toBe(false);
    expect(plan.selectedDomains).toContain("MOTIONS");
    expect(plan.selectedDomains).not.toContain("WHOLE_MATTER");
    expect(plan.reasonCodes).toContain("NARROW_ROUTE");
  });

  it("O: whole-matter question uses whole-matter path", () => {
    const plan = planConversationalContext({
      question: "What should we investigate next?",
    });
    expect(plan.wholeMatterUsed).toBe(true);
    expect(plan.loaders.wholeMatter).toBe(true);
    expect(plan.selectedDomains).toContain("WHOLE_MATTER");
    expect(plan.loaders.civil).toBe(false);
    expect(plan.loaders.discovery).toBe(false);
    expect(plan.loaders.motionsComms).toBe(false);
  });

  it("P: duplicate domain loading suppressed under whole-matter", () => {
    const plan = planConversationalContext({
      question:
        "Give me the complete status of this matter including claims, discovery gaps, and pending motions.",
    });
    expect(plan.wholeMatterUsed).toBe(true);
    expect(plan.duplicateLoaderSuppressed.length).toBeGreaterThan(0);
    for (const d of plan.duplicateLoaderSuppressed) {
      expect(WHOLE_MATTER_OVERLAP_DOMAINS).toContain(d);
    }
    expect(plan.loaders.civil).toBe(false);
    expect(plan.loaders.discovery).toBe(false);
    expect(plan.loaders.motionsComms).toBe(false);
    expect(plan.reasonCodes.some((r) => r.startsWith("SUPPRESS_DUPLICATE_"))).toBe(true);
  });

  it("claims + evidence narrow route without whole-matter", () => {
    const plan = planConversationalContext({
      question: "What supports element 3 of Claim A?",
    });
    expect(plan.wholeMatterUsed).toBe(false);
    expect(plan.loaders.civil).toBe(true);
    expect(plan.selectedDomains).toEqual(
      expect.arrayContaining(["CLAIMS", "EVIDENCE"]),
    );
  });

  it("discovery missing routes discovery domain", () => {
    const plan = planConversationalContext({
      question: "What discovery is missing?",
    });
    // May hit whole-matter via "discovery gaps" pattern — accept either targeted or whole-matter.
    if (plan.wholeMatterUsed) {
      expect(plan.loaders.discovery).toBe(false);
      expect(plan.duplicateLoaderSuppressed).toContain("DISCOVERY");
    } else {
      expect(plan.loaders.discovery).toBe(true);
      expect(plan.selectedDomains).toContain("DISCOVERY");
    }
  });

  it("draft intent is preview-only flag", () => {
    const plan = planConversationalContext({
      question: "Draft a reply to opposing counsel",
    });
    expect(plan.selectedDomains).toContain("DRAFT");
    expect(plan.loaders.draftPreview).toBe(true);
    expect(plan.reasonCodes).toContain("DRAFT_PREVIEW_ONLY");
  });

  it("Q: conversation history remains bounded", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      turn({
        messageId: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `History ${i} `.repeat(30),
      }),
    );
    const selected = selectRecentTurns(many, CONVERSATION_RECENT_TURN_LIMIT);
    expect(selected.length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
    const block = formatConversationContextForPrompt({
      recentTurns: selected,
      summaryLines: ["Active topic: Motions / rulings"],
      workingState: emptyWorkingState(),
    });
    expect(block!.length).toBeLessThanOrEqual(CONVERSATION_CONTEXT_MAX_CHARS);
  });

  it("R: Phase 1 multi-turn continuity / foreign source strip preserved", () => {
    const turns = [
      turn({
        messageId: "u1",
        role: "user",
        content: "What supports Claim A?",
        sourceIds: [],
      }),
      turn({
        messageId: "a1",
        role: "assistant",
        content: "Notice letter supports element 1.",
        sourceIds: ["good-doc", "foreign-doc"],
      }),
    ];
    const sanitized = restrictTurnSourceIds(turns, ["good-doc"]);
    expect(sanitized[1]?.sourceIds).toEqual(["good-doc"]);
    expect(sanitized[1]?.sourceIds).not.toContain("foreign-doc");
  });

  it("selected-domain diagnostics are present", () => {
    const plan = planConversationalContext({
      question: "What motions are pending?",
      priorSourceCount: 2,
      priorAuthorityCount: 1,
    });
    expect(plan.diagnostics.routerLatencyMs).toBeGreaterThanOrEqual(0);
    expect(plan.diagnostics.sourceCount).toBe(2);
    expect(plan.selectedDomains.length).toBeGreaterThan(0);
    expect(plan.skippedDomains).toContain("WHOLE_MATTER");
  });
});
