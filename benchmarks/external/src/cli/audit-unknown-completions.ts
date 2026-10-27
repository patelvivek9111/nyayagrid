/**
 * Local audit of UNKNOWN_COMPLETION artifacts. Zero provider calls.
 * Usage: node ... audit-unknown-completions --run-id <id>
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getCacheDir } from "../paths.js";
import {
  auditUnknownCompletions,
  listUnknownCompletions,
  readRunUnknownQuarantine,
} from "../live/unknown-completion.js";

function parseArgValue(argv: readonly string[], name: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name) return argv[i + 1] ?? null;
    if (argv[i]?.startsWith(`${name}=`)) return argv[i]!.slice(name.length + 1) || null;
  }
  return null;
}

function main(): void {
  const runId = parseArgValue(process.argv, "--run-id");
  if (!runId) {
    console.error(JSON.stringify({ error: "Missing --run-id", paidCalls: 0 }));
    process.exitCode = 2;
    return;
  }
  const successTaskIds = new Set<string>();
  const respDir = path.join(getCacheDir(), "runs", runId, "response");
  if (existsSync(respDir)) {
    for (const f of readdirSync(respDir).filter((x) => x.endsWith(".json"))) {
      try {
        const payload = JSON.parse(readFileSync(path.join(respDir, f), "utf8")) as {
          taskId?: string;
          completionStatus?: string;
        };
        if (payload.taskId && payload.completionStatus !== "failed") {
          successTaskIds.add(payload.taskId);
        }
      } catch {
        /* skip */
      }
    }
  }
  const rows = auditUnknownCompletions({ runId, successTaskIds });
  const quarantine = readRunUnknownQuarantine(runId);
  console.log(
    JSON.stringify(
      {
        runId,
        unknownCount: listUnknownCompletions(runId).length,
        quarantine,
        rows,
        knownLedgerSpendNote: "see stage2-progress.json totalSpendUsd",
        unverifiedProviderBillingExposure: quarantine ? "YES" : rows.length ? "YES" : "NO",
        paidCalls: 0,
        courtListener: 0,
      },
      null,
      2,
    ),
  );
}

main();
