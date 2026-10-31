import { readFileSync } from "node:fs";
import path from "node:path";
import { getRegistryDir } from "../paths.js";
import {
  assertCommercialEvalAllowed,
  loadLegalBenchTaskLicense,
  type LicenseEvalMode,
  type LicenseStatus,
} from "../license/firewall.js";

export type ExternalLicenseClass =
  "PERMITTED" | "PERMITTED_WITH_ATTRIBUTION" | "RESEARCH_ONLY" | "RESTRICTED" | "UNCLEAR";

type LicenseFile = {
  sources: Array<{
    benchmark_id: string;
    license: string;
    classification: ExternalLicenseClass;
    firewall_status?: LicenseStatus;
    commit_dataset_contents: boolean;
    jurisdiction?: string;
    result_label?: string;
    notes?: string;
  }>;
};

let cache: LicenseFile | null = null;

export function loadProsecutionExternalLicenses(): LicenseFile {
  if (cache) return cache;
  const raw = readFileSync(
    path.join(getRegistryDir(), "prosecution-external-licenses.json"),
    "utf8",
  );
  cache = JSON.parse(raw) as LicenseFile;
  return cache;
}

export function resetProsecutionExternalLicenseCacheForTests(): void {
  cache = null;
}

export function classifyExternalBenchmarkLicense(benchmarkId: string): {
  classification: ExternalLicenseClass;
  license: string;
  mayCommitDatasetContents: boolean;
  firewallStatus: LicenseStatus;
  resultLabel?: string;
  jurisdiction?: string;
} {
  const entry = loadProsecutionExternalLicenses().sources.find(
    (s) => s.benchmark_id === benchmarkId,
  );
  if (!entry) {
    return {
      classification: "UNCLEAR",
      license: "unknown",
      mayCommitDatasetContents: false,
      firewallStatus: "LICENSE_REVIEW_REQUIRED",
    };
  }
  return {
    classification: entry.classification,
    license: entry.license,
    mayCommitDatasetContents: entry.commit_dataset_contents,
    firewallStatus:
      entry.firewall_status ??
      (entry.classification === "PERMITTED" || entry.classification === "PERMITTED_WITH_ATTRIBUTION"
        ? "COMMERCIAL_INTERNAL_EVAL_OK"
        : entry.classification === "RESEARCH_ONLY"
          ? "RESEARCH_ONLY_NOT_FOR_PRODUCTION_SELECTION"
          : "LICENSE_REVIEW_REQUIRED"),
    resultLabel: entry.result_label,
    jurisdiction: entry.jurisdiction,
  };
}

export function assertExternalDatasetMountAllowed(
  benchmarkId: string,
  mode: LicenseEvalMode,
): { allowed: boolean; reason?: string; classification: ExternalLicenseClass } {
  const info = classifyExternalBenchmarkLicense(benchmarkId);
  if (info.classification === "RESTRICTED" || info.classification === "UNCLEAR") {
    return {
      allowed: false,
      classification: info.classification,
      reason: `Dataset ${benchmarkId} classification ${info.classification}; do not commit contents; mount only if legally cleared.`,
    };
  }
  if (mode === "production-selection" && info.classification === "RESEARCH_ONLY") {
    return {
      allowed: false,
      classification: info.classification,
      reason: `Dataset ${benchmarkId} is RESEARCH_ONLY — excluded from production-selection ranking.`,
    };
  }
  return { allowed: true, classification: info.classification };
}

export function assertLegalBenchTaskForProsecution(
  taskId: string,
  mode: LicenseEvalMode,
): ReturnType<typeof assertCommercialEvalAllowed> {
  const status = loadLegalBenchTaskLicense(taskId);
  return assertCommercialEvalAllowed(
    { benchmarkId: "legalbench", taskId, metadata: { firewallStatus: status } },
    mode,
  );
}
