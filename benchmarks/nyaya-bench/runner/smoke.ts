import { loadCatalog } from "./catalog";
import { executeTask } from "./execute";
import { closeBenchDb, createBenchDb, ingestScenario } from "./ingest";
import type { DatasetId } from "./paths";
import { createRunDir, persistAnswer, persistSummary } from "./persist";
import type { ExecutionTarget } from "./routing";

const SMOKE_TARGETS: Array<{
  target: ExecutionTarget;
  taskId: string;
  mode: "case-qa" | "full-system" | "agents";
}> = [
  { target: "case_qa", taskId: "SYNTH-001-Q001", mode: "case-qa" },
  { target: "contract_compare", taskId: "SYNTH-001-Q007", mode: "full-system" },
  { target: "contradiction", taskId: "SYNTH-001-Q006", mode: "full-system" },
  { target: "timeline", taskId: "SYNTH-001-Q005", mode: "full-system" },
  { target: "graph", taskId: "SYNTH-001-Q003", mode: "full-system" },
  { target: "memory", taskId: "SYNTH-001-Q002", mode: "full-system" },
  { target: "research", taskId: "SYNTH-001-Q001", mode: "full-system" },
  { target: "draft", taskId: "SYNTH-001-Q009", mode: "full-system" },
  { target: "agent", taskId: "SYNTH-001-Q007", mode: "agents" },
];

export async function runSubsystemSmoke(
  dataset: DatasetId = "v1",
  scenarioId = "SYNTH-001",
  smokeTarget?: ExecutionTarget,
) {
  const catalog = loadCatalog(dataset, scenarioId);
  const scenario = catalog[0];
  if (!scenario) throw new Error(`No scenario ${scenarioId}`);
  const runId = `smoke-subsystems-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runDir = createRunDir(runId);
  const db = createBenchDb();
  const rows: Array<Record<string, unknown>> = [];
  const targets = smokeTarget
    ? SMOKE_TARGETS.filter((row) => row.target === smokeTarget)
    : SMOKE_TARGETS;
  if (targets.length === 0) {
    throw new Error(`Unknown smoke target: ${smokeTarget}`);
  }

  try {
    const matter = await ingestScenario({
      db,
      scenario,
      runId,
      extractIntelligence: true,
    });
    for (const smoke of targets) {
      const task = scenario.tasks.find((row) => row.taskId === smoke.taskId) ?? scenario.tasks[0]!;
      const started = Date.now();
      try {
        const persisted = await executeTask({
          db,
          scenario,
          task,
          matter,
          executionMode: smoke.mode,
          executionTargetOverride: smoke.target,
        });
        persistAnswer(runDir, { ...persisted, taskId: `SMOKE-${smoke.target}` });
        const extras = persisted.extras ?? {};
        const gradedSubsystemOutput = extras.executionTarget === smoke.target;
        const graphExtractFailed = smoke.target === "graph" && Boolean(extras.graphExtractError);
        rows.push({
          target: smoke.target,
          ok: true,
          gradedSubsystemOutput,
          graphExtractFailed,
          executionTarget: extras.executionTarget,
          latencyMs: Date.now() - started,
          answerChars: persisted.answer.length,
          extrasKeys: Object.keys(extras),
        });
        const tag = !gradedSubsystemOutput
          ? "SMOKE_WARN"
          : graphExtractFailed
            ? "SMOKE_OK_PRODUCT_ERROR"
            : "SMOKE_OK";
        console.log(
          `${tag}\t${smoke.target}\tchars=${persisted.answer.length}\ttarget=${String(extras.executionTarget)}`,
        );
      } catch (error) {
        rows.push({
          target: smoke.target,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          latencyMs: Date.now() - started,
        });
        console.log(
          `SMOKE_FAIL\t${smoke.target}\t${error instanceof Error ? error.message : error}`,
        );
      }
    }
  } finally {
    await closeBenchDb(db);
  }

  const summary = {
    mode: "smoke-subsystems",
    runId,
    attorneyReviewed: false,
    rows,
  };
  persistSummary(runDir, summary);
  console.log(JSON.stringify({ runDir, rows }, null, 2));
  return { runId, runDir, summary };
}
