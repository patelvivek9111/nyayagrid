import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBenchEnv } from "./load-env";
import { RUNS_ROOT } from "./paths";

loadBenchEnv();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

type StepResult = {
  id: string;
  command: string;
  exitCode: number;
  status: "PASS" | "FAIL";
};

function runStep(id: string, args: string[], env: NodeJS.ProcessEnv = {}): StepResult {
  const command = `npm ${args.join(" ")}`;
  console.log(`\n=== J1 ${id} ===\n${command}\n`);
  const result = spawnSync("npm", args, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: true,
  });
  const exitCode = result.status ?? 1;
  return { id, command, exitCode, status: exitCode === 0 ? "PASS" : "FAIL" };
}

const steps: StepResult[] = [
  runStep("J001-J009-J017-J020", ["test", "-w", "@nyayagrid/jurisdiction"]),
  runStep("J013-J014-temporal", [
    "test",
    "-w",
    "@nyayagrid/research",
    "--",
    "src/jurisdiction-layer.test.ts",
  ]),
  runStep(
    "J010-J011-J012-J015-J016-J018-J019",
    ["test", "-w", "@nyayagrid/permissions", "--", "src/phase6s.integration.test.ts"],
    { RUN_DB_TESTS: "1" },
  ),
];

const failed = steps.filter((step) => step.status === "FAIL");
const summary = {
  id: "j1-closeout",
  name: "Phase 6S Nyaya Jurisdiction J1",
  generatedAt: new Date().toISOString(),
  status: failed.length === 0 ? "PASS" : "FAIL",
  pass: steps.filter((step) => step.status === "PASS").length,
  fail: failed.length,
  steps,
  livePaths: {
    J012: "askNyayaAboutMatter",
    J015: "generateDraft",
    J016: "executeAgentRun + production FEATURE_AGENTS default off",
  },
};

mkdirSync(RUNS_ROOT, { recursive: true });
const outDir = join(RUNS_ROOT, "j1-closeout");
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`\nJ1 summary written to ${join(outDir, "summary.json")}`);
console.log(JSON.stringify({ status: summary.status, pass: summary.pass, fail: summary.fail }, null, 2));

process.exit(failed.length > 0 ? 1 : 0);
