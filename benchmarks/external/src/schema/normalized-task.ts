import { z } from "zod";

export const ContaminationRiskSchema = z.enum([
  "PUBLIC_HIGH",
  "PUBLIC_MEDIUM",
  "PRIVATE_LOW",
  "UNKNOWN",
]);

export type ContaminationRisk = z.infer<typeof ContaminationRiskSchema>;

export const ConversationTurnSchema = z.object({
  role: z.string(),
  content: z.string(),
});

export type ConversationTurn = z.infer<typeof ConversationTurnSchema>;

export const SupportingDocumentSchema = z.object({
  documentId: z.string().optional().nullable(),
  title: z.string().optional().nullable(),
  uri: z.string().optional().nullable(),
  mimeType: z.string().optional().nullable(),
  text: z.string().optional().nullable(),
});

export type SupportingDocument = z.infer<typeof SupportingDocumentSchema>;

export const RubricCriterionSchema = z.object({
  id: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  weight: z.number().optional().nullable(),
  maxScore: z.number().optional().nullable(),
});

export type RubricCriterion = z.infer<typeof RubricCriterionSchema>;

export const RubricSchema = z.object({
  criteria: z.array(RubricCriterionSchema).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export type Rubric = z.infer<typeof RubricSchema>;

export const GoldEvidenceSpanSchema = z.object({
  documentId: z.string().optional().nullable(),
  start: z.number().optional().nullable(),
  end: z.number().optional().nullable(),
  text: z.string().optional().nullable(),
  label: z.string().optional().nullable(),
});

export type GoldEvidenceSpan = z.infer<typeof GoldEvidenceSpanSchema>;

export const NormalizedTaskSchema = z.object({
  benchmarkId: z.string(),
  taskId: z.string(),
  split: z.string().optional().nullable(),
  jurisdiction: z.string().optional().nullable(),
  practiceArea: z.string().optional().nullable(),
  difficulty: z.string().optional().nullable(),
  taskType: z.string().optional().nullable(),
  input: z.unknown().optional().nullable(),
  conversation: z.array(ConversationTurnSchema).optional().nullable(),
  supportingDocuments: z.array(SupportingDocumentSchema).optional().nullable(),
  expectedAnswer: z.unknown().optional().nullable(),
  rubric: RubricSchema.optional().nullable(),
  goldEvidence: z.array(GoldEvidenceSpanSchema).optional().nullable(),
  metadata: z.record(z.unknown()).optional().nullable(),
  contaminationRisk: ContaminationRiskSchema.optional().nullable(),
});

export type NormalizedTask = z.infer<typeof NormalizedTaskSchema>;

export function parseNormalizedTask(raw: unknown): NormalizedTask {
  return NormalizedTaskSchema.parse(raw);
}

export function parseNormalizedTasks(raw: unknown): NormalizedTask[] {
  return z.array(NormalizedTaskSchema).parse(raw);
}
