import { describe, expect, it } from "vitest";
import { CONTRADICTION_CASES, CX_CHUNK_DEPO, CX_CHUNK_IMPRECISE } from "./graded-cases-contradiction";
import { gradeContradictionCase } from "./grade-contradiction";

describe("gradeContradictionCase imprecise-date filter", () => {
  it("drops a model-emitted Feb 28 vs end-of-February candidate", () => {
    const testCase = CONTRADICTION_CASES.find((c) => c.id === "cx-false-positive-imprecise-date");
    expect(testCase).toBeDefined();
    const grade = gradeContradictionCase(testCase!, {
      candidates: [
        {
          title: "Conflict in February CAM Package Sending Date",
          explanation: "One source says February 28, the other says end of February.",
          confidence: "medium",
          sideA: {
            chunkIds: [CX_CHUNK_DEPO],
            summary: "Emailed on February 28, 2025.",
          },
          sideB: {
            chunkIds: [CX_CHUNK_IMPRECISE],
            summary: "Sent around the end of February.",
          },
        },
      ],
    });
    expect(grade.passed).toBe(true);
    expect(grade.flags.falseConfidence).toBe(false);
    expect(grade.details).toMatch(/candidates=0/);
  });

  it("keeps February 28 vs March 3", () => {
    const testCase = CONTRADICTION_CASES.find((c) => c.id === "cx-cam-dual-sided");
    expect(testCase).toBeDefined();
    const depo = testCase!.mustIncludeSideChunkIds![0]!;
    const email = testCase!.mustIncludeSideChunkIds![1]!;
    const grade = gradeContradictionCase(testCase!, {
      candidates: [
        {
          title: "CAM send-date conflict",
          explanation: "February 28 vs March 3 cannot both be the send date.",
          confidence: "high",
          sideA: { chunkIds: [depo], summary: "February 28, 2025 email." },
          sideB: { chunkIds: [email], summary: "March 3, 2025 portal upload." },
        },
      ],
    });
    expect(grade.passed).toBe(true);
  });
});
