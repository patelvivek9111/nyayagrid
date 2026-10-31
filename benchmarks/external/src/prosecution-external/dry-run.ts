import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getCacheDir, getFixturesDir } from "../paths.js";
import { FakeProvider } from "../providers/dummy.js";
import { isPaidCallsAuthorized } from "../guards/paid-call-guard.js";
import { SUITE_ID, SUITE_VERSION, DETERMINISTIC_SEED, type TaskGroup } from "./constants.js";
import { buildProsecutionExternalSuitePlan } from "./suite.js";
import {
  scoreExactLabel,
  scoreCaseFacts,
  scoreCitationReliability,
  scoreLegalRagGrounding,
  scoreLegalRagRetrieval,
} from "./scorers/index.js";
import {
  ProsecutionExternalRunReportSchema,
  type ProsecutionExternalTaskResult,
  type ProsecutionExternalRunReport,
} from "./result-schema.js";
import { GPT_61_SOL_LIVE_VERIFIED, recordModelPin } from "./model-pin.js";

function fixtureResponses(): Record<string, string> {
  const dir = path.join(getFixturesDir(), "prosecution-external");
  const files = [
    "legalbench-like.json",
    "legalcitebench-like.json",
    "casefacts-like.json",
    "legal-rag-bench-like.json",
  ];
  const map: Record<string, string> = {};
  for (const file of files) {
    const raw = JSON.parse(readFileSync(path.join(dir, file), "utf8")) as {
      prefilledResponses?: Record<string, string>;
    };
    Object.assign(map, raw.prefilledResponses ?? {});
  }
  return map;
}

function groupForTask(
  benchmarkId: string,
  metadata: Record<string, unknown> | null | undefined,
): TaskGroup {
  const g = metadata?.taskGroup;
  if (
    typeof g === "string" &&
    [
      "US_EVIDENCE_REASONING",
      "US_AUTHORITY_VERIFICATION",
      "US_PRECEDENT_FACT_CHECKING",
      "CITATION_RELIABILITY",
      "CRIMINAL_RAG_RETRIEVAL",
      "CRIMINAL_RAG_GROUNDING",
      "ABSTENTION",
      "SOURCE_FIDELITY",
    ].includes(g)
  ) {
    return g as TaskGroup;
  }
  if (benchmarkId === "legalcitebench") return "CITATION_RELIABILITY";
  if (benchmarkId === "casefacts") return "US_PRECEDENT_FACT_CHECKING";
  if (benchmarkId === "legal-rag-bench") return "CRIMINAL_RAG_GROUNDING";
  return "US_EVIDENCE_REASONING";
}

export async function runProsecutionExternalDryRun(opts?: {
  resumeRunId?: string;
}): Promise<ProsecutionExternalRunReport> {
  if (isPaidCallsAuthorized() && process.env.EXTERNAL_BENCH_FORCE_LIVE === "1") {
    throw new Error("PAID_CALLS_FORBIDDEN_IN_PROSECUTION_EXTERNAL_DRY_RUN");
  }

  const plan = await buildProsecutionExternalSuitePlan({ useFixturesOnly: true });
  const responses = fixtureResponses();
  const provider = new FakeProvider({
    fixturesDir: path.join(getFixturesDir(), "prosecution-external"),
  });

  const pin = recordModelPin({
    logicalModel: "gpt-6.1-sol",
    requestedApiModel: "gpt-6.1-sol",
    servedModel: null,
  });

  const outDir = path.join(getCacheDir(), "runs", "prosecution-external-dry");
  mkdirSync(outDir, { recursive: true });
  const progressPath = path.join(outDir, "progress.jsonl");
  const completed = new Set<string>();
  if (opts?.resumeRunId && existsSync(progressPath)) {
    for (const line of readFileSync(progressPath, "utf8").split(/\r?\n/).filter(Boolean)) {
      const row = JSON.parse(line) as { taskId?: string };
      if (row.taskId) completed.add(row.taskId);
    }
  }

  const taskResults: ProsecutionExternalTaskResult[] = [];

  for (const slice of plan.slices) {
    for (const task of slice.tasks) {
      if (completed.has(task.taskId)) {
        continue;
      }

      const prefilled = responses[task.taskId];
      const output =
        prefilled ??
        provider.complete({
          taskId: task.taskId,
          benchmarkId: task.benchmarkId,
          messages: (task.conversation ?? []).map((t) => ({
            role: t.role,
            content: t.content,
          })),
        }).content;

      let scored;
      if (task.benchmarkId === "casefacts") {
        scored = scoreCaseFacts(task, output);
      } else if (task.benchmarkId === "legalcitebench") {
        const mode =
          task.metadata?.citationTaskType === "CITATION_RETRIEVAL" ||
          task.metadata?.citationTaskType === "CITATION_COMPLETION"
            ? "CLOSED_BOOK_DIAGNOSTIC"
            : "NYAYA_GROUNDED_VERIFICATION";
        scored = scoreCitationReliability(task, output, mode);
      } else if (task.benchmarkId === "legal-rag-bench") {
        const relevant = String(task.metadata?.relevantPassageId ?? "");
        const retrieval = scoreLegalRagRetrieval({
          task,
          retrievedDocumentIds: relevant ? [relevant] : [],
          k: 5,
        });
        const grounding = scoreLegalRagGrounding({
          task,
          answerText: output,
          citedPassageIds: relevant ? [relevant] : [],
        });
        scored = {
          correct: Boolean(retrieval.correct && grounding.correct),
          score: ((retrieval.score ?? 0) + (grounding.score ?? 0)) / 2,
          abstained: grounding.abstained,
          unsupportedClaim: grounding.unsupportedClaim,
          fabricatedAuthority: false,
          sourceGroundingFailure: grounding.sourceGroundingFailure,
          failures: [...retrieval.failures, ...grounding.failures],
        };
      } else {
        scored = scoreExactLabel(task, output);
      }

      const row: ProsecutionExternalTaskResult = {
        benchmark: task.benchmarkId,
        datasetVersion: SUITE_VERSION,
        jurisdiction: slice.jurisdiction,
        task: String(task.taskType ?? task.metadata?.upstreamTask ?? task.benchmarkId),
        sampleId: task.taskId,
        taskGroup: groupForTask(task.benchmarkId, task.metadata ?? null),
        evalMode: "NYAYA_PIPELINE",
        citationMode:
          task.benchmarkId === "legalcitebench"
            ? task.metadata?.citationTaskType === "CITATION_RETRIEVAL" ||
              task.metadata?.citationTaskType === "CITATION_COMPLETION"
              ? "CLOSED_BOOK_DIAGNOSTIC"
              : "NYAYA_GROUNDED_VERIFICATION"
            : null,
        license: slice.license,
        licenseClassification: slice.licenseClassification,
        score: scored.score,
        correct: scored.correct,
        abstained: scored.abstained,
        unsupportedClaim: scored.unsupportedClaim,
        fabricatedAuthority: scored.fabricatedAuthority,
        sourceGroundingFailure: scored.sourceGroundingFailure,
        failures: scored.failures,
        resultLabel: slice.resultLabel ?? null,
        logicalModel: pin.logicalModel,
        requestedApiModel: pin.requestedApiModel,
        servedModel: pin.servedModel,
        adapterSubstitution: pin.adapterSubstitution,
        modelPinStatus: pin.pinStatus,
      };
      taskResults.push(row);
      writeFileSync(
        progressPath,
        `${JSON.stringify({ taskId: task.taskId, status: "scored" })}\n`,
        { flag: "a" },
      );
      completed.add(task.taskId);
    }
  }

  const groupsMap = new Map<string, ProsecutionExternalTaskResult[]>();
  for (const t of taskResults) {
    const key = `${t.taskGroup}::${t.jurisdiction}`;
    const list = groupsMap.get(key) ?? [];
    list.push(t);
    groupsMap.set(key, list);
  }

  const groups = [...groupsMap.entries()].map(([key, rows]) => {
    const [taskGroup, jurisdiction] = key.split("::") as [TaskGroup, string];
    const scoredRows = rows.filter((r) => r.correct !== null);
    const accuracy =
      scoredRows.length === 0
        ? null
        : scoredRows.filter((r) => r.correct).length / scoredRows.length;
    return {
      taskGroup,
      jurisdiction,
      sampleCount: rows.length,
      scored: scoredRows.length,
      accuracy,
      abstentions: rows.filter((r) => r.abstained).length,
      unsupportedClaims: rows.filter((r) => r.unsupportedClaim).length,
      fabricatedAuthority: rows.filter((r) => r.fabricatedAuthority).length,
      sourceGroundingFailures: rows.filter((r) => r.sourceGroundingFailure).length,
      resultLabel: rows.find((r) => r.resultLabel)?.resultLabel ?? null,
    };
  });

  const report = ProsecutionExternalRunReportSchema.parse({
    suiteId: SUITE_ID,
    suiteVersion: SUITE_VERSION,
    seed: DETERMINISTIC_SEED,
    paidCalls: 0,
    courtListener: 0,
    evalMode: "NYAYA_PIPELINE",
    internalBenchSeparated: true,
    jurisdictionSeparated: true,
    gpt61SolLiveVerified: GPT_61_SOL_LIVE_VERIFIED,
    groups,
    tasks: taskResults,
    selectionManifestHash: plan.selectionManifestHash,
    contaminationCaveat:
      "Public benchmarks may appear in model pretraining; independence means Nyaya did not author labels.",
    runTimestamp: new Date().toISOString(),
  });

  writeFileSync(path.join(outDir, "last-dry-run.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
