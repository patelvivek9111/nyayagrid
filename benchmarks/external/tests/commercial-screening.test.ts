import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../src/paths.js";
import {
  buildCommercialScreeningSuite,
  isLegalBenchTaskCommercialCleared,
  isRagTaskProductionCleared,
} from "../src/selectors/commercial-screening.js";
import { NormalizedTaskSchema } from "../src/schema/normalized-task.js";

describe("commercial screening", () => {
  it("detects NC legalbench tasks", () => {
    expect(isLegalBenchTaskCommercialCleared("opp115_policy_change::test::0")).toBe(false);
    expect(isLegalBenchTaskCommercialCleared("abercrombie::train::0")).toBe(true);
  });

  it("excludes privacy_qa from production rag", () => {
    expect(isRagTaskProductionCleared("privacy_qa::30")).toBe(false);
    expect(isRagTaskProductionCleared("cuad::491")).toBe(true);
  });

  it("rebuilds legalbench to 24 commercial tasks", () => {
    const screening = JSON.parse(
      readFileSync(path.join(getRegistryDir(), "screening-suite.json"), "utf8"),
    ) as {
      upstream_ids: {
        legalbench: string[];
        legalbench_rag: string[];
        prbench_legal_hard: string[];
      };
    };

    const lbPool = [
      "abercrombie",
      "sara_numeric",
      "cuad_insurance",
      "definition_classification",
    ].map((task) =>
      NormalizedTaskSchema.parse({
        benchmarkId: "legalbench",
        taskId: `${task}::train::0`,
        split: "train",
        jurisdiction: null,
        practiceArea: null,
        difficulty: null,
        taskType: task,
        input: {},
        conversation: [{ role: "user", content: "q" }],
        supportingDocuments: null,
        expectedAnswer: "a",
        metadata: { upstreamTask: task },
      }),
    );

    const suite = buildCommercialScreeningSuite({
      prbenchHardTaskIds: screening.upstream_ids.prbench_legal_hard.slice(0, 32),
      currentLegalbenchIds: screening.upstream_ids.legalbench,
      currentRagIds: screening.upstream_ids.legalbench_rag,
      legalbenchPool: lbPool,
      legalbenchRagPool: screening.upstream_ids.legalbench_rag
        .filter((id) => !id.startsWith("privacy_qa::"))
        .map((id) =>
          NormalizedTaskSchema.parse({
            benchmarkId: "legalbench-rag",
            taskId: id,
            split: id.split("::")[0] ?? "cuad",
            jurisdiction: null,
            practiceArea: null,
            difficulty: null,
            taskType: "retrieval",
            input: {},
            conversation: null,
            supportingDocuments: null,
            expectedAnswer: null,
            metadata: { upstreamSource: id.split("::")[0] },
          }),
        ),
    });

    expect(suite.actual.legalbench).toBeLessThanOrEqual(24);
    for (const id of suite.legalbenchTaskIds) {
      expect(isLegalBenchTaskCommercialCleared(id)).toBe(true);
    }
    for (const id of suite.legalbenchRagTaskIds) {
      expect(isRagTaskProductionCleared(id)).toBe(true);
    }
  });
});
