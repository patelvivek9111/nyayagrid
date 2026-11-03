import { z } from "zod";
import { TASK_GROUPS, CITATION_MODES } from "./constants.js";
import { ProsecutionExternalTaskResultSchema } from "./result-schema.js";

export const LIVE_EXIT_CLASSIFICATIONS = [
  "AUTHORIZATION_REQUIRED",
  "DATASET_UNAVAILABLE",
  "ROUTING_BLOCKED",
  "MODEL_PIN_UNVERIFIED",
  "BUDGET_BLOCKED",
  "PROVIDER_FAILURE",
  "CRITICAL_GROUNDING_FAILURE",
  "PARTIAL",
  "PASS",
  "DRY_RUN_COMPLETE",
] as const;

export type LiveExitClassification = (typeof LIVE_EXIT_CLASSIFICATIONS)[number];

export const ProsecutionExternalLiveTaskResultSchema = ProsecutionExternalTaskResultSchema.extend({
  provider: z.string().nullable().optional(),
  riskTier: z.string().nullable().optional(),
  routingTier: z.number().nullable().optional(),
  routingReason: z.string().nullable().optional(),
  fallback: z.boolean().optional(),
  fallbackReason: z.string().nullable().optional(),
  estimatedCostUsd: z.number().optional(),
  actualCostUsd: z.number().optional(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  errorClass: z
    .enum([
      "MODEL_ERROR",
      "RETRIEVAL_ERROR",
      "SCORER_ERROR",
      "DATASET_ERROR",
      "PROVIDER_ERROR",
      "SYSTEM_ERROR",
      "NONE",
    ])
    .optional(),
  skippedDuplicate: z.boolean().optional(),
  ineligible: z.boolean().optional(),
  ineligibleReason: z.string().nullable().optional(),
});

export type ProsecutionExternalLiveTaskResult = z.infer<
  typeof ProsecutionExternalLiveTaskResultSchema
>;

export const ProsecutionExternalLiveRunReportSchema = z.object({
  suiteId: z.literal("NYAYA_EXTERNAL_PROSECUTION_VALIDATION"),
  suiteVersion: z.string(),
  seed: z.string(),
  evalMode: z.literal("NYAYA_PIPELINE"),
  paidCalls: z.number().int().nonnegative(),
  courtListener: z.literal(0),
  dryRun: z.boolean(),
  exitClassification: z.enum(LIVE_EXIT_CLASSIFICATIONS),
  internalBenchSeparated: z.literal(true),
  jurisdictionSeparated: z.literal(true),
  gpt61SolLiveVerified: z.boolean(),
  gpt61SolRequested: z.boolean(),
  substitutions: z.number().int().nonnegative(),
  fallbacks: z.number().int().nonnegative(),
  retries: z.number().int().nonnegative(),
  selectedExamples: z.number().int().nonnegative(),
  executedExamples: z.number().int().nonnegative(),
  skippedCompleted: z.number().int().nonnegative(),
  ineligibleExamples: z.number().int().nonnegative(),
  legalbenchSelected: z.number().int().nonnegative(),
  legalciteSelected: z.number().int().nonnegative(),
  legalbenchExecuted: z.number().int().nonnegative(),
  legalciteExecuted: z.number().int().nonnegative(),
  legalbenchAccuracy: z.number().nullable(),
  legalciteAccuracy: z.number().nullable(),
  unsupportedAnswers: z.number().int().nonnegative(),
  fabricatedCitations: z.number().int().nonnegative(),
  fabricatedCases: z.number().int().nonnegative(),
  criticalFailures: z.number().int().nonnegative(),
  actualSpendUsd: z.number().nonnegative(),
  hardCapUsd: z.number().positive(),
  requestCap: z.number().int().positive(),
  providerRequests: z.number().int().nonnegative(),
  selectionManifestHash: z.string().nullable().optional(),
  groups: z.array(
    z.object({
      taskGroup: z.enum(TASK_GROUPS),
      jurisdiction: z.string(),
      sampleCount: z.number(),
      scored: z.number(),
      accuracy: z.number().nullable(),
      abstentions: z.number(),
      unsupportedClaims: z.number(),
      fabricatedAuthority: z.number(),
      sourceGroundingFailures: z.number(),
      resultLabel: z.string().optional().nullable(),
    }),
  ),
  tasks: z.array(ProsecutionExternalLiveTaskResultSchema),
  contaminationCaveat: z.string(),
  runTimestamp: z.string(),
  citationModesUsed: z.array(z.enum(CITATION_MODES)).optional(),
  notes: z.array(z.string()).default([]),
});

export type ProsecutionExternalLiveRunReport = z.infer<
  typeof ProsecutionExternalLiveRunReportSchema
>;

export function parseProsecutionExternalLiveRunReport(
  raw: unknown,
): ProsecutionExternalLiveRunReport {
  return ProsecutionExternalLiveRunReportSchema.parse(raw);
}

/** Zero executed examples must never be reported as PASS. */
export function classifyLiveExit(input: {
  dryRun: boolean;
  authorizationBlocked?: boolean;
  criticalFailures: number;
  executedExamples: number;
  selectedExamples: number;
  budgetStopped?: boolean;
  providerFailure?: boolean;
  routingBlocked?: boolean;
  datasetUnavailable?: boolean;
}): LiveExitClassification {
  if (input.authorizationBlocked) return "AUTHORIZATION_REQUIRED";
  if (input.datasetUnavailable) return "DATASET_UNAVAILABLE";
  if (input.routingBlocked) return "ROUTING_BLOCKED";
  if (input.criticalFailures > 0) return "CRITICAL_GROUNDING_FAILURE";
  if (input.budgetStopped) return "BUDGET_BLOCKED";
  // Dry-run completes without providers; do not elevate plumbing mismatches to PROVIDER_FAILURE.
  if (input.dryRun) return "DRY_RUN_COMPLETE";
  if (input.providerFailure) return "PROVIDER_FAILURE";
  if (input.executedExamples === 0) return "PARTIAL";
  if (input.executedExamples < input.selectedExamples) return "PARTIAL";
  return "PASS";
}
