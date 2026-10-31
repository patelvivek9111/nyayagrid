import { z } from "zod";
import { TASK_GROUPS, EVAL_MODES, CITATION_MODES } from "./constants.js";

export const ProsecutionExternalTaskResultSchema = z.object({
  benchmark: z.string(),
  datasetVersion: z.string().nullable(),
  jurisdiction: z.string(),
  task: z.string(),
  sampleId: z.string(),
  taskGroup: z.enum(TASK_GROUPS),
  evalMode: z.enum(EVAL_MODES).optional().nullable(),
  citationMode: z.enum(CITATION_MODES).optional().nullable(),
  license: z.string(),
  licenseClassification: z.string(),
  score: z.number().nullable(),
  correct: z.boolean().nullable(),
  abstained: z.boolean().default(false),
  unsupportedClaim: z.boolean().default(false),
  fabricatedAuthority: z.boolean().default(false),
  sourceGroundingFailure: z.boolean().default(false),
  failures: z.array(z.string()).default([]),
  resultLabel: z.string().optional().nullable(),
  logicalModel: z.string().optional().nullable(),
  requestedApiModel: z.string().optional().nullable(),
  servedModel: z.string().optional().nullable(),
  adapterSubstitution: z.boolean().optional().nullable(),
  modelPinStatus: z.string().optional().nullable(),
});

export type ProsecutionExternalTaskResult = z.infer<typeof ProsecutionExternalTaskResultSchema>;

export const ProsecutionExternalGroupScoreSchema = z.object({
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
});

export const ProsecutionExternalRunReportSchema = z.object({
  suiteId: z.literal("NYAYA_EXTERNAL_PROSECUTION_VALIDATION"),
  suiteVersion: z.string(),
  seed: z.string(),
  paidCalls: z.literal(0),
  courtListener: z.literal(0),
  evalMode: z.enum(EVAL_MODES),
  internalBenchSeparated: z.literal(true),
  jurisdictionSeparated: z.literal(true),
  gpt61SolLiveVerified: z.boolean(),
  groups: z.array(ProsecutionExternalGroupScoreSchema),
  tasks: z.array(ProsecutionExternalTaskResultSchema),
  selectionManifestHash: z.string().optional().nullable(),
  contaminationCaveat: z.string(),
  runTimestamp: z.string(),
});

export type ProsecutionExternalRunReport = z.infer<typeof ProsecutionExternalRunReportSchema>;

export function parseProsecutionExternalRunReport(raw: unknown): ProsecutionExternalRunReport {
  return ProsecutionExternalRunReportSchema.parse(raw);
}
