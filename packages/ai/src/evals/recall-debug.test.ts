import { describe, expect, it } from "vitest";
import { GRADED_CASES } from "./graded-cases";
import {
  PERSISTENT_CASE_QA_FAIL_IDS,
  countRecallBuckets,
  diagnosePersistentCaseQaFails,
} from "./recall-debug";

describe("Case Q&A recall diagnosis", () => {
  it("covers the 13 persistent live-3 fails", () => {
    expect(PERSISTENT_CASE_QA_FAIL_IDS).toHaveLength(13);
    for (const id of PERSISTENT_CASE_QA_FAIL_IDS) {
      expect(GRADED_CASES.some((c) => c.id === id)).toBe(true);
    }
  });

  it("classifies all 13 as model_behavior: required chunks are already in the fixture", () => {
    const rows = diagnosePersistentCaseQaFails();
    expect(rows).toHaveLength(13);
    const counts = countRecallBuckets(rows);
    expect(counts.retrieval_recall).toBe(0);
    expect(counts.partial_retrieval).toBe(0);
    expect(counts.model_behavior).toBe(13);
    const combines = rows.filter((r) => r.mustCiteChunkIds.length >= 2);
    expect(combines).toHaveLength(5);
    expect(combines.every((r) => r.bothRequiredPresent === true)).toBe(true);
  });

  it("confirms golden-indemnity-with-amendment is present-chunk model_behavior, not a retrieval miss", () => {
    const testCase = GRADED_CASES.find((c) => c.id === "golden-indemnity-with-amendment")!;
    const row = diagnosePersistentCaseQaFails().find((r) => r.caseId === testCase.id);
    expect(row).toBeDefined();
    expect(row!.bucket).toBe("model_behavior");
    expect(row!.presentRequired).toContain("chunk_amend_indemnity");
    expect(row!.missingRequired).toEqual([]);
  });
});
