/**
 * Nyaya Conversational Workspace Phase 3 — live certification gates.
 * Full DB Ask chains require SHARED_RUNTIME_LOCK + RUN_DB_TESTS=1.
 * CourtListener: 0. Schema: NONE.
 */
import { describe, expect, it } from "vitest";
import { planConversationalContext } from "./conversational-context-router";
import {
  ageActiveWorkingState,
  resolveConversationalReferents,
  type MatterEntityCandidate,
} from "./conversational-referent-resolver";
import { emptyWorkingState } from "./conversation-context";

const runDbTests = process.env.RUN_DB_TESTS === "1";
const ORG = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1";
const MATTER = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee2";
const claimA = "11111111-1111-4111-8111-111111111111";
const claimB = "22222222-2222-4222-8222-222222222222";
const motion1 = "33333333-3333-4333-8333-333333333333";
const motion2 = "44444444-4444-4444-8444-444444444444";
const src1 = "55555555-5555-4555-8555-555555555555";
const auth1 = "77777777-7777-4777-8777-777777777777";
const foreignId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const candidates: MatterEntityCandidate[] = [
  {
    entityType: "claim",
    entityId: claimA,
    label: "Claim A — breach",
    organizationId: ORG,
    matterId: MATTER,
  },
  {
    entityType: "claim",
    entityId: claimB,
    label: "Claim B — warranty",
    organizationId: ORG,
    matterId: MATTER,
  },
  {
    entityType: "motion",
    entityId: motion1,
    label: "Motion to Compel filed May 4",
    organizationId: ORG,
    matterId: MATTER,
    orderKey: "2025-05-04",
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
    entityType: "authority",
    entityId: auth1,
    label: "347 F.3d 123",
    organizationId: ORG,
    matterId: MATTER,
  },
];

describe("Phase 3 referent live-cert static gates", () => {
  it("SCENARIO 1 claim chain continuity", () => {
    let ws = {
      ...emptyWorkingState(),
      activeClaimIds: [claimA],
      activeSourceIds: [src1],
    };
    const sources = resolveConversationalReferents({
      question: "show me the sources",
      organizationId: ORG,
      matterId: MATTER,
      workingState: ws,
      matterCandidates: candidates,
      allowedSourceIds: [src1],
      priorStructured: { sourceRefs: [src1] },
    });
    expect(sources.status).toBe("RESOLVED");
    ws = sources.activeStateAfter;
    const missing = resolveConversationalReferents({
      question: "what is still missing?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: ws,
      matterCandidates: candidates,
    });
    expect(missing.referents[0]?.entityId).toBe(claimA);
  });

  it("SCENARIO 2 claim switch", () => {
    const result = resolveConversationalReferents({
      question: "What about Claim B?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeClaimIds: [claimA] },
      matterCandidates: candidates,
    });
    expect(result.activeStateAfter.activeClaimIds[0]).toBe(claimB);
  });

  it("SCENARIO 6 ambiguity — two motions", () => {
    const result = resolveConversationalReferents({
      question: "what happened with that motion?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeMotionIds: [motion1, motion2] },
      matterCandidates: candidates,
    });
    expect(result.status).toBe("AMBIGUOUS");
    expect(result.referents.every((r) => r.entityId == null)).toBe(true);
  });

  it("SCENARIO 7 cross-matter attack rejected", () => {
    const result = resolveConversationalReferents({
      question: "what happened with that motion?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeMotionIds: [foreignId] },
      matterCandidates: candidates,
    });
    expect(result.referents.every((r) => r.entityId !== foreignId)).toBe(true);
  });

  it("router follows referent force domains", () => {
    const resolved = resolveConversationalReferents({
      question: "what happened after that?",
      organizationId: ORG,
      matterId: MATTER,
      workingState: { ...emptyWorkingState(), activeMotionIds: [motion1] },
      matterCandidates: candidates,
    });
    const plan = planConversationalContext({
      question: resolved.routingQuestion,
      forceDomains: resolved.forceDomains,
    });
    expect(plan.selectedDomains).toEqual(expect.arrayContaining(["MOTIONS", "TIMELINE"]));
  });

  it("aging prunes superseded claim focus", () => {
    const aged = ageActiveWorkingState({
      prior: { ...emptyWorkingState(), activeClaimIds: [claimA, claimB] },
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
  });
});

describe.runIf(runDbTests)("Phase 3 live certification (local DB — lock required)", () => {
  it("placeholder: full Ask chains run only after SHARED_RUNTIME_LOCK grant", () => {
    expect(process.env.DATABASE_URL ?? "").toMatch(/localhost:5433|127\.0\.0\.1:5433/);
  });
});
