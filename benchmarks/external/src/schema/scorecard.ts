import { z } from "zod";

export const ExternalBenchmarkScorecardSchema = z.object({
  provider: z.string().optional().nullable(),
  model: z.string().optional().nullable(),
  exactModelId: z.string().optional().nullable(),
  benchmark: z.string().optional().nullable(),
  subset: z.string().optional().nullable(),
  taskCount: z.number().optional().nullable(),
  completed: z.number().optional().nullable(),
  failed: z.number().optional().nullable(),
  score: z.number().optional().nullable(),
  criticalFailures: z.number().optional().nullable(),
  latencyP50: z.number().optional().nullable(),
  latencyP95: z.number().optional().nullable(),
  inputTokens: z.number().optional().nullable(),
  outputTokens: z.number().optional().nullable(),
  estimatedCost: z.number().optional().nullable(),
  judgeModel: z.string().optional().nullable(),
  judgeVersion: z.string().optional().nullable(),
  runTimestamp: z.string().optional().nullable(),
  gitSha: z.string().optional().nullable(),
  datasetRevision: z.string().optional().nullable(),
  promptVersion: z.string().optional().nullable(),
});

export type ExternalBenchmarkScorecard = z.infer<typeof ExternalBenchmarkScorecardSchema>;

export function parseExternalBenchmarkScorecard(raw: unknown): ExternalBenchmarkScorecard {
  return ExternalBenchmarkScorecardSchema.parse(raw);
}
