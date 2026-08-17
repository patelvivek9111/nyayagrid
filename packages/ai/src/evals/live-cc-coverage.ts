/**
 * Adversarial-dimension coverage for live contract-compare summaries.
 *
 * Decoy FPR is counted from live `decoy`/`mixed` kinds (and deterministic
 * `diff_decoy` ids), with `#repeat` suffixes stripped.
 */
import { LIVE_CONTRACT_COMPARE_SCENARIOS } from "./live-contract-compare";
import {
  aggregateWorkflowRates,
  isContractCompareDecoyFprId,
  type CaseQualityFlags,
} from "./metrics";

export type LiveCompareCoverage = {
  scenarioCount: number;
  decoyScenarioCount: number;
  mixedScenarioCount: number;
  numericPhrasingCount: number;
  materialScenarioCount: number;
  emptyScenarioCount: number;
  decoyFprIdCount: number;
  mixedPairsHaveMaterialAndDecoyNeedles: boolean;
  citationRelevanceCheckedOnFlags: number;
  citationRelevanceEvaluated: boolean;
  decoyDiscriminationCheckedOnFlags: number;
  decoyFprCaseCountFromRates: number;
};

export function liveCompareCoverage(flags?: CaseQualityFlags[]): LiveCompareCoverage {
  const decoys = LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.kind === "decoy");
  const mixed = LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.kind === "mixed");
  const fprIds = LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => isContractCompareDecoyFprId(s.id));
  const checkedCite = (flags ?? []).filter((f) => f.citationRelevanceChecked);
  const checkedDecoy = (flags ?? []).filter((f) => f.decoyDiscriminationChecked);
  const rates =
    flags && flags.length > 0 ? aggregateWorkflowRates("contract_compare", flags) : null;
  return {
    scenarioCount: LIVE_CONTRACT_COMPARE_SCENARIOS.length,
    decoyScenarioCount: decoys.length,
    mixedScenarioCount: mixed.length,
    numericPhrasingCount: LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.numericPhrasing).length,
    materialScenarioCount: LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.kind === "material").length,
    emptyScenarioCount: LIVE_CONTRACT_COMPARE_SCENARIOS.filter((s) => s.kind === "empty").length,
    decoyFprIdCount: fprIds.length,
    mixedPairsHaveMaterialAndDecoyNeedles: mixed.every(
      (s) => (s.materialNeedles?.length ?? 0) > 0 && (s.decoyNeedles?.length ?? 0) > 0,
    ),
    citationRelevanceCheckedOnFlags: checkedCite.length,
    citationRelevanceEvaluated: checkedCite.length > 0,
    decoyDiscriminationCheckedOnFlags: checkedDecoy.length,
    decoyFprCaseCountFromRates: rates?.decoyCaseCount ?? 0,
  };
}

export function formatLiveCompareCoverage(coverage: LiveCompareCoverage): string {
  return [
    "=== Live contract-compare adversarial coverage ===",
    `scenarios=${coverage.scenarioCount} material=${coverage.materialScenarioCount} decoy=${coverage.decoyScenarioCount} mixed=${coverage.mixedScenarioCount} numericPhrasing=${coverage.numericPhrasingCount} empty=${coverage.emptyScenarioCount}`,
    `decoy-FPR id count=${coverage.decoyFprIdCount} mixed needles wired=${coverage.mixedPairsHaveMaterialAndDecoyNeedles}`,
    `citation_relevance fired=${coverage.citationRelevanceCheckedOnFlags} (not used on live compare)`,
    `decoy-discrimination fired=${coverage.decoyDiscriminationCheckedOnFlags} rate-table n=${coverage.decoyFprCaseCountFromRates}`,
  ].join("\n");
}
