import { describe, expect, it } from "vitest";
import {
  answerWholeMatterQuestion,
  assembleWholeMatterIntelligence,
  buildWholeMatterAskContextBlock,
  formatWholeMatterAnswer,
  isWholeMatterAskQuestion,
  planWholeMatterGraph,
  resolveAuthorityResolutionBucket,
  runPass7WholeMatterFixture,
} from "./index";
import type { WholeMatterIntelligence } from "./types";

describe("Pass 7 whole-matter intelligence", () => {
  const { intelligence: wm, ids } = runPass7WholeMatterFixture();

  it("assembles claim, discovery, motion, and authority convergence without decisive conclusions", () => {
    expect(wm.claims.some((c) => c.claimId === ids.claimBreach)).toBe(true);
    expect(wm.defenses.some((d) => d.defenseId === ids.defense)).toBe(true);
    expect(wm.openDeficiencyIds.length).toBeGreaterThan(0);
    expect(wm.motions.some((m) => m.motionId === ids.motionCompel)).toBe(true);
    expect(wm.communications.some((c) => c.id === ids.macComm)).toBe(true);
    expect(wm.authorities.map((a) => a.resolution)).toEqual(
      expect.arrayContaining(["AUTHORITY_RESOLVED", "CORPUS_COMPLETE", "IDENTITY_UNRESOLVED"]),
    );
    expect(wm.liabilityConclusion).toBeNull();
    expect(wm.predictiveOutcome).toBeNull();
    expect(wm.claims.every((c) => c.wholeClaimDisposedByMotion === false)).toBe(true);
    expect(wm.motions.every((m) => m.disposesEntireClaim === false)).toBe(true);
  });

  it("surfaces grounded investigate-next items from gaps only", () => {
    expect(wm.investigateNext.length).toBeGreaterThan(0);
    expect(wm.investigateNext.every((i) => i.predictiveOutcome === null)).toBe(true);
    expect(wm.investigateNext.every((i) => i.why.length > 0 && i.resolvesIf.length > 0)).toBe(true);
    expect(wm.investigateNext.some((i) => /deficiency|evidence gap|authority|overdue|conflict/i.test(i.title + i.why))).toBe(
      true,
    );
  });

  it("answers whole-matter Ask questions with abstention on unsupported predictions", () => {
    expect(isWholeMatterAskQuestion("Give me the complete status of this matter.")).toBe(true);
    expect(isWholeMatterAskQuestion("What motions are pending?")).toBe(false);

    const status = answerWholeMatterQuestion({
      intelligence: wm,
      question: "Give me the complete status of this matter.",
    });
    expect(status.statusFlags.length).toBeGreaterThan(0);
    expect(status.motions.some((m) => m.id === ids.motionCompel)).toBe(true);

    const chain = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What communications led to the motion to compel?",
    });
    expect(chain.communications.some((c) => c.id === ids.macComm)).toBe(true);

    const ruling = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What did the court actually rule?",
    });
    expect(ruling.motions.some((m) => m.disposition === "GRANTED_IN_PART")).toBe(true);

    const abstain = answerWholeMatterQuestion({
      intelligence: wm,
      question: "Will we win because the witness is lying?",
    });
    expect(abstain.predictiveOutcome).toBeNull();
    expect(abstain.credibilityConclusion).toBeNull();
    expect(formatWholeMatterAnswer(abstain)).toContain("PREDICTIVE_OUTCOME: null");
    expect(abstain.limitations.some((l) => /predictive|credibility/i.test(l))).toBe(true);

    const next = answerWholeMatterQuestion({
      intelligence: wm,
      question: "What should we investigate next?",
    });
    expect(next.investigateNext.length).toBeGreaterThan(0);

    expect(
      buildWholeMatterAskContextBlock({
        question: "Give me the complete status of this matter.",
        intelligence: wm,
      }),
    ).toContain("WHOLE_MATTER_INTELLIGENCE");
  });

  it("keeps assembly bounded for repeated fixture builds", () => {
    const t0 = performance.now();
    let last = wm;
    for (let i = 0; i < 20; i++) {
      last = runPass7WholeMatterFixture().intelligence;
    }
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(2000);
    expect(last.claims.length).toBe(wm.claims.length);
    expect(last.motions.length).toBe(wm.motions.length);
    void assembleWholeMatterIntelligence;
  });

  it("marks cross-matter isolation on fixture scope ids", () => {
    expect(wm.organizationId).toBeTruthy();
    expect(wm.matterId).toBeTruthy();
    expect(wm.motions.every((m) => m.motionId)).toBe(true);
    expect(wm.communications.every((c) => c.id)).toBe(true);
  });

  it("never maps failed/processing authority ingestion to AUTHORITY_RESOLVED", () => {
    expect(resolveAuthorityResolutionBucket({ ingestionStatus: "failed" })).toBe("IDENTITY_UNRESOLVED");
    expect(resolveAuthorityResolutionBucket({ ingestionStatus: "processing" })).toBe(
      "IDENTITY_UNRESOLVED",
    );
    expect(resolveAuthorityResolutionBucket({ ingestionStatus: "pending" })).toBe("IDENTITY_UNRESOLVED");
    expect(resolveAuthorityResolutionBucket({ ingestionStatus: null })).toBe("IDENTITY_UNRESOLVED");
    expect(resolveAuthorityResolutionBucket({ ingestionStatus: "ready" })).toBe("AUTHORITY_RESOLVED");
    expect(
      resolveAuthorityResolutionBucket({
        ingestionStatus: "pending",
        metadata: { corpusComplete: true },
      }),
    ).toBe("CORPUS_COMPLETE");
  });

  it("bounds openGaps per claim and surfaces treatment UNKNOWN honestly in Ask", () => {
    const inflated: WholeMatterIntelligence = {
      ...wm,
      claims: wm.claims.map((c) => ({
        ...c,
        openGaps: Array.from({ length: 40 }, (_, i) => `Gap ${i} for ${c.claimId}`),
      })),
    };
    const answer = answerWholeMatterQuestion({
      intelligence: inflated,
      question: "Give me the complete status of this matter.",
    });
    expect(answer.claims.every((c) => c.openGaps.length <= 5)).toBe(true);
    expect(answer.authorities.every((a) => typeof a.treatmentVerified === "boolean")).toBe(true);
    expect(formatWholeMatterAnswer(answer)).toMatch(/treatment=(VERIFIED|UNKNOWN)/);
    expect(formatWholeMatterAnswer(answer)).toContain("treatment=UNKNOWN");
  });

  it("plans Graph edges from the same read-model truth without duplicate keys", () => {
    const graph = planWholeMatterGraph(wm);
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(new Set(graph.nodes.map((n) => n.key)).size).toBe(graph.nodes.length);
    expect(graph.edges.some((e) => e.relationshipType.includes("MOTION") || e.relationshipType.includes("CLAIM"))).toBe(
      true,
    );
    // IDENTITY_UNRESOLVED authorities must not appear as graph nodes
    expect(graph.nodes.some((n) => n.entityId === ids.authorityUnresolved)).toBe(false);
  });

  it("keeps large synthetic assembly + graph + ask under a bounded budget", () => {
    const base = runPass7WholeMatterFixture().intelligence;
    const large: WholeMatterIntelligence = {
      ...base,
      propositions: Array.from({ length: 400 }, (_, i) => ({
        id: `prop-${i}`,
        kind: "evidence" as const,
        label: `Evidence slice ${i}`,
        supportingSourceIds: [`doc-${i % 200}`],
        contradictingSourceIds: i % 17 === 0 ? [`doc-${(i + 1) % 200}`] : [],
        relationHints: ["SUPPORTS" as const],
        relatedClaimIds: [base.claims[0]?.claimId ?? "c1"],
        relatedDefenseIds: [],
        status: "recorded",
      })),
      sourceRefs: Array.from({ length: 300 }, (_, i) => ({
        kind: "document" as const,
        id: `doc-${i}`,
        label: `Doc ${i}`,
      })),
      motions: Array.from({ length: 60 }, (_, i) => ({
        ...(base.motions[0] ?? {
          motionId: "m0",
          title: "Motion",
          status: "FILED",
          disposition: null,
          pending: true,
          relatedClaimIds: [],
          relatedDefenseIds: [],
          relatedDeficiencyIds: [],
          relatedCommunicationIds: [],
          relatedEvidenceIds: [],
          documentRoles: [],
          hearingAt: null,
          rulingAt: null,
          rulingSummary: null,
          relatedTaskIds: [],
          relatedDeadlineIds: [],
          disposesEntireClaim: false as const,
        }),
        motionId: `00000000-0000-4000-8000-00000000m${String(i).padStart(2, "0")}`,
        title: `Scaled motion ${i}`,
        pending: i % 3 === 0,
      })),
      communications: Array.from({ length: 220 }, (_, i) => ({
        id: `00000000-0000-4000-8000-00000000c${String(i).padStart(2, "0")}`,
        subject: `Comm ${i}`,
        communicationType: "EMAIL",
        occurredAt: `2025-0${(i % 9) + 1}-15T12:00:00.000Z`,
        relatedMotionIds: i % 5 === 0 ? [base.motions[0]?.motionId ?? "m0"] : [],
        relatedDeficiencyIds: [],
        followUpDueAt: null,
      })),
      tasks: Array.from({ length: 80 }, (_, i) => ({
        id: `task-${i}`,
        title: `Task ${i}`,
        status: i % 4 === 0 ? "completed" : "open",
        dueAt: `2025-12-${String((i % 28) + 1).padStart(2, "0")}T23:59:00.000Z`,
        overdue: i % 7 === 0,
      })),
      timeline: Array.from({ length: 120 }, (_, i) => ({
        id: `tl-${i}`,
        title: `Event ${i}`,
        eventType: "fact_event",
        eventDate: `2025-0${(i % 9) + 1}-10T12:00:00.000Z`,
        dateKind: "event" as const,
      })),
    };

    const t0 = performance.now();
    const graph = planWholeMatterGraph(large);
    const answer = answerWholeMatterQuestion({
      intelligence: large,
      question: "Give me the complete status of this matter.",
    });
    const ctx = buildWholeMatterAskContextBlock({
      question: "Give me the complete status of this matter.",
      intelligence: large,
    });
    const elapsed = performance.now() - t0;

    expect(graph.nodes.length).toBeGreaterThan(50);
    expect(answer.summaryLines.length).toBeGreaterThan(0);
    expect(ctx).toContain("WHOLE_MATTER_INTELLIGENCE");
    // Context must stay bounded — not dump every proposition id
    expect((ctx ?? "").length).toBeLessThan(80_000);
    expect(elapsed).toBeLessThan(750);
  });
});
