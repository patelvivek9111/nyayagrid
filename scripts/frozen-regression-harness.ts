#!/usr/bin/env npx tsx
/**
 * Phase 6W frozen-regression harness.
 *
 * Sequential only. Per-suite timeout. Separate logs. Lock file prevents stacking.
 * Does not overwrite historical BASELINE_* / PHASE_* artifacts: live writers either
 * omit --write-baseline or write under NYAYA_BENCH_BASELINES_ROOT=.../6w-regression.
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { harnessGateFailed, interpretFrozenSuiteOutput } from "./frozen-suite-status";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

function applyDotEnv(filePath: string) {
  if (!existsSync(filePath)) return;
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
applyDotEnv(join(repoRoot, ".env"));
const lockPath = join(repoRoot, "tmp", "6w-frozen.lock");
const logDir = join(repoRoot, "tmp", "6w-frozen");
const regressionDir = join(repoRoot, "benchmarks", "nyaya-bench", "baselines", "6w-regression");
const summaryPath = join(
  repoRoot,
  "benchmarks",
  "nyaya-bench",
  "baselines",
  process.env.FROZEN_SUMMARY_NAME ?? "BASELINE_6W_R1_FROZEN.json",
);

type Suite = {
  id: string;
  critical: boolean;
  timeoutMs: number;
  command: string;
  args: string[];
  env?: Record<string, string>;
  cwd?: string;
};

const suites: Suite[] = [
  {
    id: "unit-openai-retry",
    critical: true,
    timeoutMs: 120_000,
    command: "npm",
    args: ["test", "-w", "@nyayagrid/ai", "--", "src/openai-http.test.ts", "src/fallback.test.ts"],
  },
  {
    id: "unit-feature-flags",
    critical: true,
    timeoutMs: 60_000,
    command: "npm",
    args: ["test", "-w", "@nyayagrid/platform", "--", "src/features.test.ts", "src/config.test.ts"],
  },
  {
    id: "unit-http-errors",
    critical: true,
    timeoutMs: 60_000,
    command: "npm",
    args: ["test", "-w", "@nyayagrid/web", "--", "src/lib/http.test.ts"],
  },
  {
    id: "unit-analysis-trust",
    critical: true,
    timeoutMs: 120_000,
    command: "npm",
    args: ["test", "-w", "@nyayagrid/intelligence", "--", "src/analysis/context.test.ts"],
  },
  {
    id: "unit-draft-source-limitation",
    critical: true,
    timeoutMs: 120_000,
    command: "npm",
    args: ["test", "-w", "@nyayagrid/intelligence", "--", "src/contract-span.test.ts", "src/memory/trust.test.ts"],
  },
  {
    id: "j1",
    critical: true,
    timeoutMs: 600_000,
    command: "npm",
    args: ["run", "bench:j1"],
  },
  {
    id: "isolation-rbac",
    critical: true,
    timeoutMs: 600_000,
    command: "npm",
    args: [
      "test",
      "-w",
      "@nyayagrid/permissions",
      "--",
      "src/index.test.ts",
      "src/beta-security-audit.integration.test.ts",
      "src/phase6s.integration.test.ts",
    ],
    env: { RUN_DB_TESTS: "1" },
  },
  {
    id: "compare-b2",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "compare"],
  },
  {
    id: "contradiction-b2",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "contradictions"],
  },
  {
    id: "timeline-t2",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "timeline"],
  },
  {
    id: "memory-m2",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "memory"],
  },
  {
    id: "analysis-trust-live",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "analysis"],
  },
  {
    id: "deposition-da1",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "deposition"],
  },
  {
    id: "contract-ca1",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "contract"],
  },
  {
    id: "evidence-em2",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "evidence"],
  },
  {
    id: "graph-g2",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "graph"],
  },
  {
    id: "research-r1",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "research"],
  },
  {
    id: "draft-source-limitation-live",
    critical: true,
    timeoutMs: 1_800_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "draft"],
  },
  {
    id: "full-system-6r",
    critical: true,
    timeoutMs: 2_400_000,
    command: "npm",
    args: ["run", "bench", "--", "v2", "run", "--mode", "full-system-fs"],
  },
  {
    id: "c2a-critical",
    critical: true,
    timeoutMs: 2_400_000,
    command: "npx",
    args: ["tsx", "runner/t6t-c2a.ts"],
    cwd: join(repoRoot, "benchmarks", "nyaya-bench"),
    env: {
      NYAYA_BENCH_BASELINES_ROOT: regressionDir,
      T6T_C2A_BASELINE: "6W_REGRESSION",
    },
  },
  {
    id: "6u-r1",
    critical: true,
    timeoutMs: 2_400_000,
    command: "npx",
    args: ["tsx", "runner/t6u.ts"],
    cwd: join(repoRoot, "benchmarks", "nyaya-bench"),
    env: {
      T6U_BASELINE: "6W_REGRESSION",
    },
  },
];

type SuiteResult = {
  id: string;
  critical: boolean;
  processStatus: "exited" | "timeout" | "crash";
  suiteStatus: "PASS" | "NEEDS_WORK" | "FAIL" | "CRITICAL";
  status: "PASS" | "FAIL" | "TIMEOUT" | "SKIPPED" | "CRITICAL" | "NEEDS_WORK";
  exitCode: number | null;
  criticalFails: number;
  infrastructure: number;
  elapsedMs: number;
  log: string;
};

function acquireLock() {
  mkdirSync(dirname(lockPath), { recursive: true });
  if (existsSync(lockPath)) {
    const previous = readFileSync(lockPath, "utf8").trim();
    throw new Error(`Frozen harness already running (lock ${lockPath}: ${previous}).`);
  }
  writeFileSync(lockPath, `${process.pid} ${new Date().toISOString()}\n`);
}

function releaseLock() {
  try {
    unlinkSync(lockPath);
  } catch {
    /* ignore */
  }
}

function installLockSignals() {
  const onSignal = (signal: NodeJS.Signals) => {
    releaseLock();
    process.exit(signal === "SIGINT" ? 130 : 143);
  };
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("SIGTERM", () => onSignal("SIGTERM"));
}

function runSuite(suite: Suite): Promise<SuiteResult> {
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, `${suite.id}.log`);
  const started = Date.now();
  console.log(`\n=== 6W frozen ${suite.id} ===`);
  return new Promise((resolvePromise) => {
    const child = spawn(suite.command, suite.args, {
      cwd: suite.cwd ?? repoRoot,
      env: { ...process.env, ...suite.env },
      shell: true,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    const onData = (buf: Buffer) => {
      chunks.push(buf);
      process.stdout.write(buf);
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) child.kill("SIGKILL");
      }, 5_000);
    }, suite.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      const elapsedMs = Date.now() - started;
      const output = Buffer.concat(chunks).toString("utf8");
      writeFileSync(logFile, output);
      const timedOut = elapsedMs >= suite.timeoutMs - 50;
      const gate = interpretFrozenSuiteOutput({
        output,
        exitCode: code,
        timedOut,
      });
      resolvePromise({
        id: suite.id,
        critical: suite.critical,
        processStatus: gate.processStatus,
        suiteStatus: gate.suiteStatus,
        status: timedOut ? "TIMEOUT" : gate.suiteStatus,
        exitCode: code,
        criticalFails: gate.criticalFails,
        infrastructure: gate.infrastructure,
        elapsedMs,
        log: logFile.replace(repoRoot, "."),
      });
    });
  });
}

async function main() {
const only = process.argv.includes("--unit-only");
const selected = only ? suites.filter((s) => s.timeoutMs <= 600_000 && !s.id.includes("live") && !["compare-b2", "contradiction-b2", "timeline-t2", "memory-m2", "analysis-trust-live", "deposition-da1", "contract-ca1", "evidence-em2", "graph-g2", "research-r1", "draft-source-limitation-live", "full-system-6r", "c2a-critical", "6u-r1"].includes(s.id)) : suites;

acquireLock();
installLockSignals();
mkdirSync(regressionDir, { recursive: true });
const results: SuiteResult[] = [];
try {
  for (const suite of selected) {
    const result = await runSuite(suite);
    results.push(result);
    writeFileSync(
      summaryPath,
      `${JSON.stringify({ generatedAt: new Date().toISOString(), inProgress: true, results }, null, 2)}\n`,
    );
    if (harnessGateFailed(
      {
        processStatus: result.processStatus,
        suiteStatus: result.suiteStatus,
        criticalFails: result.criticalFails,
        fails: result.suiteStatus === "FAIL" ? 1 : 0,
        needsWork: result.suiteStatus === "NEEDS_WORK" ? 1 : 0,
        infrastructure: result.infrastructure,
      },
      suite.critical,
    ) && process.argv.includes("--fail-fast")) {
      break;
    }
  }
} finally {
  releaseLock();
}

const criticalFailures = results.filter((r) =>
  harnessGateFailed(
    {
      processStatus: r.processStatus,
      suiteStatus: r.suiteStatus,
      criticalFails: r.criticalFails,
      fails: r.suiteStatus === "FAIL" ? 1 : 0,
      needsWork: r.suiteStatus === "NEEDS_WORK" ? 1 : 0,
      infrastructure: r.infrastructure,
    },
    r.critical,
  ),
);
const summary = {
  id: "BASELINE_6W_R1_FROZEN",
  generatedAt: new Date().toISOString(),
  policy: "sequential, per-suite timeout, lock file, parse suite JSON, no historical baseline overwrite",
  unitOnly: only,
  results,
  pass: results.filter((r) => r.suiteStatus === "PASS").length,
  fail: results.filter((r) => r.suiteStatus === "FAIL" || r.status === "TIMEOUT").length,
  timeout: results.filter((r) => r.status === "TIMEOUT").length,
  criticalFailures: criticalFailures.map((r) => r.id),
};
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify({ ...summary, results: summary.results.map((r) => ({ id: r.id, processStatus: r.processStatus, suiteStatus: r.suiteStatus, criticalFails: r.criticalFails, infrastructure: r.infrastructure, elapsedMs: r.elapsedMs })) }, null, 2));
process.exit(summary.criticalFailures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  releaseLock();
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
