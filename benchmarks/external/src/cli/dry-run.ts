import { readFileSync } from "node:fs";
import path from "node:path";
import { assertPaidCallsAuthorized, isPaidCallsAuthorized } from "../guards/paid-call-guard.js";
import { FakeProvider } from "../providers/dummy.js";
import { parseNormalizedTasks } from "../schema/normalized-task.js";
import { ExternalBenchmarkScorecardSchema } from "../schema/scorecard.js";
import { PRBenchRubricMode, scorePrefilledRubricResponse } from "../scorers/prbench-rubric.js";
import {
  characterPrecisionRecallF1,
  documentHit,
  evidenceSpanHit,
} from "../scorers/rag-metrics.js";
import { selectPrbenchSubset } from "../selectors/prbench.js";
import { getFixturesDir } from "../paths.js";

async function main(): Promise<void> {
  if (process.argv.includes("--live") || process.env.EXTERNAL_BENCH_FORCE_LIVE === "1") {
    if (!isPaidCallsAuthorized()) {
      console.error("LIVE_MODEL_BENCHMARK_AUTHORIZATION_REQUIRED");
      process.exitCode = 2;
      return;
    }
    assertPaidCallsAuthorized();
  }

  const fixtures = getFixturesDir();
  const prbenchFx = JSON.parse(readFileSync(path.join(fixtures, "prbench-like.json"), "utf8")) as {
    tasks: unknown[];
    prefilledResponses: Record<string, string>;
  };
  const ragFx = JSON.parse(
    readFileSync(path.join(fixtures, "legalbench-rag-like.json"), "utf8"),
  ) as { tasks: unknown[] };

  const prTasks = parseNormalizedTasks(prbenchFx.tasks);
  const selected = selectPrbenchSubset(prTasks, "PRBENCH_LEGAL_ALL");
  const provider = new FakeProvider({ fixturesDir: fixtures });

  const scores = [];
  for (const task of selected.tasks) {
    const response = provider.complete({
      taskId: task.taskId,
      benchmarkId: "prbench",
      messages: (task.conversation ?? []).map((t) => ({
        role: t.role,
        content: t.content,
      })),
    });
    scores.push(
      scorePrefilledRubricResponse({
        task,
        responseText: response.content,
        mode: PRBenchRubricMode.PREFILLED_RESPONSE,
      }),
    );
  }

  const ragTasks = parseNormalizedTasks(ragFx.tasks);
  const ragMetrics = ragTasks.map((t) => {
    const gold = (t.goldEvidence ?? []).map((g) => ({
      start: g.start ?? 0,
      end: g.end ?? 0,
    }));
    const predicted = gold;
    const metrics = characterPrecisionRecallF1(predicted, gold);
    return {
      taskId: t.taskId,
      precision: metrics.precision,
      recall: metrics.recall,
      f1: metrics.f1,
      documentHit: documentHit(
        (t.goldEvidence ?? []).map((g) => g.documentId ?? ""),
        (t.goldEvidence ?? []).map((g) => g.documentId ?? ""),
      ),
      evidenceSpanHit: evidenceSpanHit(predicted, gold),
    };
  });

  const scorecard = ExternalBenchmarkScorecardSchema.parse({
    provider: "dummy",
    model: "fake-provider",
    exactModelId: "fake-provider-v0",
    benchmark: "external-dry-run",
    subset: "fixtures",
    taskCount: selected.tasks.length + ragTasks.length,
    completed: selected.tasks.length + ragTasks.length,
    failed: 0,
    score:
      scores.reduce((s, x) => s + (x.maxScore ? x.weightedScore / x.maxScore : 0), 0) /
      Math.max(1, scores.length),
    criticalFailures: 0,
    latencyP50: 0,
    latencyP95: 0,
    inputTokens: 0,
    outputTokens: 0,
    estimatedCost: 0,
    judgeModel: null,
    judgeVersion: null,
    runTimestamp: new Date().toISOString(),
    gitSha: null,
    datasetRevision: "fixtures",
    promptVersion: "external-dry-run-v1",
  });

  console.log(
    JSON.stringify(
      {
        status: "PASS",
        paidCallsAuthorized: isPaidCallsAuthorized(),
        prbenchSelected: selected.report.actualCount,
        rubricScores: scores.length,
        ragMetrics,
        scorecard,
      },
      null,
      2,
    ),
  );
  console.log("PASS");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
