import { describe, expect, it } from "vitest";
import {
  scoreExactLabel,
  scoreCaseFacts,
  scoreCitationReliability,
  scoreLegalRagRetrieval,
  scoreLegalRagGrounding,
  detectAbstention,
} from "../src/prosecution-external/scorers/index.js";
import type { NormalizedTask } from "../src/schema/normalized-task.js";

const hearsay: NormalizedTask = {
  benchmarkId: "legalbench",
  taskId: "hearsay::fixture::0",
  expectedAnswer: "Yes",
};

describe("prosecution external scorers", () => {
  it("scores exact labels", () => {
    expect(scoreExactLabel(hearsay, "Reasoning...\nYes").correct).toBe(true);
    expect(scoreExactLabel(hearsay, "No").correct).toBe(false);
  });

  it("tracks CaseFacts false-supported and overruled errors", () => {
    const overruled: NormalizedTask = {
      benchmarkId: "casefacts",
      taskId: "cf-1",
      expectedAnswer: "Overruled",
    };
    const bad = scoreCaseFacts(overruled, "Supported");
    expect(bad.failures).toContain("FALSE_SUPPORTED");
    expect(bad.failures).toContain("OVERRULED_LAW_ERROR");
  });

  it("penalizes fabricated closed-book citations", () => {
    const task: NormalizedTask = {
      benchmarkId: "legalcitebench",
      taskId: "cite-1",
      expectedAnswer: "ABSTAIN",
      metadata: { citationTaskType: "CITATION_RETRIEVAL" },
    };
    const out = scoreCitationReliability(
      task,
      "The controlling case is 123 Fake.2d 456.",
      "CLOSED_BOOK_DIAGNOSTIC",
    );
    expect(out.fabricatedAuthority).toBe(true);
  });

  it("separates Legal RAG retrieval/grounding and keeps AU label", () => {
    const task: NormalizedTask = {
      benchmarkId: "legal-rag-bench",
      taskId: "legal-rag-bench::qa::q0",
      expectedAnswer: "answer",
      goldEvidence: [{ documentId: "p0" }],
      metadata: { resultLabel: "NON_US_CRIMINAL_RAG_DIAGNOSTIC" },
    };
    const retrieval = scoreLegalRagRetrieval({ task, retrievedDocumentIds: ["p0"], k: 5 });
    expect(retrieval.correct).toBe(true);
    expect(retrieval.details?.usSubstantiveScore).toBe(false);
    const grounding = scoreLegalRagGrounding({
      task,
      answerText: "answer",
      citedPassageIds: ["p0"],
    });
    expect(grounding.correct).toBe(true);
  });

  it("detects abstention", () => {
    expect(detectAbstention("I must abstain; insufficient record.")).toBe(true);
  });
});
