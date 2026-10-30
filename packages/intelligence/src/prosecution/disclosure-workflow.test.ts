import { describe, expect, it } from "vitest";
import {
  appendDisclosureReviewHistory,
  assertSafeDisclosureCopy,
  buildDisclosureCandidateProposals,
  buildSupervisorDisclosureQueue,
  filterDiscoveryItems,
  formatProsecutionDisclosureAskContext,
  transitionDisclosureWithGuards,
} from "./disclosure-workflow";

describe("prosecution disclosure workflow (stage 4)", () => {
  it("surfaces source-grounded candidates without Brady/Giglio conclusions", () => {
    const proposals = buildDisclosureCandidateProposals({
      contraryEvidenceIds: ["ev-1"],
      weakElementIds: ["el-missing"],
      conflictedElementIds: ["el-conflict"],
      witnessConflictWitnessIds: ["wit-1"],
      witnessConflictKeys: ["location"],
      benefitPromiseNotes: ["recorded promise"],
    });
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.every((row) => row.status === "REVIEW_REQUIRED")).toBe(true);
    expect(proposals.every((row) => row.bradyViolationConclusion === null)).toBe(true);
    expect(proposals.every((row) => row.giglioViolationConclusion === null)).toBe(true);
    expect(proposals.every((row) => row.mustDiscloseConclusion === null)).toBe(true);
    expect(JSON.stringify(proposals)).not.toMatch(
      /Brady violation|Giglio violation|must disclose/i,
    );
  });

  it("requires human reason for not-disclose and forbids automated violation language", () => {
    expect(() =>
      transitionDisclosureWithGuards({
        next: "REVIEWED_NOT_DISCLOSE",
        humanActor: true,
        notes: null,
        reason: null,
      }),
    ).toThrow(/reason/i);
    expect(() => assertSafeDisclosureCopy("This is a Brady violation")).toThrow(/not permitted/i);
    expect(
      transitionDisclosureWithGuards({
        next: "REVIEWED_NOT_DISCLOSE",
        humanActor: true,
        reason: "Human withhold after source review",
      }),
    ).toBe("REVIEWED_NOT_DISCLOSE");
    expect(() =>
      transitionDisclosureWithGuards({
        next: "REVIEWED_DISCLOSE",
        humanActor: false,
      }),
    ).toThrow(/final disclosure/i);
  });

  it("appends immutable review history and builds supervisor queue", () => {
    const history = appendDisclosureReviewHistory({
      history: [],
      priorStatus: "REVIEW_REQUIRED",
      nextStatus: "ESCALATE",
      actorUserId: "user-1",
      reason: "Needs supervisor",
    });
    expect(history).toHaveLength(1);
    expect(history[0]?.priorStatus).toBe("REVIEW_REQUIRED");
    const queue = buildSupervisorDisclosureQueue({
      candidates: [
        {
          id: "c1",
          category: "POTENTIALLY_EXCULPATORY",
          status: "REVIEW_REQUIRED",
          priority: "high",
        },
        { id: "c2", category: "POTENTIAL_IMPEACHMENT", status: "ESCALATE", priority: "high" },
        { id: "c3", category: "OTHER", status: "REVIEWED_DISCLOSE", priority: "low" },
      ],
      discovery: [
        {
          id: "d1",
          category: "police_report",
          reviewStatus: "FLAGGED",
          productionStatus: "RECEIVED",
        },
      ],
      productions: [{ id: "p1", label: "Batch A", status: "PREPARED" }],
    });
    expect(queue.some((row) => row.awaitingFinalReview)).toBe(true);
    expect(queue.some((row) => row.escalated)).toBe(true);
    expect(queue.some((row) => row.kind === "production")).toBe(true);
  });

  it("filters discovery and formats Ask context distinguishing candidates from finals", () => {
    const filtered = filterDiscoveryItems(
      [
        {
          reviewStatus: "RECEIVED",
          productionStatus: "RECEIVED",
          category: "police_report",
          source: "agency",
          relatedDefendantIds: ["def-a"],
        },
        {
          reviewStatus: "PRODUCED",
          productionStatus: "PRODUCED",
          category: "lab_report",
          source: "lab",
          relatedDefendantIds: ["def-b"],
        },
      ],
      { status: "RECEIVED", defendantId: "def-a" },
    );
    expect(filtered).toHaveLength(1);
    const ask = formatProsecutionDisclosureAskContext({
      discoveryCount: 2,
      unreviewedDiscovery: 1,
      producedDiscovery: 1,
      candidates: [
        {
          id: "c1",
          category: "CONTRADICTORY_EVIDENCE",
          status: "REVIEW_REQUIRED",
          reason: "conflict",
          origin: "deterministic",
        },
        {
          id: "c2",
          category: "POTENTIALLY_EXCULPATORY",
          status: "REVIEWED_DISCLOSE",
          origin: "human",
        },
      ],
      productions: [{ id: "p1", label: "Set 1", status: "PRODUCED" }],
      supervisorQueueCount: 1,
    });
    expect(ask).toContain("[CANDIDATE not final]");
    expect(ask).toContain("[HUMAN DETERMINATION]");
    expect(ask).toContain("BRADY_VIOLATION_CONCLUSION: null");
    expect(ask).toContain("no external send");
  });
});
