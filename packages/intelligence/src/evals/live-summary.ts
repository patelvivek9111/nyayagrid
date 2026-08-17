/**
 * Live-model contract-compare summaries. First time this workflow is scored
 * against a real provider. Deterministic diffs stay in grade-contract-compare.ts.
 */
import { OpenAIProvider } from "@nyayagrid/ai";
import {
  COMPARE_SUMMARY_PROMPT_VERSION,
  COMPARE_SUMMARY_SYSTEM_PROMPT,
  LIVE_CONTRACT_COMPARE_SCENARIOS,
  formatLiveRunConfig,
  liveEvalSkipReason,
  resolveLiveEvalConfig,
  LIVE_EVAL_TEMPERATURE,
  gradeLiveCompareScenario,
  type CaseQualityFlags,
} from "@nyayagrid/ai/evals";
import {
  applyComparisonSummaryAlignmentPolicy,
  computeParagraphDiffs,
  type DiffChange,
} from "../draft/helpers";

export type LiveCompareGrade = {
  caseId: string;
  passed: boolean;
  details: string;
  flags: CaseQualityFlags;
  summary: string;
};

async function askModelForSummary(params: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  titleA: string;
  titleB: string;
  changes: DiffChange[];
}): Promise<{
  summary: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  model?: string;
  systemFingerprint?: string;
}> {
  const ai = new OpenAIProvider({ apiKey: params.apiKey, model: params.model });
  const changeDigest =
    params.changes.length === 0
      ? "(none)"
      : params.changes
          .slice(0, 20)
          .map(
            (c) =>
              `- ${c.changeType}/${c.attention}: ${c.oldText?.slice(0, 120) ?? "(none)"} -> ${c.newText?.slice(0, 120) ?? "(none)"}`,
          )
          .join("\n");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);
  try {
    const generation = await Promise.race([
      ai.generate({
        temperature: LIVE_EVAL_TEMPERATURE,
        schemaName: "document_comparison_summary",
        messages: [
          {
            role: "system",
            content: COMPARE_SUMMARY_SYSTEM_PROMPT,
          },
          {
            role: "user",
            content: [
              `Document A: ${params.titleA}`,
              `Document B: ${params.titleB}`,
              "Detected changes (authoritative):",
              changeDigest,
            ].join("\n"),
          },
        ],
        signal: controller.signal,
      }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () =>
          reject(new Error(`Live compare timed out after ${params.timeoutMs}ms`)),
        );
      }),
    ]);
    let summary = "Document versions differ; review the detected changes.";
    try {
      const parsed = JSON.parse(generation.text) as { summary?: string };
      if (parsed.summary?.trim()) summary = parsed.summary.trim();
    } catch {
      if (generation.text.trim()) summary = generation.text.trim();
    }
    return {
      summary,
      usage: generation.usage,
      model: generation.model,
      systemFingerprint: generation.systemFingerprint,
    };
  } finally {
    clearTimeout(timer);
  }
}

export let lastCompareLiveRunConfig = "";

export async function runLiveContractCompareSummaries(params: {
  repeats: number;
  onUsage?: (usage?: { inputTokens?: number; outputTokens?: number }) => void;
}): Promise<LiveCompareGrade[]> {
  const config = resolveLiveEvalConfig();
  const skip = liveEvalSkipReason(config);
  if (skip) throw new Error(skip);

  const grades: LiveCompareGrade[] = [];
  const scenarios = LIVE_CONTRACT_COMPARE_SCENARIOS;
  let loggedConfig = false;

  for (let repeat = 1; repeat <= params.repeats; repeat += 1) {
    const suffix = params.repeats > 1 ? `#${repeat}` : "";
    for (const scenario of scenarios) {
      const changes = computeParagraphDiffs(scenario.original, scenario.redline);
      const { summary, usage, model, systemFingerprint } = await askModelForSummary({
        apiKey: config.apiKey!,
        model: config.model,
        timeoutMs: config.timeoutMs,
        titleA: scenario.titleA,
        titleB: scenario.titleB,
        changes,
      });
      params.onUsage?.(usage);
      if (!loggedConfig) {
        loggedConfig = true;
        lastCompareLiveRunConfig = formatLiveRunConfig({
          promptVersionCaseQa: "(n/a — compare workspace)",
          promptVersionContradiction: "(n/a — compare workspace)",
          promptVersionCompare: COMPARE_SUMMARY_PROMPT_VERSION,
          requestedModel: config.model,
          resolvedModel: model ?? "(unknown)",
          systemFingerprint: systemFingerprint ?? "(none)",
          rerank: false,
          temperature: LIVE_EVAL_TEMPERATURE,
        });
        console.log(lastCompareLiveRunConfig);
      }
      const aligned = applyComparisonSummaryAlignmentPolicy(summary, changes);
      const score = aligned.score;
      const graded = gradeLiveCompareScenario({
        scenario,
        summary: aligned.summary,
        caseId: `${scenario.id}${suffix}`,
        alignment: {
          alignment: score.alignment,
          unsupportedClaims: score.unsupportedClaims,
          flags: score.flags,
          claimCount: score.claimCount,
          supportedClaimCount: score.supportedClaimCount,
        },
      });
      grades.push({
        caseId: graded.caseId,
        passed: graded.passed,
        details: graded.details,
        summary: aligned.summary,
        flags: graded.flags,
      });
    }
  }

  return grades;
}
