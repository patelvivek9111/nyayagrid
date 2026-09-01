import { existsSync } from "node:fs";
import { join } from "node:path";
import { BASELINES_ROOT } from "./paths";

export const HISTORICAL_C1_JSON = join(BASELINES_ROOT, "BASELINE_6T_C1_50_STATE.json");
export const HISTORICAL_C1_MD = join(BASELINES_ROOT, "BASELINE_6T_C1_50_STATE.md");
export const HISTORICAL_C1_PHASE_REPORT = join(
  BASELINES_ROOT,
  "PHASE_6T_50_STATE_JURISDICTION_CERTIFICATION.md",
);

/**
 * C1 is the empty-corpus architecture snapshot. Recertification after corpus build is C2A.
 * Set T6T_OVERWRITE_C1=1 only if an operator intentionally replaces that historical artifact.
 */
export function shouldPreserveHistoricalC1(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.T6T_OVERWRITE_C1 === "1") return false;
  return existsSync(HISTORICAL_C1_JSON);
}
