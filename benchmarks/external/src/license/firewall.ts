import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";

export const LICENSE_STATUSES = [
  "COMMERCIAL_INTERNAL_EVAL_OK",
  "INTERNAL_NONCOMMERCIAL_ONLY",
  "LICENSE_REVIEW_REQUIRED",
  "EXCLUDE",
  "RESEARCH_ONLY_NOT_FOR_PRODUCTION_SELECTION",
] as const;

export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

export type LicenseEvalMode = "production-selection" | "research";

export type LicenseAssertionResult = {
  allowed: boolean;
  status: LicenseStatus;
  tag?: "NOT_FOR_PRODUCTION_SELECTION";
  reason?: string;
};

type LegalBenchTaskLicenseEntry = {
  task_id: string;
  status: LicenseStatus;
};

type LegalBenchTaskLicenseFile = {
  tasks: LegalBenchTaskLicenseEntry[];
};

type RagSourceLicenseEntry = {
  status: LicenseStatus;
  commercial_internal_eval?: boolean;
};

type RagSourceLicenseFile = {
  sources: Record<string, RagSourceLicenseEntry>;
};

let taskLicenseCache: Map<string, LicenseStatus> | null = null;
let ragSourceCache: Map<string, LicenseStatus> | null = null;

function loadTaskLicenseMap(): Map<string, LicenseStatus> {
  if (taskLicenseCache) return taskLicenseCache;
  const raw = readFileSync(path.join(getRegistryDir(), "legalbench-task-licenses.json"), "utf8");
  const parsed = JSON.parse(raw) as LegalBenchTaskLicenseFile;
  taskLicenseCache = new Map(parsed.tasks.map((t) => [t.task_id, t.status]));
  return taskLicenseCache;
}

function loadRagSourceMap(): Map<string, LicenseStatus> {
  if (ragSourceCache) return ragSourceCache;
  const raw = readFileSync(
    path.join(getRegistryDir(), "legalbench-rag-source-licenses.json"),
    "utf8",
  );
  const parsed = JSON.parse(raw) as RagSourceLicenseFile;
  ragSourceCache = new Map(Object.entries(parsed.sources).map(([k, v]) => [k, v.status]));
  return ragSourceCache;
}

export function loadLegalBenchTaskLicense(taskId: string): LicenseStatus {
  const upstreamTask = taskId.split("::")[0] ?? taskId;
  const status = loadTaskLicenseMap().get(upstreamTask);
  if (!status) {
    return "LICENSE_REVIEW_REQUIRED";
  }
  return status;
}

export function loadRagSourceLicense(source: string): LicenseStatus {
  const status = loadRagSourceMap().get(source);
  if (!status) {
    return "LICENSE_REVIEW_REQUIRED";
  }
  return status;
}

export function assertCommercialEvalAllowed(
  task: { benchmarkId: string; taskId: string; metadata?: Record<string, unknown> | null },
  mode: LicenseEvalMode,
): LicenseAssertionResult {
  let status: LicenseStatus;

  if (task.benchmarkId === "prbench") {
    status = "COMMERCIAL_INTERNAL_EVAL_OK";
  } else if (task.benchmarkId === "legalbench") {
    status = loadLegalBenchTaskLicense(task.taskId);
  } else if (task.benchmarkId === "legalbench-rag") {
    const source =
      (typeof task.metadata?.upstreamSource === "string" && task.metadata.upstreamSource) ||
      task.taskId.split("::")[0] ||
      "";
    status = loadRagSourceLicense(source);
  } else if (task.benchmarkId === "legalcitebench") {
    status = "COMMERCIAL_INTERNAL_EVAL_OK";
  } else if (task.benchmarkId === "casefacts" || task.benchmarkId === "legal-rag-bench") {
    status = "RESEARCH_ONLY_NOT_FOR_PRODUCTION_SELECTION";
  } else {
    status = "LICENSE_REVIEW_REQUIRED";
  }

  if (mode === "production-selection") {
    if (status !== "COMMERCIAL_INTERNAL_EVAL_OK") {
      return {
        allowed: false,
        status,
        reason: `Task ${task.taskId} status ${status} is not cleared for production-selection commercial eval.`,
      };
    }
    return { allowed: true, status };
  }

  if (status === "EXCLUDE" || status === "INTERNAL_NONCOMMERCIAL_ONLY") {
    return {
      allowed: false,
      status,
      reason: `Task ${task.taskId} status ${status} is excluded from research eval.`,
    };
  }

  if (
    status === "RESEARCH_ONLY_NOT_FOR_PRODUCTION_SELECTION" ||
    status === "LICENSE_REVIEW_REQUIRED"
  ) {
    return {
      allowed: true,
      status,
      tag: "NOT_FOR_PRODUCTION_SELECTION",
    };
  }

  return { allowed: true, status };
}

export function isCommercialInternalEvalOk(status: LicenseStatus): boolean {
  return status === "COMMERCIAL_INTERNAL_EVAL_OK";
}

export function resetLicenseFirewallCachesForTests(): void {
  taskLicenseCache = null;
  ragSourceCache = null;
}
