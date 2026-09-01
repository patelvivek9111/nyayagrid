export type ProcessStatus = "exited" | "timeout" | "crash";
export type SuiteStatus = "PASS" | "NEEDS_WORK" | "FAIL" | "CRITICAL";

export type FrozenSuiteGate = {
  processStatus: ProcessStatus;
  suiteStatus: SuiteStatus;
  criticalFails: number;
  fails: number;
  needsWork: number;
  infrastructure: number;
};

function extractJsonObjects(output: string): unknown[] {
  const objects: unknown[] = [];
  for (let i = 0; i < output.length; i += 1) {
    if (output[i] !== "{") continue;
    let depth = 0;
    for (let j = i; j < output.length; j += 1) {
      const ch = output[j];
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const slice = output.slice(i, j + 1);
          try {
            objects.push(JSON.parse(slice) as unknown);
          } catch {
            /* not a complete JSON object */
          }
          i = j;
          break;
        }
      }
    }
  }
  return objects;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberAt(record: Record<string, unknown> | null, key: string): number | null {
  if (!record) return null;
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function nested(record: Record<string, unknown> | null, key: string): Record<string, unknown> | null {
  if (!record) return null;
  return asRecord(record[key]);
}

/**
 * Derive suite status from machine-readable summaries in the child log.
 * Exit 0 means the runner executed; it does not mean the benchmark passed.
 */
export function interpretFrozenSuiteOutput(params: {
  output: string;
  exitCode: number | null;
  timedOut: boolean;
}): FrozenSuiteGate {
  if (params.timedOut) {
    return {
      processStatus: "timeout",
      suiteStatus: "FAIL",
      criticalFails: 0,
      fails: 1,
      needsWork: 0,
      infrastructure: 0,
    };
  }
  const processStatus: ProcessStatus =
    params.exitCode === 0 ? "exited" : params.exitCode == null ? "crash" : "crash";

  let criticalFails = 0;
  let fails = 0;
  let needsWork = 0;
  let infrastructure = 0;
  let explicitFail = false;

  for (const object of extractJsonObjects(params.output)) {
    const root = asRecord(object);
    const counts = nested(root, "counts") ?? nested(root, "totals") ?? root;
    const parsedCritical =
      numberAt(counts, "criticalFails") ??
      numberAt(counts, "critical") ??
      numberAt(root, "criticalFails");
    const parsedFail = numberAt(counts, "fail") ?? numberAt(counts, "fails");
    const parsedNw = numberAt(counts, "needs_work") ?? numberAt(counts, "needsWork");
    const parsedInfra =
      numberAt(counts, "infrastructure") ?? numberAt(counts, "infrastructureFails");
    if (parsedCritical != null) criticalFails = Math.max(criticalFails, parsedCritical);
    if (parsedFail != null) fails = Math.max(fails, parsedFail);
    if (parsedNw != null) needsWork = Math.max(needsWork, parsedNw);
    if (parsedInfra != null) infrastructure = Math.max(infrastructure, parsedInfra);

    const safety = numberAt(root, "criticalSafety");
    if (safety != null && safety < 100) {
      criticalFails = Math.max(criticalFails, 1);
    }
    const criticalFailures = root?.criticalFailures;
    if (Array.isArray(criticalFailures) && criticalFailures.length > 0) {
      criticalFails = Math.max(criticalFails, criticalFailures.length);
    }
    if (root?.gate === false || root?.passed === false) explicitFail = true;
  }

  let suiteStatus: SuiteStatus = "PASS";
  if (criticalFails > 0) suiteStatus = "CRITICAL";
  else if (explicitFail || (processStatus === "crash" && fails === 0 && needsWork === 0)) {
    suiteStatus = "FAIL";
  } else if (fails > 0 || infrastructure > 0) suiteStatus = "FAIL";
  else if (needsWork > 0) suiteStatus = "NEEDS_WORK";
  else if (processStatus !== "exited") suiteStatus = "FAIL";

  return { processStatus, suiteStatus, criticalFails, fails, needsWork, infrastructure };
}

export function harnessGateFailed(gate: FrozenSuiteGate, criticalSuite: boolean): boolean {
  if (gate.processStatus === "timeout") return true;
  if (gate.suiteStatus === "CRITICAL") return true;
  if (criticalSuite && gate.processStatus === "crash") return true;
  if (criticalSuite && gate.infrastructure > 0) return true;
  return false;
}
