import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BENCH_ROOT } from "./paths";

function applyDotEnvFile(filePath: string): void {
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
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

/** Load repo `.env` without overriding variables already in the process. */
export function loadBenchEnv(): void {
  applyDotEnvFile(resolve(BENCH_ROOT, "../../.env"));
  applyDotEnvFile(resolve(BENCH_ROOT, ".env"));
}
