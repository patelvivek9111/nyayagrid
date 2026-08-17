/**
 * Dry-run mock for compare worked examples.
 *
 * Mixed assignment+exhibit: without the mixed example, restates Exhibit I
 * (live-7 failure). With it, reports only the material assignment change.
 *
 * Isolated decoys: without the isolated-decoy example, emit the live-8 empty
 * summary fallback. With it, emit a real non-empty "No material changes
 * detected" summary — not the fallback string.
 */
import { gradeLiveCompareScenario } from "./grade-live-compare";
import {
  COMPARE_ISOLATED_DECOY_EXAMPLE_MARKER,
  COMPARE_MIXED_EXAMPLE_MARKER,
  COMPARE_SUMMARY_SYSTEM_PROMPT,
  LIVE_CONTRACT_COMPARE_SCENARIOS,
  type LiveContractCompareScenario,
} from "./live-contract-compare";

export const LIVE7_ASSIGNMENT_EXHIBIT_SUMMARY =
  "The clause regarding assignment has been modified to require the Customer to obtain the Vendor's reasonable consent instead of the Vendor's sole discretion consent. Additionally, the reference to Exhibit 1 has been updated to Exhibit I.";

export const MIXED_ASSIGNMENT_EXHIBIT_FIXED_SUMMARY =
  "The assignment clause now requires Vendor's reasonable consent instead of sole discretion.";

/** Product empty-summary fallback that live 8 inserted for isolated decoys. */
export const LIVE8_ISOLATED_DECOY_FALLBACK =
  "Document versions differ; review the detected changes.";

export const ISOLATED_DECOY_NO_MATERIAL_SUMMARY = "No material changes detected.";

export function comparePromptFollowsMixedExample(systemPrompt: string): boolean {
  return systemPrompt.includes(COMPARE_MIXED_EXAMPLE_MARKER);
}

export function comparePromptFollowsIsolatedDecoyExample(systemPrompt: string): boolean {
  return systemPrompt.includes(COMPARE_ISOLATED_DECOY_EXAMPLE_MARKER);
}

export function probeCompareSummary(
  scenario: LiveContractCompareScenario,
  systemPrompt: string = COMPARE_SUMMARY_SYSTEM_PROMPT,
): string {
  const followsMixed = comparePromptFollowsMixedExample(systemPrompt);
  const followsIsolated = comparePromptFollowsIsolatedDecoyExample(systemPrompt);
  if (scenario.id === "cc-live-mixed-assignment-exhibit") {
    return followsMixed ? MIXED_ASSIGNMENT_EXHIBIT_FIXED_SUMMARY : LIVE7_ASSIGNMENT_EXHIBIT_SUMMARY;
  }
  if (scenario.kind === "decoy") {
    return followsIsolated ? ISOLATED_DECOY_NO_MATERIAL_SUMMARY : LIVE8_ISOLATED_DECOY_FALLBACK;
  }
  if (scenario.kind === "empty") {
    return ISOLATED_DECOY_NO_MATERIAL_SUMMARY;
  }
  const needles = scenario.materialNeedles ?? [];
  if (needles.length > 0) {
    return `Material update: ${needles.join(" ")}.`;
  }
  return ISOLATED_DECOY_NO_MATERIAL_SUMMARY;
}

export function gradeCompareScenarioWithProbe(
  scenario: LiveContractCompareScenario,
  systemPrompt: string = COMPARE_SUMMARY_SYSTEM_PROMPT,
) {
  return gradeLiveCompareScenario({
    scenario,
    summary: probeCompareSummary(scenario, systemPrompt),
  });
}

export function gradeAllLiveCompareWithProbe(systemPrompt: string = COMPARE_SUMMARY_SYSTEM_PROMPT) {
  return LIVE_CONTRACT_COMPARE_SCENARIOS.map((scenario) => {
    const grade = gradeCompareScenarioWithProbe(scenario, systemPrompt);
    return {
      ...grade,
      kind: scenario.kind,
    };
  });
}
