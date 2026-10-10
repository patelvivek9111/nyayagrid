import { describe, expect, it } from "vitest";
import {
  answerMotionsCommunicationsQuestion,
  buildMotionsCommunicationsAskContextBlock,
  buildPass6LitigationFixtureReview,
  formatMotionsCommunicationsAnswer,
  isMotionsCommunicationsAskQuestion,
  isPendingMotionStatus,
  planMotionsCommunicationsGraph,
  planMotionsCommunicationsTimelineEvents,
  runPass6LitigationFixture,
} from "./index";

describe("Pass 6 motions/communications domain", () => {
  const { review, ids } = runPass6LitigationFixture();

  it("classifies pending vs terminal motion statuses", () => {
    expect(isPendingMotionStatus("FILED")).toBe(true);
    expect(isPendingMotionStatus("GRANTED_IN_PART")).toBe(false);
  });

  it("answers pending motion and discovery-chain questions without inventing outcomes", () => {
    const pending = answerMotionsCommunicationsQuestion({
      review,
      question: "What motions are pending?",
    });
    expect(pending.pendingMotionIds).toContain(ids.motionPending);
    expect(pending.pendingMotionIds).not.toContain(ids.motionCompel);
    expect(pending.predictiveOutcome).toBeNull();

    const compel = answerMotionsCommunicationsQuestion({
      review,
      question: "What discovery deficiencies led to the motion to compel?",
    });
    const compelMotion = compel.motions.find((m) => m.id === ids.motionCompel)!;
    expect(compelMotion.relatedDeficiencyIds).toContain(ids.deficiencyId);
    expect(compelMotion.disposition).toBe("GRANTED_IN_PART");
    expect(compelMotion.relatedClaimIds).toContain(ids.claimId);

    const text = formatMotionsCommunicationsAnswer(compel);
    expect(text).toContain("SANCTIONS_CONCLUSION: null");
    expect(text).not.toMatch(/\bwill win\b|\bbad faith\b|\bstonewall/i);
  });

  it("traces communication chronology before motion filing", () => {
    const answer = answerMotionsCommunicationsQuestion({
      review,
      question: "What communications occurred before the motion was filed?",
    });
    expect(answer.communications.map((c) => c.id)).toEqual(
      expect.arrayContaining([ids.macComm, ids.followComm]),
    );
    expect(answer.communications.every((c) => c.occurredAt && c.occurredAt < "2025-10-16")).toBe(
      true,
    );
  });

  it("lists only explicit deadlines", () => {
    const answer = answerMotionsCommunicationsQuestion({
      review,
      question: "What deadlines are associated with the motion?",
    });
    expect(answer.explicitDeadlines.some((d) => d.label === "hearing")).toBe(true);
    expect(answer.explicitDeadlines.some((d) => d.label === "opposition due")).toBe(true);
    expect(answer.limitations.some((l) => /No jurisdictional deadline was calculated/i.test(l))).toBe(
      true,
    );
  });

  it("gates Ask context injection", () => {
    expect(isMotionsCommunicationsAskQuestion("What motions are pending?")).toBe(true);
    expect(isMotionsCommunicationsAskQuestion("What is on the calendar?")).toBe(false);
    expect(
      buildMotionsCommunicationsAskContextBlock({
        question: "What did the court rule on the motion to compel?",
        review,
      }),
    ).toContain("GRANTED_IN_PART");
  });

  it("plans idempotent graph nodes/edges for the litigation spine", () => {
    const plan = planMotionsCommunicationsGraph(review);
    expect(plan.nodes.some((n) => n.nodeType === "motion" && n.canonicalEntityId === ids.motionCompel)).toBe(
      true,
    );
    expect(
      plan.nodes.some((n) => n.nodeType === "communication" && n.canonicalEntityId === ids.macComm),
    ).toBe(true);
    expect(plan.edges.some((e) => e.relationshipType === "relates_to_deficiency")).toBe(true);
    expect(plan.edges.some((e) => e.relationshipType === "order_resolves_motion")).toBe(true);
    const nodeKeys = plan.nodes.map((n) => `${n.canonicalEntityType}:${n.canonicalEntityId}`);
    expect(new Set(nodeKeys).size).toBe(nodeKeys.length);
    const edgeKeys = plan.edges.map((e) => `${e.fromKey}|${e.relationshipType}|${e.toKey}`);
    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
  });

  it("plans timeline events only from explicit dates", () => {
    const events = planMotionsCommunicationsTimelineEvents(review);
    expect(events.some((e) => e.eventType === "motion_filed")).toBe(true);
    expect(events.some((e) => e.eventType === "motion_ruled")).toBe(true);
    expect(events.some((e) => e.eventType === "meet_and_confer")).toBe(true);
    expect(events.every((e) => e.eventDate instanceof Date)).toBe(true);
    const keys = events.map((e) => e.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("does not treat claim linkage as whole-claim disposition", () => {
    const answer = answerMotionsCommunicationsQuestion({
      review,
      question: "Which claim is this motion related to?",
    });
    const motion = answer.motions.find((m) => m.id === ids.motionCompel)!;
    expect(motion.relatedClaimIds).toContain(ids.claimId);
    expect(motion.disposition).toBe("GRANTED_IN_PART");
    expect(answer.limitations.some((l) => /does not mean the court disposed/i.test(l))).toBe(true);
  });

  it("handles 50+ motions and hundreds of communications without N+1 planning", () => {
    const base = buildPass6LitigationFixtureReview();
    const motions = Array.from({ length: 55 }, (_, i) => ({
      ...base.motions[0]!,
      id: `00000000-0000-4000-8000-00000000m${String(i).padStart(2, "0")}`,
      title: `Scale motion ${i}`,
      status: i % 7 === 0 ? "FILED" : "GRANTED_IN_PART",
      filedAt: new Date(`2025-0${(i % 9) + 1}-15T12:00:00.000Z`),
    }));
    const communications = Array.from({ length: 220 }, (_, i) => ({
      ...base.communications[0]!,
      id: `00000000-0000-4000-8000-00000000c${String(i).padStart(2, "0")}`,
      subject: `Scale communication ${i}`,
      occurredAt: new Date(`2025-0${(i % 9) + 1}-01T12:00:00.000Z`),
    }));
    const motionLinks = motions.flatMap((m, i) => [
      {
        ...base.motionLinks[0]!,
        id: `00000000-0000-4000-8000-0000000ml${String(i).padStart(2, "0")}`,
        motionId: m.id,
      },
    ]);
    const motionDocuments = motions.flatMap((m, i) => [
      {
        ...base.motionDocuments[0]!,
        id: `00000000-0000-4000-8000-0000000md${String(i).padStart(2, "0")}`,
        motionId: m.id,
      },
    ]);
    const scaled = {
      ...base,
      motions,
      communications,
      motionLinks,
      motionDocuments,
      communicationLinks: base.communicationLinks,
    };
    const t0 = performance.now();
    const answer = answerMotionsCommunicationsQuestion({
      review: scaled,
      question: "What motions are pending?",
    });
    const graph = planMotionsCommunicationsGraph(scaled);
    const timeline = planMotionsCommunicationsTimelineEvents(scaled);
    const elapsed = performance.now() - t0;
    expect(answer.pendingMotionIds.length).toBeGreaterThan(0);
    expect(graph.nodes.length).toBeGreaterThan(50);
    expect(timeline.length).toBeGreaterThan(50);
    expect(new Set(graph.nodes.map((n) => `${n.canonicalEntityType}:${n.canonicalEntityId}`)).size).toBe(
      graph.nodes.length,
    );
    expect(elapsed).toBeLessThan(500);
  });
});
