import type { CertificationSubsystem } from "@nyayagrid/ai";

/**
 * Deposition overlay is frozen DA1 on SYNTH-V2-006.
 * Other nyaya-bench v2 cert modes use SYNTH-V2-001 unless overridden.
 */
export function scenarioIdForSubsystem(
  subsystem: CertificationSubsystem,
  fallback = "SYNTH-V2-001",
): string {
  if (subsystem === "deposition") return "SYNTH-V2-006";
  return fallback;
}
