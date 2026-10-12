import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeAskContextText } from "./nyaya";
import {
  CONVERSATION_CONTEXT_MAX_CHARS,
  CONVERSATION_RECENT_TURN_LIMIT,
  buildCompactSummaryLines,
  buildNextWorkingState,
  emptyWorkingState,
  formatConversationContextForPrompt,
  isAuthoritativeAssistantTurn,
  mergeWorkingStates,
  parseWorkingState,
  restrictTurnSourceIds,
  selectRecentTurns,
  truncateTurnContent,
  type ConversationTurnForPrompt,
} from "./conversation-context";

const root = resolve(__dirname, "../../..");

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

describe("conversation-context foundation (Phase 1)", () => {
  it("keeps user turns and completed assistant turns; drops cancelled/failed", () => {
    expect(
      isAuthoritativeAssistantTurn({
        role: "assistant",
        content: "[Generation stopped]",
        completionStatus: "cancelled",
      }),
    ).toBe(false);
    expect(
      isAuthoritativeAssistantTurn({
        role: "assistant",
        content: "ok",
        completionStatus: "failed",
      }),
    ).toBe(false);
    expect(
      isAuthoritativeAssistantTurn({
        role: "assistant",
        content: "Grounded answer",
        completionStatus: "completed",
      }),
    ).toBe(true);
    expect(isAuthoritativeAssistantTurn({ role: "user", content: "What supports Claim A?" })).toBe(
      true,
    );
  });

  it("bounds recent turns and does not dump full transcript", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      turn({
        messageId: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i} `.repeat(20),
      }),
    );
    const selected = selectRecentTurns(many, CONVERSATION_RECENT_TURN_LIMIT);
    expect(selected.length).toBe(CONVERSATION_RECENT_TURN_LIMIT);
    expect(selected[0]?.messageId).toBe("m32");
    expect(selected.at(-1)?.messageId).toBe("m39");

    const block = formatConversationContextForPrompt({
      recentTurns: selected,
      summaryLines: ["Active topic: Claim A / breach"],
      workingState: emptyWorkingState(),
    });
    expect(block).toContain("CONVERSATION_CONTEXT");
    expect(block!.length).toBeLessThanOrEqual(CONVERSATION_CONTEXT_MAX_CHARS);
    expect(block).not.toContain("Turn 0");
  });

  it("excludes cancelled assistant content from the window", () => {
    const turns = [
      turn({ messageId: "u1", role: "user", content: "What is happening?" }),
      turn({
        messageId: "a1",
        role: "assistant",
        content: "[Generation stopped]",
        completionStatus: "cancelled",
      }),
      turn({ messageId: "u2", role: "user", content: "What supports Claim A?" }),
      turn({ messageId: "a2", role: "assistant", content: "Notice evidence supports element 1." }),
    ];
    const selected = selectRecentTurns(turns);
    expect(selected.map((t) => t.messageId)).toEqual(["u1", "u2", "a2"]);
    expect(selected.every((t) => t.content !== "[Generation stopped]")).toBe(true);
  });

  it("never upgrades IDENTITY_UNRESOLVED authority via conversational merge", () => {
    const prior = emptyWorkingState();
    prior.authorityStates = [
      { id: "auth-1", resolution: "IDENTITY_UNRESOLVED", treatmentVerified: false },
    ];
    const merged = mergeWorkingStates(prior, {
      authorityStates: [{ id: "auth-1", resolution: "AUTHORITY_RESOLVED", treatmentVerified: true }],
    });
    expect(merged.authorityStates[0]?.resolution).toBe("IDENTITY_UNRESOLVED");
    expect(merged.authorityStates[0]?.treatmentVerified).toBe(false);
  });

  it("builds summary from topics/open questions without speculative conclusions", () => {
    const summary = buildCompactSummaryLines({
      prior: {
        ...emptyWorkingState(),
        unresolvedQuestions: ["Is the cure notice authenticated?"],
      },
      recentTurns: [
        turn({ messageId: "u1", role: "user", content: "What supports Claim A breach?" }),
        turn({
          messageId: "a1",
          role: "assistant",
          content: "Insufficient evidence on damages.",
          evidenceState: "insufficient",
        }),
      ],
      currentQuestion: "show me the sources",
    });
    expect(summary.some((l) => /Claim A/i.test(l))).toBe(true);
    expect(summary.some((l) => /insufficient evidence/i.test(l))).toBe(true);
    expect(summary.some((l) => /Open: Is the cure notice/i.test(l))).toBe(true);
    expect(summary.join(" ")).not.toMatch(/\b(will win|liable|dishonest)\b/i);
  });

  it("retains source IDs in formatted context for continuity", () => {
    const ws = buildNextWorkingState({
      prior: null,
      recentTurns: [
        turn({
          messageId: "a1",
          role: "assistant",
          content: "Notice supports Claim A.",
          sourceIds: ["doc-notice"],
        }),
      ],
      currentQuestion: "why?",
      sourceIds: ["doc-notice", "doc-log"],
      authorityIds: ["auth-resolved"],
      unresolvedQuestions: [],
    });
    expect(ws.activeSourceIds).toEqual(expect.arrayContaining(["doc-notice", "doc-log"]));
    const block = formatConversationContextForPrompt({
      recentTurns: [
        turn({
          messageId: "a1",
          role: "assistant",
          content: "Notice supports Claim A.",
          sourceIds: ["doc-notice"],
        }),
      ],
      summaryLines: ws.summaryLines,
      workingState: ws,
    });
    expect(block).toContain("doc-notice");
    expect(block).toContain("sources=");
  });

  it("strips foreign source IDs from turns before prompt injection", () => {
    const dirty = [
      turn({
        messageId: "a1",
        role: "assistant",
        content: "The cure notice supports Claim A.",
        sourceIds: ["doc-notice", "doc-foreign"],
      }),
    ];
    const clean = restrictTurnSourceIds(dirty, ["doc-notice"]);
    expect(clean[0]!.sourceIds).toEqual(["doc-notice"]);
    const ws = buildNextWorkingState({
      prior: null,
      recentTurns: clean,
      currentQuestion: "show me the sources",
      sourceIds: ["doc-notice"],
      authorityIds: [],
      unresolvedQuestions: [],
    });
    const block = formatConversationContextForPrompt({
      recentTurns: clean,
      summaryLines: ws.summaryLines,
      workingState: ws,
    });
    expect(block).toContain("doc-notice");
    expect(block).not.toContain("doc-foreign");
    expect(ws.activeSourceIds).not.toContain("doc-foreign");
  });

  it("parses working state from artifact validation JSON", () => {
    const parsed = parseWorkingState({
      version: 1,
      summaryLines: ["Active topic: Discovery"],
      activeSourceIds: ["d1"],
      activeAuthorityIds: [],
      authorityStates: [
        { id: "a1", resolution: "CORPUS_COMPLETE", treatmentVerified: false },
      ],
      updatedAt: "2026-10-12T00:00:00.000Z",
    });
    expect(parsed?.summaryLines).toEqual(["Active topic: Discovery"]);
    expect(parsed?.authorityStates[0]?.resolution).toBe("CORPUS_COMPLETE");
    expect(parsed?.authorityStates[0]?.treatmentVerified).toBe(false);
  });

  it("truncates oversized turn content", () => {
    const long = "x".repeat(5_000);
    expect(truncateTurnContent(long).length).toBeLessThan(long.length);
    expect(truncateTurnContent(long).endsWith("…")).toBe(true);
  });

  it("keeps conversation-specific formatting markers for Ask merge", () => {
    const block = formatConversationContextForPrompt({
      recentTurns: [turn({ messageId: "u1", role: "user", content: "status?" })],
      summaryLines: [],
      workingState: emptyWorkingState(),
    });
    expect(block).toContain("trustBoundary=prior_turns_are_working_context_not_new_evidence");
    expect(block).toContain("Do not invent facts from conversation memory");
  });

  it("wires conversation context assembly into askNyayaAboutMatter without schema migration", () => {
    const src = readFileSync(resolve(root, "packages/search/src/nyaya.ts"), "utf8");
    expect(src).toContain("assembleConversationAskContext");
    expect(src).toContain("conversationWorkingState");
    expect(src).toContain("assertionReady");
    const merged = mergeAskContextText(
      "CONVERSATION_CONTEXT\n- prior",
      "WHOLE_MATTER_INTELLIGENCE",
    );
    expect(merged).toContain("CONVERSATION_CONTEXT");
    expect(merged).toContain("WHOLE_MATTER_INTELLIGENCE");
  });
});
