import { describe, expect, it } from "vitest";
import { GRADED_CASES } from "./evals/graded-cases";
import { rankByQuestionOverlap } from "./retrieval-rank";

describe("question-overlap rerank", () => {
  it("ranks executed Base Rent above the late-fee decoy for a rent question", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-rent-amount");
    expect(testCase).toBeDefined();
    const ranked = rankByQuestionOverlap(testCase!.question, testCase!.retrieved);
    expect(ranked[0]?.chunkId).toBe("chunk_lease_rent");
  });

  it("ranks termination notice above renewal for a terminate-notice question", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-adv-notice-vs-renewal");
    expect(testCase).toBeDefined();
    const ranked = rankByQuestionOverlap(testCase!.question, testCase!.retrieved);
    expect(ranked[0]?.chunkId).toBe("chunk_lease_notice");
  });

  it("ranks executed rent above the unsigned term-sheet figure", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-adv-near-miss-term-sheet-rent");
    expect(testCase).toBeDefined();
    const ranked = rankByQuestionOverlap(testCase!.question, testCase!.retrieved);
    expect(ranked[0]?.chunkId).toBe("chunk_lease_rent");
  });

  it("ranks executed 30-day notice above the unexecuted 90-day draft", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-adv-near-miss-ninety-day-draft");
    expect(testCase).toBeDefined();
    const ranked = rankByQuestionOverlap(testCase!.question, testCase!.retrieved);
    expect(ranked[0]?.chunkId).toBe("chunk_lease_notice");
  });

  it("ranks the amendment indemnity chunk above the lease-term decoy", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-indemnity-with-amendment");
    expect(testCase).toBeDefined();
    const ranked = rankByQuestionOverlap(testCase!.question, testCase!.retrieved);
    expect(ranked[0]?.chunkId).toBe("chunk_amend_indemnity");
  });

  it("does not drop passages — only reorders them", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-rent-amount")!;
    const ranked = rankByQuestionOverlap(testCase.question, testCase.retrieved);
    expect(ranked.map((p) => p.chunkId).sort()).toEqual(
      testCase.retrieved.map((p) => p.chunkId).sort(),
    );
  });

  it("is deterministic for the same question and passage set", () => {
    const items = [
      { chunkId: "b", quote: "notice period currently applies thirty days" },
      { chunkId: "a", quote: "notice period currently applies thirty days" },
      { chunkId: "c", quote: "unrelated invoice amount" },
    ];
    const question = "What notice period currently applies?";
    const first = rankByQuestionOverlap(question, items).map((row) => row.chunkId);
    const shuffled = rankByQuestionOverlap(question, [items[1]!, items[2]!, items[0]!]).map(
      (row) => row.chunkId,
    );
    expect(first).toEqual(shuffled);
    expect(first).toEqual(["a", "b", "c"]);
  });
});
