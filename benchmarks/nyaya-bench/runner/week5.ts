import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { WEEK5_ASSIGNMENTS, countByCategory } from "../datasets/week5/catalog";
import { HOLDOUT_CONTAMINATION_CONTROLS, WEEK5_HOLDOUTS } from "../datasets/week5/holdouts";
import {
  WEEK5_AUDIT,
  WEEK5_DATASET_ID,
  WEEK5_DATASET_VERSION,
  WEEK5_GRADER_VERSION,
} from "../datasets/week5/taxonomy";
import { gradeWeek5Assignment, type Week5Grade } from "../graders/week5-grade";
import { answerPath, createRunDir, persistGrade, persistSummary } from "./persist";
import { executeWeek5Assignment, type Week5AnswerPayload } from "./week5-execute";

function commitSha(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

export type Week5RunSummary = {
  runId: string;
  datasetId: string;
  datasetVersion: string;
  graderVersion: string;
  commitSha: string;
  timestamp: string;
  modelProvider: "deterministic";
  model: "week4-substrate";
  externalLlmCalls: 0;
  courtListenerRequests: 0;
  corpusHealth: "CORPUS_HEALTH_NOT_REMEASURED";
  totals: {
    assignments: number;
    development: number;
    certification: number;
    hiddenHoldout: number;
    passed: number;
    failed: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    passRate: number;
  };
  byCategory: Record<string, number>;
  dimensionAverages: Record<string, number>;
  criticalFailures: Array<{
    benchmark: string;
    failureType: string;
    rootCause: string;
    status: "OPEN" | "RESOLVED";
  }>;
  highFailures: Array<{ benchmark: string; failureType: string; rootCause: string }>;
  holdout: {
    assignments: number;
    passed: number;
    passRate: number;
    critical: number;
    high: number;
    contaminationControls: typeof HOLDOUT_CONTAMINATION_CONTROLS;
  };
  latencyMs: {
    min: number;
    max: number;
    avg: number;
  };
  classification: "WEEK5_PASS_OPEN_WEEK6" | "WEEK5_CONTINUE" | "WEEK5_BENCHMARK_PROGRAM_OPERATIONAL";
  audit: typeof WEEK5_AUDIT;
};

export function runWeek5Certification(options?: { includeHoldouts?: boolean }): {
  runDir: string;
  summary: Week5RunSummary;
  grades: Week5Grade[];
} {
  const includeHoldouts = options?.includeHoldouts !== false;
  const runId = `week5-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = createRunDir(runId);
  const assignments = includeHoldouts ? [...WEEK5_ASSIGNMENTS, ...WEEK5_HOLDOUTS] : [...WEEK5_ASSIGNMENTS];
  const grades: Week5Grade[] = [];
  const answers: Week5AnswerPayload[] = [];

  for (const assignment of assignments) {
    const answer = executeWeek5Assignment(assignment);
    answers.push(answer);
    writeFileSync(
      answerPath(runDir, assignment.id),
      `${JSON.stringify(
        {
          dataset: WEEK5_DATASET_ID,
          taskId: assignment.id,
          category: assignment.category,
          lane: assignment.lane,
          prompt: assignment.question,
          answer: answer.textBlob,
          structured: answer.structured,
          extras: answer.extras,
          provider: answer.modelProvider,
          model: answer.model,
          latencyMs: answer.latencyMs,
          usedWeek4CombinedContext: Boolean(answer.structured),
          persistedAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    const grade = gradeWeek5Assignment(assignment, answer);
    grades.push(grade);
    persistGrade(runDir, assignment.id, grade);
  }

  const criticalFailures = grades.flatMap((grade) =>
    grade.failures
      .filter((failure) => failure.severity === "CRITICAL")
      .map((failure) => ({
        benchmark: grade.assignmentId,
        failureType: failure.type,
        rootCause: failure.rootCause,
        status: "OPEN" as const,
      })),
  );
  const highFailures = grades.flatMap((grade) =>
    grade.failures
      .filter((failure) => failure.severity === "HIGH")
      .map((failure) => ({
        benchmark: grade.assignmentId,
        failureType: failure.type,
        rootCause: failure.rootCause,
      })),
  );

  const holdoutIds = new Set(WEEK5_HOLDOUTS.map((row) => row.id));
  const holdoutGrades = grades.filter((grade) => holdoutIds.has(grade.assignmentId));
  const latencies = answers.map((answer) => answer.latencyMs);
  const dimensionAverages: Record<string, number> = {};
  for (const grade of grades) {
    for (const [dim, score] of Object.entries(grade.dimensionScores)) {
      dimensionAverages[dim] = (dimensionAverages[dim] ?? 0) + score;
    }
  }
  for (const dim of Object.keys(dimensionAverages)) {
    dimensionAverages[dim] = Number((dimensionAverages[dim]! / grades.length).toFixed(3));
  }

  const passed = grades.filter((grade) => grade.passed).length;
  const critical = grades.reduce((sum, grade) => sum + grade.criticalCount, 0);
  const high = grades.reduce((sum, grade) => sum + grade.highCount, 0);
  const classification =
    critical === 0 && high === 0
      ? "WEEK5_PASS_OPEN_WEEK6"
      : critical === 0
        ? "WEEK5_BENCHMARK_PROGRAM_OPERATIONAL"
        : "WEEK5_CONTINUE";

  const summary: Week5RunSummary = {
    runId,
    datasetId: WEEK5_DATASET_ID,
    datasetVersion: WEEK5_DATASET_VERSION,
    graderVersion: WEEK5_GRADER_VERSION,
    commitSha: commitSha(),
    timestamp: new Date().toISOString(),
    modelProvider: "deterministic",
    model: "week4-substrate",
    externalLlmCalls: 0,
    courtListenerRequests: 0,
    corpusHealth: "CORPUS_HEALTH_NOT_REMEASURED",
    totals: {
      assignments: grades.length,
      development: WEEK5_ASSIGNMENTS.filter((row) => row.lane === "development").length,
      certification: WEEK5_ASSIGNMENTS.filter((row) => row.lane === "certification").length,
      hiddenHoldout: holdoutGrades.length,
      passed,
      failed: grades.length - passed,
      critical,
      high,
      medium: grades.reduce((sum, grade) => sum + grade.mediumCount, 0),
      low: grades.reduce((sum, grade) => sum + grade.lowCount, 0),
      passRate: Number((passed / grades.length).toFixed(3)),
    },
    byCategory: (() => {
      const counts = countByCategory();
      for (const row of WEEK5_HOLDOUTS) {
        counts[row.category] = (counts[row.category] ?? 0) + 1;
      }
      return counts;
    })(),
    dimensionAverages,
    criticalFailures,
    highFailures,
    holdout: {
      assignments: holdoutGrades.length,
      passed: holdoutGrades.filter((grade) => grade.passed).length,
      passRate: holdoutGrades.length
        ? Number((holdoutGrades.filter((grade) => grade.passed).length / holdoutGrades.length).toFixed(3))
        : 0,
      critical: holdoutGrades.reduce((sum, grade) => sum + grade.criticalCount, 0),
      high: holdoutGrades.reduce((sum, grade) => sum + grade.highCount, 0),
      contaminationControls: HOLDOUT_CONTAMINATION_CONTROLS,
    },
    latencyMs: {
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      avg: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(2)),
    },
    classification,
    audit: WEEK5_AUDIT,
  };

  persistSummary(runDir, summary);
  writeFileSync(join(runDir, "classification.txt"), `${summary.classification}\n`, "utf8");
  return { runDir, summary, grades };
}

const isMain = process.argv[1]?.includes("week5");
if (isMain) {
  const { runDir, summary } = runWeek5Certification({ includeHoldouts: true });
  console.log(
    JSON.stringify(
      {
        runDir,
        classification: summary.classification,
        totals: summary.totals,
        criticalFailures: summary.criticalFailures,
        highFailures: summary.highFailures,
        holdout: summary.holdout,
      },
      null,
      2,
    ),
  );
  if (summary.classification !== "WEEK5_PASS_OPEN_WEEK6") process.exitCode = 1;
}
