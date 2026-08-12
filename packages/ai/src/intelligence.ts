import { z } from "zod";

export const MATTER_INTELLIGENCE_PROMPT_VERSION = "matter-intelligence-extract-v1";
export const MATTER_SUMMARY_PROMPT_VERSION = "matter-summary-v1";

export const datePrecisionSchema = z.enum([
  "exact",
  "approximate",
  "month",
  "year",
  "range",
  "unknown",
]);
export const confidenceLevelSchema = z.enum(["low", "medium", "high"]);

export const extractionSourceRefSchema = z.object({
  chunkId: z.string().uuid(),
  quote: z.string().min(1).max(2000),
});

export const timelineProposalSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().default(""),
  eventType: z.string().min(1).max(120),
  eventDate: z.string().nullable().optional(),
  eventDateEnd: z.string().nullable().optional(),
  datePrecision: datePrecisionSchema.default("unknown"),
  actors: z.array(z.string().min(1).max(200)).default([]),
  sourceChunkIds: z.array(z.string().uuid()).min(1),
  sourceQuotes: z.array(z.string().min(1)).default([]),
  confidence: confidenceLevelSchema.default("medium"),
  uncertaintyNotes: z.string().max(2000).optional().nullable(),
});

export const matterFactProposalSchema = z.object({
  factKey: z.string().min(1).max(120),
  label: z.string().min(1).max(300),
  value: z.string().min(1).max(2000),
  normalizedValue: z.string().max(2000).optional().nullable(),
  sourceChunkIds: z.array(z.string().uuid()).min(1),
  sourceQuotes: z.array(z.string().min(1)).default([]),
  confidence: confidenceLevelSchema.default("medium"),
  uncertaintyNotes: z.string().max(2000).optional().nullable(),
});

export const entityProposalSchema = z.object({
  entityType: z.enum(["person", "organization"]),
  displayName: z.string().min(1).max(300),
  aliases: z.array(z.string().min(1).max(300)).default([]),
  roles: z.array(z.string().min(1).max(120)).default([]),
  description: z.string().max(2000).optional().nullable(),
  sourceChunkIds: z.array(z.string().uuid()).min(1),
  sourceQuotes: z.array(z.string().min(1)).default([]),
  confidence: confidenceLevelSchema.default("medium"),
});

export const deadlineProposalSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  dueAt: z.string().nullable().optional(),
  dueAtEnd: z.string().nullable().optional(),
  datePrecision: datePrecisionSchema.default("unknown"),
  dateKind: z.enum(["explicit", "inferred"]).default("explicit"),
  timezone: z.string().max(80).optional().nullable(),
  sourceChunkIds: z.array(z.string().uuid()).min(1),
  sourceQuotes: z.array(z.string().min(1)).default([]),
  confidence: confidenceLevelSchema.default("medium"),
  uncertaintyNotes: z.string().max(2000).optional().nullable(),
});

export const matterIntelligenceExtractionSchema = z.object({
  timelineEvents: z.array(timelineProposalSchema).default([]),
  facts: z.array(matterFactProposalSchema).default([]),
  entities: z.array(entityProposalSchema).default([]),
  deadlines: z.array(deadlineProposalSchema).default([]),
});

export type MatterIntelligenceExtraction = z.infer<typeof matterIntelligenceExtractionSchema>;
export type TimelineProposal = z.infer<typeof timelineProposalSchema>;
export type MatterFactProposal = z.infer<typeof matterFactProposalSchema>;
export type EntityProposal = z.infer<typeof entityProposalSchema>;
export type DeadlineProposal = z.infer<typeof deadlineProposalSchema>;

export type ExtractionChunk = {
  chunkId: string;
  documentId: string;
  documentVersionId: string;
  page?: number | null;
  segmentRef?: string | null;
  content: string;
};

export function buildMatterIntelligenceSystemPrompt(): string {
  return [
    "You extract proposed matter intelligence from authorized document chunks only.",
    "Never invent facts, dates, names, deadlines, or citations.",
    "Every candidate MUST cite one or more provided chunkIds.",
    "Prefer explicit dates. Mark ambiguous deadlines as inferred.",
    "Return JSON only matching {timelineEvents, facts, entities, deadlines}.",
    "If evidence is insufficient for a category, return an empty array for that category.",
  ].join(" ");
}

export function buildMatterIntelligenceUserPrompt(chunks: ExtractionChunk[]): string {
  const lines = chunks.map(
    (c) =>
      `- chunkId=${c.chunkId} | documentId=${c.documentId} | documentVersionId=${c.documentVersionId} | page=${c.page ?? "null"} | segmentRef=${c.segmentRef ?? "null"} | text=|${c.content}|`,
  );
  return `Extract proposed timeline events, facts, people/organizations, and explicit deadline candidates from these Sources:\n${lines.join("\n") || "(none)"}`;
}

export function buildMatterSummarySystemPrompt(): string {
  return [
    "You write a concise Matter Summary for lawyers using ONLY verified structured intelligence and authorized notes.",
    "Do not invent facts. Clearly state when information is limited.",
    "This summary is AI-generated and not attorney-authored.",
    "Return JSON: {summary: string}.",
  ].join(" ");
}

export function buildMatterSummaryUserPrompt(input: {
  matterTitle: string;
  events: Array<{
    title: string;
    eventType: string;
    eventDate?: string | null;
    description?: string | null;
  }>;
  facts: Array<{ label: string; value: string }>;
  entities: Array<{ displayName: string; entityType: string; roles?: string[] }>;
  deadlines: Array<{ title: string; dueAt?: string | null }>;
}): string {
  return [
    `Matter: ${input.matterTitle}`,
    "Verified timeline events:",
    ...input.events.map(
      (e) =>
        `- ${e.eventDate ?? "unknown date"} | ${e.eventType} | ${e.title} | ${e.description ?? ""}`,
    ),
    "Verified facts:",
    ...input.facts.map((f) => `- ${f.label}: ${f.value}`),
    "Approved people/organizations:",
    ...input.entities.map(
      (e) => `- ${e.displayName} (${e.entityType}) roles=${(e.roles ?? []).join(",")}`,
    ),
    "Verified deadlines:",
    ...input.deadlines.map((d) => `- ${d.title} due=${d.dueAt ?? "unknown"}`),
  ].join("\n");
}
