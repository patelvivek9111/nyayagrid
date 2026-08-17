/**
 * Contract-compare eval runner (CC-01..CC-05).
 *
 * Invoked from repo-root `npm run eval:ai` via this workspace script.
 * `npm run eval:ai:live` adds live-model summaries when EVAL_LIVE=1.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateWorkflowRates,
  formatRepeatVarianceReport,
  formatWorkflowRateReport,
  liveEvalSkipReason,
  resolveLiveEvalConfig,
  summarizeRepeatVariance,
  writeReviewExport,
  LIVE_CONTRACT_COMPARE_SCENARIOS,
  type CaseQualityFlags,
} from "@nyayagrid/ai/evals";
import { CONTRACT_COMPARE_CASES } from "@nyayagrid/ai/evals";
import { gradeAllContractCompareCases } from "./grade-contract-compare";
import { runLiveContractCompareSummaries, lastCompareLiveRunConfig, type LiveCompareGrade } from "./live-summary";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

async function main() {
  const live = process.argv.includes("--live");
  const liveConfig = resolveLiveEvalConfig();

  console.log(
    `[eval:ai${live ? ":live" : ""}] contract_compare — ${CONTRACT_COMPARE_CASES.length} graded case(s) over golden_synth_msa_redline_v1\n`,
  );
  const grades = gradeAllContractCompareCases();
  for (const grade of grades) {
    console.log(`${grade.passed ? "PASS" : "FAIL"}  ${grade.caseId} — ${grade.details}`);
  }

  const flags: CaseQualityFlags[] = grades.map((g) => g.flags);
  let liveFlags: CaseQualityFlags[] = [];
  let liveGrades: LiveCompareGrade[] = [];
  const perRepeatFlags: CaseQualityFlags[][] = [];

  if (live) {
    const skip = liveEvalSkipReason(liveConfig);
    if (skip) {
      console.log(`[eval:ai:live] contract_compare summaries skipped: ${skip}`);
    } else {
      const repeats = liveConfig.repeats;
      console.log(
        `\n[eval:ai:live] Running ${LIVE_CONTRACT_COMPARE_SCENARIOS.length} live comparison summaries × ${repeats} repeat(s) on ${liveConfig.model}\n`,
      );
      const liveGradesRun = await runLiveContractCompareSummaries({ repeats });
      liveGrades = liveGradesRun;
      for (const grade of liveGradesRun) {
        console.log(`${grade.passed ? "PASS" : "FAIL"}  ${grade.caseId} — ${grade.details}`);
        liveFlags.push(grade.flags);
      }
      const byRepeat = new Map<number, CaseQualityFlags[]>();
      for (const grade of liveGradesRun) {
        const match = /#(\d+)$/.exec(grade.caseId);
        const repeat = match ? Number(match[1]) : 1;
        const list = byRepeat.get(repeat) ?? [];
        list.push(grade.flags);
        byRepeat.set(repeat, list);
      }
      perRepeatFlags.push(...[...byRepeat.values()]);
    }
  }

  const report = aggregateWorkflowRates("contract_compare", flags);
  console.log("\n=== Workflow rates (measured — not assumed) ===");
  console.log(
    "Bars: ≥90% citation accuracy, <5% hallucination, <10% false-insufficient, 0% false-confidence.",
  );
  console.log(
    live
      ? "Deterministic diffs only in this table. Live-model summaries are in the next table — do not mix n=27 with live n.\n"
      : "Mock/deterministic rates are code-regression measurements. They do not replace attorney review.\n",
  );
  console.log(formatWorkflowRateReport(report));

  let liveMissedBar = false;
  if (liveFlags.length > 0) {
    const liveReport = aggregateWorkflowRates("contract_compare", liveFlags);
    console.log("\n=== Live comparison-summary rates (model, not diffs) ===");
    console.log(formatWorkflowRateReport(liveReport));
    if (!liveReport.meetsBar) liveMissedBar = true;
  }

  if (perRepeatFlags.length > 1) {
    console.log("\n=== Repeat variance (live summaries only) ===");
    for (const variance of summarizeRepeatVariance(perRepeatFlags)) {
      console.log(formatRepeatVarianceReport(variance));
    }
  }

  const exportReview = process.env.EVAL_EXPORT_REVIEW === "1" || process.argv.includes("--export-review");
  if (exportReview && live && liveGrades.length > 0) {
    const parent =
      process.env.EVAL_EXPORT_DIR?.trim() ||
      join(REPO_ROOT, "docs/agent-quality-review/exports-live");
    const dir = join(parent, "contract-compare");
    const index = writeReviewExport({
      dir,
      provider: "openai",
      model: liveConfig.model,
      live: true,
      runConfig: lastCompareLiveRunConfig || undefined,
      items: liveGrades.map((grade) => ({
        workflow: "contract_compare",
        id: grade.caseId,
        description: grade.passed
          ? "Live comparison summary — harness pass"
          : `Live comparison summary — harness fail (${grade.details})`,
        input: grade.caseId.includes("empty")
          ? "Identical document pair (empty diff digest)."
          : "Golden SYNTH MSA original vs redline (detected diffs are authoritative).",
        output: grade.summary,
        sources: grade.details,
      })),
    });
    console.log(`\nWrote live comparison-summary export: ${index}`);
  }

  const failed = [...grades.filter((g) => !g.passed)];
  if (failed.length > 0 || !report.meetsBar || liveMissedBar) {
    if (failed.length > 0) {
      console.error(`\n${failed.length}/${grades.length} deterministic contract-compare eval(s) failed.`);
    }
    if (!report.meetsBar) {
      console.error("Contract-compare deterministic rate bar missed — see docs/AGENT_QUALITY.md.");
    }
    if (liveMissedBar) {
      console.error("Live comparison-summary rate bar missed — see docs/AGENT_QUALITY.md.");
    }
    process.exitCode = 1;
    return;
  }
  console.log(`\nAll ${grades.length} deterministic contract-compare eval(s) passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
