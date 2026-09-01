import { describe, expect, it } from "vitest";
import { gradeAnswer } from "../graders/grade";
import { loadGroundTruth } from "../graders/load-ground-truth";
import type { PersistedAnswer } from "../graders/types";

function answer(overrides: Partial<PersistedAnswer>): PersistedAnswer {
  return {
    dataset: "v2",
    scenarioId: "SYNTH-V2-001",
    taskId: "SYNTH-V2-001-AG023",
    category: "agent",
    prompt: "Analyze the contract.",
    answer: "Denied.",
    evidenceState: "subsystem",
    citations: [],
    assumptions: [],
    unresolvedQuestions: [],
    retrievedChunkIds: [],
    provider: "mock",
    model: "mock",
    promptVersion: null,
    artifactId: null,
    conversationId: null,
    latencyMs: 1,
    persistedAt: new Date().toISOString(),
    extras: { executionTarget: "agent", structuredKind: "agent" },
    ...overrides,
  };
}

describe("agent grader", () => {
  it("loads hidden agent keys only after answers exist in the test", () => {
    const keys = loadGroundTruth("v2", "SYNTH-V2-001");
    expect(keys.get("SYNTH-V2-001-AG023")?.severity).toBe("critical");
  });

  it("fails when an outsider is not denied", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-AG023")!;
    const graded = gradeAnswer(
      answer({
        extras: {
          executionTarget: "agent",
          structuredKind: "agent",
          outsiderDenied: false,
          snapshot: { status: "completed" },
        },
      }),
      gt,
    );
    expect(graded.verdict).toBe("fail");
    expect(graded.criticalFailure).toBe(true);
  });

  it("passes outsider denial", () => {
    const gt = loadGroundTruth("v2", "SYNTH-V2-001").get("SYNTH-V2-001-AG023")!;
    const graded = gradeAnswer(
      answer({
        extras: {
          executionTarget: "agent",
          structuredKind: "agent",
          outsiderDenied: true,
          snapshot: { status: "denied" },
        },
      }),
      gt,
    );
    expect(graded.verdict).toBe("pass");
  });
});
