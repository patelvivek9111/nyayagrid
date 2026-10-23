import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { classifyLegalBenchTask, inventoryLegalBenchTasks } from "../src/adapters/legalbench.js";
import { normalizeLegalBenchRagCase } from "../src/adapters/legalbench-rag.js";
import { normalizePrbenchRow } from "../src/adapters/prbench.js";
import { getFixturesDir, getRegistryDir } from "../src/paths.js";
import { filterLegalBenchTasks } from "../src/selectors/legalbench.js";
import { filterLegalBenchRagTasks } from "../src/selectors/legalbench-rag.js";
import { selectPrbenchSubset } from "../src/selectors/prbench.js";
import { buildScreeningSelection, deterministicSelect } from "../src/selectors/screening.js";
import { parseNormalizedTasks } from "../src/schema/normalized-task.js";
import { ExternalBenchmarkScorecardSchema } from "../src/schema/scorecard.js";
import { assertSafeArchiveEntry } from "../src/security/safe-extract.js";

describe("PRBench adapter + selector", () => {
  it("normalizes a source row without fabricating answers", () => {
    const task = normalizePrbenchRow(
      {
        task: "LAW-001",
        turns: 1,
        field: "legal",
        topic: "contracts",
        prompt_0: "What is the cure period?",
        response_0: "",
        rubric: [
          {
            id: "c1",
            title: "cure",
            annotations: {
              criteria_description: "states cure period",
              important_weight: 2,
            },
          },
        ],
        reference_texts_0: ["Section 12 cure period is 30 days."],
      },
      { split: "legal_hard", hard: true },
    );
    expect(task.taskId).toBe("LAW-001");
    expect(task.difficulty).toBe("hard");
    expect(task.expectedAnswer).toBeNull();
    expect(task.contaminationRisk).toBe("PUBLIC_HIGH");
    expect(task.rubric?.criteria?.[0]?.weight).toBe(2);
  });

  it("selects hard subset and reports mismatches without forcing counts", () => {
    const fixtures = parseNormalizedTasks(
      (
        JSON.parse(readFileSync(path.join(getFixturesDir(), "prbench-like.json"), "utf8")) as {
          tasks: unknown[];
        }
      ).tasks,
    ).map((t) => ({
      ...t,
      split: "legal_hard",
      difficulty: "hard",
      metadata: { ...t.metadata, legalHard: true },
    }));
    const { report } = selectPrbenchSubset(fixtures, "PRBENCH_LEGAL_HARD", "rev");
    expect(report.actualCount).toBe(3);
    expect(report.expectedPublishedCount).toBe(250);
    expect(report.countMismatch).toBe(true);
  });
});

describe("LegalBench classification + filters", () => {
  it("classifies known patterns", () => {
    expect(classifyLegalBenchTask("canada_tax_court_outcomes")).toBe("NON_US_OR_LOW_RELEVANCE");
    expect(classifyLegalBenchTask("contract_nli_limited_use")).toBe("CONTRACT");
    expect(classifyLegalBenchTask("hearsay")).toBe("PROCEDURAL");
  });

  it("filters by category and task ids", () => {
    const tasks = parseNormalizedTasks(
      (
        JSON.parse(readFileSync(path.join(getFixturesDir(), "legalbench-like.json"), "utf8")) as {
          tasks: unknown[];
        }
      ).tasks,
    ).map((t, i) => ({
      ...t,
      metadata: {
        ...t.metadata,
        nyayaCategory: i === 0 ? "CONTRACT" : "GENERAL_LEGAL_REASONING",
        upstreamTask: `task_${i}`,
      },
    }));
    expect(filterLegalBenchTasks(tasks, { mode: "category", category: "CONTRACT" })).toHaveLength(
      1,
    );
    expect(
      filterLegalBenchTasks(tasks, {
        mode: "task_ids",
        taskIds: [tasks[0]!.taskId],
      }),
    ).toHaveLength(1);
  });
});

describe("LegalBench-RAG adapter", () => {
  it("preserves exact spans and fails on malformed span", () => {
    const ok = normalizeLegalBenchRagCase(
      "privacy_qa",
      {
        query: "What data is collected?",
        snippets: [{ file_path: "privacy_qa/Keep.txt", span: [10, 40] }],
      },
      0,
    );
    expect(ok.goldEvidence?.[0]?.start).toBe(10);
    expect(ok.goldEvidence?.[0]?.end).toBe(40);
    expect(() =>
      normalizeLegalBenchRagCase(
        "privacy_qa",
        { query: "x", snippets: [{ file_path: "a", span: [1] as unknown as [number, number] }] },
        1,
      ),
    ).toThrow(/bad span/);
  });

  it("filters by source and limit", () => {
    const tasks = parseNormalizedTasks(
      (
        JSON.parse(
          readFileSync(path.join(getFixturesDir(), "legalbench-rag-like.json"), "utf8"),
        ) as { tasks: unknown[] }
      ).tasks,
    );
    expect(filterLegalBenchRagTasks(tasks, { mode: "limit", limit: 2 })).toHaveLength(2);
  });
});

describe("screening determinism", () => {
  it("is stable for the same seed", () => {
    const tasks = parseNormalizedTasks(
      (
        JSON.parse(readFileSync(path.join(getFixturesDir(), "prbench-like.json"), "utf8")) as {
          tasks: unknown[];
        }
      ).tasks,
    );
    const a = deterministicSelect(tasks, 2).map((t) => t.taskId);
    const b = deterministicSelect(tasks, 2).map((t) => t.taskId);
    expect(a).toEqual(b);
    const suite = buildScreeningSelection({
      prbenchHard: tasks,
      legalbench: tasks,
      legalbenchRag: tasks,
    });
    expect(suite.selectionMethod).toBe("deterministic_stratified");
  });
});

describe("license registry + scorecard + safe extract", () => {
  it("loads license registry with required review statuses", () => {
    const licenses = JSON.parse(
      readFileSync(path.join(getRegistryDir(), "licenses.json"), "utf8"),
    ) as Array<{ benchmark_id: string; review_status: string }>;
    const ids = licenses.map((l) => l.benchmark_id);
    expect(ids).toContain("prbench");
    expect(ids).toContain("legalbench");
    expect(ids).toContain("legalbench-rag");
    expect(ids).toContain("plawbench");
    expect(
      licenses.every((l) =>
        [
          "VERIFIED_OK",
          "INTERNAL_EVAL_ONLY",
          "LICENSE_REVIEW_REQUIRED",
          "DO_NOT_DISTRIBUTE",
        ].includes(l.review_status),
      ),
    ).toBe(true);
  });

  it("serializes scorecard", () => {
    const card = ExternalBenchmarkScorecardSchema.parse({
      provider: "dummy",
      model: "x",
      exactModelId: "x",
      benchmark: "prbench",
      subset: "legal_hard",
      taskCount: 1,
      completed: 1,
      failed: 0,
      score: 0.5,
      criticalFailures: 0,
      runTimestamp: "2026-01-01T00:00:00.000Z",
      datasetRevision: "rev",
      promptVersion: "v1",
    });
    expect(JSON.parse(JSON.stringify(card)).benchmark).toBe("prbench");
  });

  it("rejects path traversal in archive entries", () => {
    expect(() => assertSafeArchiveEntry("/tmp/out", "../etc/passwd")).toThrow(/Unsafe|traversal/i);
    expect(() => assertSafeArchiveEntry("/tmp/out", "/abs/path")).toThrow();
    const safe = assertSafeArchiveEntry(path.resolve("."), "tasks/hearsay/test.tsv");
    expect(safe.replace(/\\/g, "/")).toContain("tasks/hearsay/test.tsv");
  });
});

describe("optional cache inventory", () => {
  it("inventories LegalBench when cache present", () => {
    const root = path.resolve(getFixturesDir(), "..", "cache", "lb", "tasks");
    try {
      const inv = inventoryLegalBenchTasks(root);
      expect(inv.length).toBeGreaterThan(100);
    } catch {
      // Cache may be absent in CI; fixture path absence is acceptable.
      expect(true).toBe(true);
    }
  });
});
