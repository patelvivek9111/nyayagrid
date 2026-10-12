import { describe, expect, it } from "vitest";
import { planConversationalContext } from "./conversational-context-router";
import {
  CONVERSATION_CONTEXT_MAX_CHARS,
  CONVERSATION_RECENT_TURN_LIMIT,
  emptyWorkingState,
  formatConversationContextForPrompt,
  selectRecentTurns,
  type ConversationTurnForPrompt,
  type ConversationWorkingState,
} from "./conversation-context";
import {
  ageActiveWorkingState,
  detectReferentRequest,
  resolveConversationalReferents,
  validateReferentAgainstMatter,
  type MatterEntityCandidate,
} from "./conversational-referent-resolver";
import { evaluatePremiseAgainstRecord } from "@nyayagrid/ai";

const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const MATTER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const FOREIGN_MATTER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee3";
const FOREIGN_ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee4";

const claimA = "11111111-1111-4111-8111-111111111111";
const claimB = "22222222-2222-4222-8222-222222222222";
const motion1 = "33333333-3333-4333-8333-333333333333";
const motion2 = "44444444-4444-4444-8444-444444444444";
const src1 = "55555555-5555-4555-8555-555555555555";
const src2 = "66666666-6666-4666-8666-666666666666";
const auth1 = "77777777-7777-4777-8777-777777777777";
const auth2 = "88888888-8888-4888-8888-888888888888";
const def1 = "99999999-9999-4999-8999-999999999999";
const comm1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const foreignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function state(partial: Partial<ConversationWorkingState> = {}): ConversationWorkingState {
  return { ...emptyWorkingState(), ...partial };
}

function candidates(): MatterEntityCandidate[] {
  return [
    {
      entityType: "claim",
      entityId: claimA,
      label: "Claim A — breach",
      organizationId: ORG,
      matterId: MATTER,
      orderKey: "2025-01-01",
    },
    {
      entityType: "claim",
      entityId: claimB,
      label: "Claim B — warranty",
      organizationId: ORG,
      matterId: MATTER,
      orderKey: "2025-02-01",
    },
    {
      entityType: "motion",
      entityId: motion1,
      label: "Motion to Compel filed May 4",
      organizationId: ORG,
      matterId: MATTER,
      orderKey: "2025-05-04",
      linkedIds: { discovery_deficiency: [def1] },
    },
    {
      entityType: "motion",
      entityId: motion2,
      label: "Summary-judgment motion filed June 12",
      organizationId: ORG,
      matterId: MATTER,
      orderKey: "2025-06-12",
    },
    {
      entityType: "document",
      entityId: src1,
      label: "Cure notice",
      organizationId: ORG,
      matterId: MATTER,
    },
    {
      entityType: "document",
      entityId: src2,
      label: "Exhibit B",
      organizationId: ORG,
      matterId: MATTER,
    },
    {
      entityType: "authority",
      entityId: auth1,
      label: "347 F.3d 123",
      organizationId: ORG,
      matterId: MATTER,
      orderKey: "a",
    },
    {
      entityType: "authority",
      entityId: auth2,
      label: "412 F.3d 99",
      organizationId: ORG,
      matterId: MATTER,
      orderKey: "b",
    },
    {
      entityType: "discovery_deficiency",
      entityId: def1,
      label: "RFP 14 deficiency",
      organizationId: ORG,
      matterId: MATTER,
      linkedIds: { communication: [comm1], motion: [motion1] },
    },
    {
      entityType: "communication",
      entityId: comm1,
      label: "MAC follow-up email",
      organizationId: ORG,
      matterId: MATTER,
      orderKey: "2025-05-10",
    },
    {
      entityType: "motion",
      entityId: foreignId,
      label: "Foreign motion",
      organizationId: FOREIGN_ORG,
      matterId: FOREIGN_MATTER,
    },
  ];
}

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

describe("conversational referent resolver (Phase 3)", () => {
  it("A: show me the sources resolves prior sourceRefs", () => {
    const result = resolveConversationalReferents({
      question: "show me the sources",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeClaimIds: [claimA], activeSourceIds: [src1, src2] }),
      matterCandidates: candidates(),
      allowedSourceIds: [src1, src2],
      priorStructured: { sourceRefs: [src1, src2], messageId: "m1" },
      recentTurns: [
        turn({
          messageId: "m1",
          role: "assistant",
          content: "Claim A is partially supported.",
          sourceIds: [src1, src2],
        }),
      ],
    });
    expect(result.status).toBe("RESOLVED");
    expect(result.referents.map((r) => r.entityId)).toEqual(expect.arrayContaining([src1, src2]));
    expect(result.forceDomains).toEqual(expect.arrayContaining(["EVIDENCE", "CLAIMS"]));
  });

  it("B: what about Claim B switches active claim", () => {
    const result = resolveConversationalReferents({
      question: "what about Claim B?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeClaimIds: [claimA], activeSourceIds: [src1] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("RESOLVED");
    expect(result.referents[0]?.entityId).toBe(claimB);
    expect(result.activeStateAfter.activeClaimIds[0]).toBe(claimB);
    expect(result.activeStateAfter.activeClaimIds).not.toContain(claimA);
  });

  it("C: why? stays attached to latest active claim", () => {
    const result = resolveConversationalReferents({
      question: "why?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeClaimIds: [claimA] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("RESOLVED");
    expect(result.referents[0]?.entityId).toBe(claimA);
    expect(result.diagnostics.resolutionMethod).toBe("ACTIVE_CONTEXT");
  });

  it("D: what happened after that? uses motion timeline anchor", () => {
    const result = resolveConversationalReferents({
      question: "what happened after that?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeMotionIds: [motion1] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("RESOLVED");
    expect(result.referents[0]?.entityId).toBe(motion1);
    expect(result.forceDomains).toEqual(expect.arrayContaining(["MOTIONS", "TIMELINE"]));
  });

  it("E: did they respond? follows discovery context", () => {
    const result = resolveConversationalReferents({
      question: "did they respond?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeDeficiencyIds: [def1] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("RESOLVED");
    expect(result.referents.some((r) => r.entityId === def1)).toBe(true);
    expect(result.forceDomains).toContain("DISCOVERY");
  });

  it("F: what motion did that lead to? uses existing linkage only", () => {
    const result = resolveConversationalReferents({
      question: "what motion did that lead to?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeDeficiencyIds: [def1] }),
      matterCandidates: candidates(),
    });
    // deficiency chain + linked motion when present
    expect(result.status).toBe("RESOLVED");
    const ids = result.referents.map((r) => r.entityId);
    expect(ids).toContain(def1);
    expect(ids).toContain(motion1);
  });

  it("G: that case resolves unique active authority", () => {
    const result = resolveConversationalReferents({
      question: "is that case still good law?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeAuthorityIds: [auth1] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("RESOLVED");
    expect(result.referents[0]?.entityId).toBe(auth1);
  });

  it("H: that case with two active authorities returns ambiguity", () => {
    const result = resolveConversationalReferents({
      question: "what does that case hold?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeAuthorityIds: [auth1, auth2] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.userClarificationNeeded).toBe(true);
    expect(result.clarificationPrompt).toMatch(/Do you mean/i);
    expect(result.referents[0]?.entityId).toBeNull();
  });

  it("I: the second motion resolves deterministic list ordering", () => {
    const result = resolveConversationalReferents({
      question: "what about the second motion?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeMotionIds: [motion1, motion2] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("RESOLVED");
    expect(result.referents[0]?.entityId).toBe(motion2);
  });

  it("J: the other one ambiguous when >1 candidate", () => {
    const result = resolveConversationalReferents({
      question: "what about the other one?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeMotionIds: [motion1, motion2], activeClaimIds: [claimA] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.userClarificationNeeded).toBe(true);
  });

  it("K/L: foreign-matter and foreign-org IDs rejected", () => {
    expect(
      validateReferentAgainstMatter({
        entityId: foreignId,
        entityType: "motion",
        organizationId: ORG,
        matterId: MATTER,
        allowed: candidates().filter((c) => c.matterId === MATTER),
      }),
    ).toBe(false);

    const result = resolveConversationalReferents({
      question: "what happened with that motion?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeMotionIds: [foreignId] }),
      matterCandidates: candidates(),
    });
    // Foreign candidate filtered from scope — cannot resolve foreign id into this matter.
    expect(result.referents.every((r) => r.entityId !== foreignId)).toBe(true);
  });

  it("M: nonexistent entity rejected", () => {
    const ghost = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    expect(
      validateReferentAgainstMatter({
        entityId: ghost,
        entityType: "claim",
        organizationId: ORG,
        matterId: MATTER,
        allowed: candidates(),
      }),
    ).toBe(false);
  });

  it("N: failed/cancelled prior turn not used as referent source", () => {
    const result = resolveConversationalReferents({
      question: "show me the sources",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeSourceIds: [] }),
      allowedSourceIds: [src1, src2],
      matterCandidates: candidates(),
      recentTurns: [
        turn({
          messageId: "cancelled",
          role: "assistant",
          content: "partial",
          completionStatus: "cancelled",
          sourceIds: [src1],
        }),
        turn({
          messageId: "ok",
          role: "assistant",
          content: "grounded",
          completionStatus: "completed",
          sourceIds: [src2],
        }),
      ],
      priorStructured: { sourceRefs: [src2] },
    });
    expect(result.referents.map((r) => r.entityId)).toContain(src2);
    // Latest authoritative assistant is preferred; cancelled turn is not the sole source.
    expect(result.status).toBe("RESOLVED");
    expect(result.referents[0]?.sourceMessageId).not.toBe("cancelled");
  });

  it("O: active context ages old entities out", () => {
    const aged = ageActiveWorkingState({
      prior: state({
        activeClaimIds: [claimA, claimB],
        activeMotionIds: [motion1, motion2],
      }),
      promote: [
        {
          entityType: "claim",
          entityId: claimB,
          label: "Claim B",
          matterId: MATTER,
          organizationId: ORG,
          resolutionMethod: "EXPLICIT_LABEL",
          sourceMessageId: null,
          confidenceCategory: "deterministic",
          ambiguityStatus: "NONE",
        },
      ],
      replaceTypes: ["claim"],
    });
    expect(aged.activeClaimIds).toEqual([claimB]);
    expect(aged.activeMotionIds.length).toBeLessThanOrEqual(3);
  });

  it("P: referent resolution does not expand full transcript", () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      turn({
        messageId: `m${i}`,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Turn ${i} `.repeat(40),
      }),
    );
    const recent = selectRecentTurns(many, CONVERSATION_RECENT_TURN_LIMIT);
    expect(recent.length).toBeLessThanOrEqual(CONVERSATION_RECENT_TURN_LIMIT);
    const block = formatConversationContextForPrompt({
      recentTurns: recent,
      summaryLines: ["Active topic: Claim A"],
      workingState: state({ activeClaimIds: [claimA] }),
    });
    expect(block!.length).toBeLessThanOrEqual(CONVERSATION_CONTEXT_MAX_CHARS);
    expect(detectReferentRequest("show me the sources").requested).toBe(true);
  });

  it("Q: router changes correctly after referent resolution", () => {
    const resolved = resolveConversationalReferents({
      question: "what happened after that?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeMotionIds: [motion1] }),
      matterCandidates: candidates(),
    });
    const plan = planConversationalContext({
      question: resolved.routingQuestion,
      forceDomains: resolved.forceDomains,
    });
    expect(plan.selectedDomains).toEqual(expect.arrayContaining(["MOTIONS", "TIMELINE"]));
    expect(plan.wholeMatterUsed).toBe(false);
    expect(resolved.diagnostics.routerDomainsAfterResolution.length).toBeGreaterThanOrEqual(0);
  });

  it("R: Phase 2 factuality behavior remains intact", () => {
    const premise = evaluatePremiseAgainstRecord({
      question: "We won the motion, right?",
      record: { persistedDispositions: [] },
    });
    expect(premise.result).toBe("UNSUPPORTED");
  });
});

describe("Phase 3 multi-turn chains", () => {
  it("CHAIN 1 — claim support → sources → missing → Claim B", () => {
    let ws = state({ activeClaimIds: [claimA], activeSourceIds: [src1] });
    const t1 = resolveConversationalReferents({
      question: "What supports Claim A?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: ws,
      matterCandidates: candidates(),
    });
    expect(t1.referents[0]?.entityId).toBe(claimA);
    ws = t1.activeStateAfter;

    const t2 = resolveConversationalReferents({
      question: "show me the sources",
      organizationId: ORG,
      matterId: MATTER,
      workingState: ws,
      matterCandidates: candidates(),
      allowedSourceIds: [src1],
      priorStructured: { sourceRefs: [src1] },
    });
    expect(t2.status).toBe("RESOLVED");
    expect(t2.activeStateAfter.activeClaimIds[0]).toBe(claimA);

    const t3 = resolveConversationalReferents({
      question: "what is still missing?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: t2.activeStateAfter,
      matterCandidates: candidates(),
    });
    expect(t3.referents[0]?.entityId).toBe(claimA);

    const t4 = resolveConversationalReferents({
      question: "what about Claim B?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: t3.activeStateAfter,
      matterCandidates: candidates(),
    });
    expect(t4.activeStateAfter.activeClaimIds[0]).toBe(claimB);
  });

  it("CHAIN 2 — discovery → respond → follow-up → motion link", () => {
    const ws = state({ activeDeficiencyIds: [def1], activeDiscoveryIds: [def1] });
    const t1 = resolveConversationalReferents({
      question: "did they respond?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: ws,
      matterCandidates: candidates(),
    });
    expect(t1.status).toBe("RESOLVED");
    const t2 = resolveConversationalReferents({
      question: "what motion did that lead to?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: t1.activeStateAfter,
      matterCandidates: candidates(),
    });
    expect(t2.referents.some((r) => r.entityId === motion1)).toBe(true);
  });

  it("CHAIN 3 — motion → ruling → why → after that", () => {
    let ws = state({ activeMotionIds: [motion1] });
    const t1 = resolveConversationalReferents({
      question: "What happened with the motion to compel?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: ws,
      matterCandidates: candidates(),
    });
    expect(t1.referents[0]?.entityId).toBe(motion1);
    ws = t1.activeStateAfter;

    const t2 = resolveConversationalReferents({
      question: "what did the judge rule?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: ws,
      matterCandidates: candidates(),
    });
    expect(t2.referents[0]?.entityId).toBe(motion1);

    const t3 = resolveConversationalReferents({
      question: "why?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ ...t2.activeStateAfter, activeClaimIds: [claimA] }),
      matterCandidates: candidates(),
    });
    // why attaches to claim when present
    expect(t3.referents[0]?.entityType).toBe("claim");

    const t4 = resolveConversationalReferents({
      question: "what happened after that?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: t2.activeStateAfter,
      matterCandidates: candidates(),
    });
    expect(t4.forceDomains).toContain("TIMELINE");
  });

  it("CHAIN 4 — authority first case → good law", () => {
    const ws = state({ activeAuthorityIds: [auth1, auth2] });
    const t1 = resolveConversationalReferents({
      question: "what does the first case hold?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: ws,
      matterCandidates: candidates(),
    });
    expect(t1.status).toBe("RESOLVED");
    expect(t1.referents[0]?.entityId).toBe(auth1);

    const t2 = resolveConversationalReferents({
      question: "is that still good law?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: t1.activeStateAfter,
      matterCandidates: candidates(),
    });
    expect(t2.status).toBe("RESOLVED");
    expect(t2.referents[0]?.entityId).toBe(auth1);
  });

  it("CHAIN 5 — two motions → that motion asks clarification (auto-pick = 0)", () => {
    const result = resolveConversationalReferents({
      question: "what happened with that motion?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: state({ activeMotionIds: [motion1, motion2] }),
      matterCandidates: candidates(),
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.referents.every((r) => r.entityId == null)).toBe(true);
    expect(result.clarificationPrompt).toMatch(/motion to compel|summary-judgment/i);
  });
});
