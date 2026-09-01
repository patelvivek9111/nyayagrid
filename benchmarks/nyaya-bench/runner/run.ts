import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GRADER_VERSION, gradeAnswer } from "../graders/grade";
import { loadGroundTruth } from "../graders/load-ground-truth";
import type { GradeResult, PersistedAnswer } from "../graders/types";
import {
  loadCatalog,
  loadMemoryCatalog,
  loadAnalysisCatalog,
  loadDepositionCatalog,
  loadContractCatalog,
  loadEvidenceCatalog,
  loadDraftCatalog,
  loadGraphCatalog,
  loadResearchCatalog,
  loadAgentsCatalog,
  loadFullSystemCatalog,
  type BenchScenario,
  type BenchTask,
} from "./catalog";
import { executeTask } from "./execute";
import { closeBenchDb, createBenchDb, ingestScenario } from "./ingest";
import { BASELINES_ROOT, RUNS_ROOT, type DatasetId } from "./paths";
import {
  answerPath,
  assertAnswerPersisted,
  copyAnswers,
  createRunDir,
  persistGrade,
  persistSummary,
  persistAnswer,
} from "./persist";
import { isApplicable } from "./routing";
import type { ExecutionMode, ExecutionTarget } from "./routing";
import { runSubsystemSmoke } from "./smoke";
import {
  summarizeAnalysisGrades,
  summarizeCompareGrades,
  summarizeContradictionGrades,
  summarizeDepositionGrades,
  summarizeContractGrades,
  summarizeEvidenceGrades,
  summarizeDraftGrades,
  summarizeGraphGrades,
  summarizeResearchGrades,
  summarizeAgentsGrades,
  summarizeFullSystemGrades,
  summarizeMemoryGrades,
  summarizeTimelineGrades,
} from "./baseline-metrics";

export type BenchCliOptions = {
  dataset: DatasetId;
  scenarioId?: string;
  taskId?: string;
  extractIntelligence?: boolean;
  writeBaseline?: boolean;
  replayRunDir?: string;
  regradeRunDirs?: string[];
  executionMode?: ExecutionMode;
  listOnly?: boolean;
  smokeSubsystems?: boolean;
  smokeTarget?: ExecutionTarget;
};

function selectTasks(scenario: BenchScenario, taskId?: string, mode?: ExecutionMode): BenchTask[] {
  if (taskId) {
    const match = scenario.tasks.filter((task) => task.taskId === taskId);
    if (match.length === 0) throw new Error(`Task ${taskId} not found in ${scenario.scenarioId}`);
    return match;
  }
  if (!mode || mode === "case-qa" || mode === "full-system") return scenario.tasks;
  return scenario.tasks.filter((task) => isApplicable(task, mode));
}

function tally(grades: GradeResult[]) {
  const infrastructure = grades.filter((row) => row.detail.startsWith("INFRASTRUCTURE:"));
  const notApplicable = grades.filter((row) => row.expectationType === "not_applicable");
  return {
    pass: grades.filter((row) => row.verdict === "pass").length,
    needs_work: grades.filter((row) => row.verdict === "needs_work").length,
    fail: grades.filter(
      (row) =>
        row.verdict === "fail" &&
        !row.detail.startsWith("INFRASTRUCTURE:") &&
        row.expectationType !== "not_applicable",
    ).length,
    infrastructure: infrastructure.length,
    notApplicable: notApplicable.length,
    criticalFails: grades.filter(
      (row) =>
        row.verdict === "fail" &&
        row.severity === "critical" &&
        !row.detail.startsWith("INFRASTRUCTURE:") &&
        row.expectationType !== "not_applicable",
    ).length,
  };
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function infrastructureGrade(taskId: string, error: unknown): GradeResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    taskId,
    verdict: "fail",
    expectationType: "infrastructure",
    severity: "critical",
    detail: `INFRASTRUCTURE: ${message}`,
    needlesRequired: [],
    needlesFound: [],
  };
}

function infrastructureAnswer(params: {
  dataset: DatasetId;
  scenarioId: string;
  task: BenchTask;
  error: unknown;
  started: number;
}): PersistedAnswer {
  const message = params.error instanceof Error ? params.error.message : String(params.error);
  return {
    dataset: params.dataset,
    scenarioId: params.scenarioId,
    taskId: params.task.taskId,
    category: params.task.category,
    prompt: params.task.prompt,
    answer: "",
    evidenceState: "infrastructure_error",
    citations: [],
    assumptions: [],
    unresolvedQuestions: [],
    retrievedChunkIds: [],
    provider: process.env.AI_PROVIDER ?? "unknown",
    model: process.env.OPENAI_MODEL ?? "unknown",
    promptVersion: null,
    artifactId: null,
    conversationId: null,
    latencyMs: Date.now() - params.started,
    extras: { infrastructureError: message },
    persistedAt: new Date().toISOString(),
  };
}

function gradePersistedTask(params: {
  runDir: string;
  dataset: DatasetId;
  scenarioId: string;
  taskId: string;
}): GradeResult {
  assertAnswerPersisted(params.runDir, params.taskId);
  const answer = JSON.parse(
    readFileSync(answerPath(params.runDir, params.taskId), "utf8"),
  ) as PersistedAnswer;
  const keys = loadGroundTruth(params.dataset, params.scenarioId);
  const expectation = keys.get(params.taskId);
  if (!expectation) {
    throw new Error(`No hidden ground truth for ${params.taskId} in ${params.scenarioId}`);
  }
  return gradeAnswer(answer, expectation);
}

export function resolveRunDir(input: string): string {
  if (existsSync(join(input, "answers"))) return resolve(input);
  const underReports = join(RUNS_ROOT, input);
  if (existsSync(join(underReports, "answers"))) return underReports;
  throw new Error(`No persisted answers found at ${input}`);
}

export function regradePersistedRuns(sourceDirs: string[]): {
  runId: string;
  runDir: string;
  summary: Record<string, unknown>;
} {
  if (sourceDirs.length === 0)
    throw new Error("regrade requires at least one original run directory");
  const sources = sourceDirs.map(resolveRunDir);
  const runId = `regrade-A1-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = createRunDir(runId);
  const grades: GradeResult[] = [];
  const sourceSummaries = [];
  const answersByTask = new Map<string, PersistedAnswer>();

  for (const source of sources) {
    const copied = copyAnswers(source, runDir);
    sourceSummaries.push({ source, answerCount: copied.length });
    for (const taskId of copied) {
      const answer = JSON.parse(
        readFileSync(answerPath(runDir, taskId), "utf8"),
      ) as PersistedAnswer;
      answersByTask.set(taskId, answer);
      const grade = gradePersistedTask({
        runDir,
        dataset: answer.dataset,
        scenarioId: answer.scenarioId,
        taskId: answer.taskId,
      });
      persistGrade(runDir, taskId, grade);
      grades.push(grade);
      console.log(`${grade.verdict.toUpperCase()}\t${taskId}\t${grade.detail}`);
    }
  }

  const summary = {
    mode: "regrade",
    runId,
    graderVersion: GRADER_VERSION,
    attorneyReviewed: false,
    syntheticOnly: true,
    benchmarkKind: "NYAYA_COMPARE_CONTRADICTION",
    sources: sourceSummaries,
    originalArtifactsUnchanged: true,
    counts: tally(grades),
    compare: summarizeCompareGrades(grades, answersByTask),
    contradiction: summarizeContradictionGrades(grades, answersByTask),
    timeline: summarizeTimelineGrades(grades, answersByTask),
    memory: summarizeMemoryGrades(grades, answersByTask),
    grades,
  };
  persistSummary(runDir, summary);
  console.log(
    JSON.stringify({ runDir, counts: summary.counts, graderVersion: GRADER_VERSION }, null, 2),
  );
  return { runId, runDir, summary };
}

export async function runBenchmark(options: BenchCliOptions) {
  if (options.regradeRunDirs && options.regradeRunDirs.length > 0) {
    return regradePersistedRuns(options.regradeRunDirs);
  }
  if (options.smokeSubsystems) {
    return runSubsystemSmoke(
      options.dataset,
      options.scenarioId ?? "SYNTH-001",
      options.smokeTarget,
    );
  }

  const catalog =
    options.executionMode === "memory"
      ? loadMemoryCatalog(options.dataset, options.scenarioId)
      : options.executionMode === "analysis"
        ? loadAnalysisCatalog(options.dataset, options.scenarioId)
        : options.executionMode === "deposition"
          ? loadDepositionCatalog(options.dataset, options.scenarioId)
          : options.executionMode === "contract"
            ? loadContractCatalog(options.dataset, options.scenarioId)
          : options.executionMode === "evidence"
            ? loadEvidenceCatalog(options.dataset, options.scenarioId)
          : options.executionMode === "draft"
            ? loadDraftCatalog(options.dataset, options.scenarioId)
          : options.executionMode === "graph"
            ? loadGraphCatalog(options.dataset, options.scenarioId)
          : options.executionMode === "research"
            ? loadResearchCatalog(options.dataset, options.scenarioId)
          : options.executionMode === "agents"
            ? loadAgentsCatalog(options.dataset, options.scenarioId)
          : options.executionMode === "full-system-fs"
            ? loadFullSystemCatalog(options.dataset, options.scenarioId)
          : loadCatalog(options.dataset, options.scenarioId);
  if (options.listOnly) {
    for (const scenario of catalog) {
      console.log(`${scenario.scenarioId}\t${scenario.tasks.length} tasks\t${scenario.title}`);
      for (const task of scenario.tasks) {
        if (options.taskId && task.taskId !== options.taskId) continue;
        console.log(`  ${task.taskId}\t${task.category}\t${task.prompt}`);
      }
    }
    return { runId: null, summary: null };
  }

  if (options.replayRunDir) {
    const runDir = options.replayRunDir;
    const answerFiles = readdirSync(join(runDir, "answers")).filter((name) =>
      name.endsWith(".json"),
    );
    const grades: GradeResult[] = [];
    for (const file of answerFiles) {
      const answer = JSON.parse(
        readFileSync(join(runDir, "answers", file), "utf8"),
      ) as PersistedAnswer;
      if (options.taskId && answer.taskId !== options.taskId) continue;
      const grade = gradePersistedTask({
        runDir,
        dataset: answer.dataset,
        scenarioId: answer.scenarioId,
        taskId: answer.taskId,
      });
      persistGrade(runDir, answer.taskId, grade);
      grades.push(grade);
    }
    const summary = {
      mode: "replay",
      runDir,
      counts: tally(grades),
      grades,
    };
    persistSummary(runDir, summary);
    return { runId: null, summary };
  }

  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = createRunDir(runId);
  const db = createBenchDb();
  const grades: GradeResult[] = [];
  const scenarioSummaries = [];
  const startedAt = new Date().toISOString();

  try {
    for (const scenario of catalog) {
      const tasks = selectTasks(scenario, options.taskId, options.executionMode);
      if (tasks.length === 0) continue;
      try {
        const matter = await ingestScenario({
          db,
          scenario,
          runId,
          extractIntelligence:
            options.executionMode === "full-system-fs" ? false : options.extractIntelligence,
          excludeFilenames:
            options.executionMode === "full-system-fs"
              ? scenario.documents.map((doc) => doc.filename)
              : undefined,
        });
        for (const task of tasks) {
          const taskStarted = Date.now();
          try {
            const persisted = await executeTask({
              db,
              scenario,
              task,
              matter,
              executionMode: options.executionMode ?? "case-qa",
            });
            persistAnswer(runDir, persisted);
            const grade =
              persisted.evidenceState === "not_applicable"
                ? {
                    taskId: task.taskId,
                    verdict: "fail" as const,
                    expectationType: "not_applicable",
                    severity: "minor" as const,
                    detail: "NOT_APPLICABLE_TO_SUBSYSTEM",
                    needlesRequired: [],
                    needlesFound: [],
                  }
                : gradePersistedTask({
                    runDir,
                    dataset: options.dataset,
                    scenarioId: scenario.scenarioId,
                    taskId: task.taskId,
                  });
            persistGrade(runDir, task.taskId, grade);
            grades.push(grade);
            console.log(`${grade.verdict.toUpperCase()}\t${task.taskId}\t${grade.detail}`);
          } catch (error) {
            const persisted = infrastructureAnswer({
              dataset: options.dataset,
              scenarioId: scenario.scenarioId,
              task,
              error,
              started: taskStarted,
            });
            persistAnswer(runDir, persisted);
            const grade = infrastructureGrade(task.taskId, error);
            persistGrade(runDir, task.taskId, grade);
            grades.push(grade);
            console.log(`INFRA\t${task.taskId}\t${grade.detail}`);
          }
        }
        scenarioSummaries.push({
          scenarioId: scenario.scenarioId,
          matterId: matter.matterId,
          documentCount: matter.documents.length,
          taskCount: tasks.length,
        });
      } catch (error) {
        for (const task of tasks) {
          const persisted = infrastructureAnswer({
            dataset: options.dataset,
            scenarioId: scenario.scenarioId,
            task,
            error,
            started: Date.now(),
          });
          persistAnswer(runDir, persisted);
          const grade = infrastructureGrade(task.taskId, error);
          persistGrade(runDir, task.taskId, grade);
          grades.push(grade);
          console.log(`INFRA\t${task.taskId}\t${grade.detail}`);
        }
        scenarioSummaries.push({
          scenarioId: scenario.scenarioId,
          matterId: null,
          documentCount: 0,
          taskCount: tasks.length,
          ingestError: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const firstAnswer = grades.length
      ? (JSON.parse(readFileSync(answerPath(runDir, grades[0]!.taskId), "utf8")) as PersistedAnswer)
      : null;
    const answers = new Map<string, PersistedAnswer>();
    for (const grade of grades) {
      const persisted = JSON.parse(
        readFileSync(answerPath(runDir, grade.taskId), "utf8"),
      ) as PersistedAnswer;
      answers.set(grade.taskId, persisted);
    }
    const summary = {
      mode: "live",
      runId,
      dataset: options.dataset,
      executionMode: options.executionMode ?? "case-qa",
      attorneyReviewed: false,
      syntheticOnly: true,
      benchmarkKind:
        options.executionMode === "compare" ||
        options.executionMode === "contradictions" ||
        options.executionMode === "compare-contradiction" ||
        options.executionMode === "timeline" ||
        options.executionMode === "memory" ||
        options.executionMode === "analysis" ||
        options.executionMode === "deposition" ||
        options.executionMode === "contract" ||
        options.executionMode === "evidence" ||
        options.executionMode === "draft" ||
        options.executionMode === "graph" ||
        options.executionMode === "research" ||
        options.executionMode === "agents" ||
        options.executionMode === "full-system-fs"
          ? options.executionMode === "full-system-fs"
            ? "NYAYA_FULL_SYSTEM"
            : options.executionMode === "agents"
            ? "NYAYA_AGENTS"
            : options.executionMode === "research"
            ? "NYAYA_RESEARCH"
            : options.executionMode === "graph"
            ? "NYAYA_GRAPH"
            : options.executionMode === "draft"
            ? "NYAYA_DRAFT"
            : options.executionMode === "evidence"
            ? "NYAYA_EVIDENCE"
            : options.executionMode === "contract"
            ? "NYAYA_CONTRACT"
            : options.executionMode === "deposition"
            ? "NYAYA_DEPOSITION"
            : options.executionMode === "analysis"
              ? "NYAYA_ANALYSIS"
              : options.executionMode === "memory"
                ? "NYAYA_MEMORY"
                : options.executionMode === "timeline"
                  ? "NYAYA_TIMELINE"
                  : "NYAYA_COMPARE_CONTRADICTION"
          : "NYAYA_CASE_QA",
      config: {
        gitCommit: gitCommit(),
        aiProvider: process.env.AI_PROVIDER ?? "unknown",
        model: firstAnswer?.model ?? process.env.OPENAI_MODEL ?? "unknown",
        embeddingProvider: process.env.EMBEDDING_PROVIDER ?? "unknown",
        promptVersion: firstAnswer?.promptVersion ?? null,
        startedAt,
        finishedAt: new Date().toISOString(),
      },
      counts: tally(grades),
      compare: summarizeCompareGrades(grades, answers),
      contradiction: summarizeContradictionGrades(grades, answers),
      timeline: summarizeTimelineGrades(grades, answers),
      memory: summarizeMemoryGrades(grades, answers),
      analysis: summarizeAnalysisGrades(grades, answers),
      deposition: summarizeDepositionGrades(grades, answers),
      contract: summarizeContractGrades(grades, answers),
      evidence: summarizeEvidenceGrades(grades, answers),
      draft: summarizeDraftGrades(grades, answers),
      graph: summarizeGraphGrades(grades, answers),
      research: summarizeResearchGrades(grades, answers),
      agents: summarizeAgentsGrades(grades, answers),
      fullSystem: summarizeFullSystemGrades(grades, answers),
      scenarios: scenarioSummaries,
      grades,
    };
    persistSummary(runDir, summary);

    if (options.writeBaseline) {
      const baselinePath = join(BASELINES_ROOT, `${options.dataset}-latest.json`);
      writeFileSync(baselinePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
      if (options.executionMode === "full-system-fs") {
        const fs1 = join(BASELINES_ROOT, "BASELINE_FS1_FULL_SYSTEM.json");
        const fs2 = join(BASELINES_ROOT, "BASELINE_FS2_FULL_SYSTEM.json");
        if (!existsSync(fs1)) {
          writeFileSync(fs1, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
        } else {
          writeFileSync(fs2, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
        }
      }
    }

    console.log(
      JSON.stringify({ runDir, counts: summary.counts, attorneyReviewed: false }, null, 2),
    );
    return { runId, summary };
  } finally {
    await closeBenchDb(db);
  }
}

export function parseArgs(argv: string[]): BenchCliOptions {
  const args = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;
    if (!token.startsWith("--") && !token.startsWith("-")) {
      positional.push(token);
      continue;
    }
    const key = token.replace(/^--?/, "");
    const next = argv[i + 1];
    if (!next || next.startsWith("-")) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i += 1;
    }
  }

  if (positional[0] === "regrade" || args.get("regrade")) {
    const dirs =
      positional[0] === "regrade"
        ? positional.slice(1)
        : typeof args.get("regrade") === "string"
          ? [args.get("regrade") as string, ...positional.filter((token) => token !== "regrade")]
          : positional;
    return {
      dataset: "v1",
      regradeRunDirs: dirs,
      listOnly: false,
    };
  }

  if (positional[0] === "replay" || args.get("replay")) {
    const replayRunDir =
      typeof args.get("replay") === "string"
        ? (args.get("replay") as string)
        : positional[0] === "replay"
          ? positional.slice(1).join(" ")
          : undefined;
    return {
      dataset: "v1",
      replayRunDir,
      listOnly: false,
    };
  }

  const datasetToken = args.get("dataset") ?? args.get("d") ?? positional[0];
  const dataset = (datasetToken === "v2" ? "v2" : "v1") as DatasetId;
  const command = positional[0] === "v1" || positional[0] === "v2" ? positional[1] : positional[0];
  let scenarioPos =
    positional[0] === "v1" || positional[0] === "v2" ? positional[2] : positional[1];
  let taskPos = positional[0] === "v1" || positional[0] === "v2" ? positional[3] : positional[2];
  const replay = args.get("replay");
  const replayRunDir = typeof replay === "string" ? replay : undefined;
  const explicitRun = args.get("run") === true || command === "run";
  const positionalMode =
    command === "run" && isExecutionMode(scenarioPos) ? scenarioPos : undefined;
  if (positionalMode) {
    scenarioPos = taskPos;
    taskPos = positional[0] === "v1" || positional[0] === "v2" ? positional[4] : positional[3];
  }
  const modeToken = (args.get("mode") as string | undefined) ?? positionalMode ?? command;
  const executionMode = parseExecutionMode(modeToken);
  const smokeSubsystems = command === "smoke-subsystems" || args.get("smoke-subsystems") === true;
  const smokeTargetToken =
    (typeof args.get("smoke-target") === "string"
      ? (args.get("smoke-target") as string)
      : undefined) ??
    (typeof args.get("target") === "string" ? (args.get("target") as string) : undefined) ??
    (smokeSubsystems && typeof scenarioPos === "string" ? scenarioPos : undefined);
  const smokeTarget = isExecutionTarget(smokeTargetToken) ? smokeTargetToken : undefined;
  return {
    dataset,
    scenarioId:
      typeof args.get("scenario") === "string"
        ? (args.get("scenario") as string)
        : smokeSubsystems
          ? "SYNTH-001"
          : scenarioPos,
    taskId: typeof args.get("task") === "string" ? (args.get("task") as string) : taskPos,
    extractIntelligence:
      args.get("extract-intelligence") === true ||
      command === "extract" ||
      executionMode === "timeline" ||
      executionMode === "full-system",
    writeBaseline: args.get("write-baseline") === true || positional.includes("write-baseline"),
    replayRunDir,
    executionMode,
    smokeSubsystems,
    smokeTarget,
    listOnly:
      !explicitRun && command !== "smoke-subsystems" && !replayRunDir && command !== "regrade",
  };
}

function isExecutionTarget(value: string | undefined): value is ExecutionTarget {
  return (
    value === "case_qa" ||
    value === "contract_compare" ||
    value === "contradiction" ||
    value === "timeline" ||
    value === "graph" ||
    value === "memory" ||
    value === "research" ||
    value === "draft" ||
    value === "analysis" ||
    value === "professional_analysis" ||
    value === "agent" ||
    value === "full_system"
  );
}

function isExecutionMode(value: string | undefined): value is ExecutionMode {
  return (
    value === "case-qa" ||
    value === "full-system" ||
    value === "compare" ||
    value === "contradictions" ||
    value === "compare-contradiction" ||
    value === "timeline" ||
    value === "graph" ||
    value === "memory" ||
    value === "research" ||
    value === "draft" ||
    value === "analysis" ||
    value === "deposition" ||
    value === "contract" ||
    value === "evidence" ||
    value === "agents" ||
    value === "full-system-fs"
  );
}

function parseExecutionMode(token: string | undefined): ExecutionMode {
  if (isExecutionMode(token)) return token;
  return "case-qa";
}
