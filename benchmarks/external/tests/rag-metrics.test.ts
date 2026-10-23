import { describe, expect, it } from "vitest";
import {
  characterPrecisionRecallF1,
  documentHit,
  evidenceSpanHit,
  topKDocumentRecall,
} from "../src/scorers/rag-metrics.js";

describe("rag-metrics", () => {
  it("computes character overlap metrics", () => {
    const metrics = characterPrecisionRecallF1([{ start: 0, end: 10 }], [{ start: 5, end: 15 }]);
    expect(metrics.overlapLength).toBe(5);
    expect(metrics.f1).toBeGreaterThan(0);
  });

  it("detects document hit", () => {
    expect(documentHit(["a", "b"], ["c", "b"])).toBe(true);
    expect(documentHit(["a"], ["c"])).toBe(false);
  });

  it("detects evidence span hit", () => {
    expect(evidenceSpanHit([{ start: 0, end: 10 }], [{ start: 2, end: 12 }])).toBe(true);
  });

  it("computes top-k recall", () => {
    expect(topKDocumentRecall(["d1", "d2", "d3"], ["d2", "d4"], 2)).toBe(0.5);
  });
});
