import { z } from "zod";

export const GRAPH_RELATIONSHIP_PROMPT_VERSION = "graph-relationship-extract-v1";
export const MEMORY_PROPOSAL_PROMPT_VERSION = "matter-memory-propose-v1";

export const GRAPH_RELATIONSHIP_TYPES = [
  "works_for",
  "party_to",
  "signed",
  "sent",
  "received",
  "attended",
  "mentioned_in",
  "supports",
  "contradicts",
  "occurred_before",
  "occurred_after",
  "related_to",
  "represents",
  "assigned_to",
  "alleges",
  "paid",
  "owns",
  "communicates_with",
  "supported_by",
  "participated_in",
  "contains_fact",
] as const;

export const graphRelationshipTypeSchema = z.enum(GRAPH_RELATIONSHIP_TYPES);

export const graphRelationshipProposalSchema = z.object({
  fromCanonicalType: z.string().min(1),
  fromCanonicalId: z.string().uuid(),
  toCanonicalType: z.string().min(1),
  toCanonicalId: z.string().uuid(),
  relationshipType: graphRelationshipTypeSchema,
  label: z.string().max(300).optional().nullable(),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  sourceChunkIds: z.array(z.string().uuid()).min(1),
  sourceQuotes: z.array(z.string().min(1)).default([]),
  uncertaintyNotes: z.string().max(2000).optional().nullable(),
});

export const graphRelationshipExtractionSchema = z.object({
  relationships: z.array(graphRelationshipProposalSchema).default([]),
});

export type GraphRelationshipExtraction = z.infer<typeof graphRelationshipExtractionSchema>;
export type GraphRelationshipProposal = z.infer<typeof graphRelationshipProposalSchema>;

export const memoryProposalSchema = z.object({
  memoryType: z.enum([
    "verified_context",
    "strategic_note",
    "entity_resolution",
    "document_significance",
    "factual_caveat",
    "user_instruction",
    "matter_preference",
    "procedural_context",
    "other",
  ]),
  title: z.string().min(1).max(300),
  content: z.string().min(1).max(8000),
  importance: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  confidence: z.enum(["low", "medium", "high"]).default("medium"),
  rationale: z.string().max(2000).optional().nullable(),
});

export const memoryProposalResponseSchema = z.object({
  proposals: z.array(memoryProposalSchema).default([]),
});

export type MemoryProposal = z.infer<typeof memoryProposalSchema>;

export function buildGraphRelationshipSystemPrompt(): string {
  return [
    "You propose graph relationships between verified matter nodes using ONLY provided sources.",
    "Never invent people, organizations, documents, or relationships.",
    "Every relationship MUST cite valid source chunkIds from Sources.",
    "Only use relationship types from the allowed list.",
    "Return JSON: {relationships:[{fromCanonicalType,fromCanonicalId,toCanonicalId,toCanonicalType,relationshipType,label,confidence,sourceChunkIds,sourceQuotes,uncertaintyNotes}]}",
    "If evidence is insufficient, return {relationships:[]}.",
  ].join(" ");
}

export function buildGraphRelationshipUserPrompt(input: {
  nodes: Array<{
    canonicalEntityType: string;
    canonicalEntityId: string;
    nodeType: string;
    displayName: string;
  }>;
  chunks: Array<{ chunkId: string; content: string }>;
}): string {
  return [
    "Verified nodes:",
    ...input.nodes.map(
      (n) =>
        `- ${n.canonicalEntityType}:${n.canonicalEntityId} | type=${n.nodeType} | name=${n.displayName}`,
    ),
    "Allowed relationship types:",
    GRAPH_RELATIONSHIP_TYPES.join(", "),
    "Sources:",
    ...input.chunks.map((c) => `- chunkId=${c.chunkId} | text=|${c.content}|`),
  ].join("\n");
}

export function buildMemoryProposalSystemPrompt(): string {
  return [
    "You propose durable Matter Memory entries that are useful for future legal work on this matter.",
    "Do not propose every fact. Prefer operative agreements, identity resolutions, strategic caveats, and explicit user instructions.",
    "Never invent facts. Importance must not default to critical.",
    "Return JSON: {proposals:[{memoryType,title,content,importance,confidence,rationale}]}",
    "If nothing is worth remembering, return {proposals:[]}.",
  ].join(" ");
}

export function buildMemoryProposalUserPrompt(input: {
  matterTitle: string;
  question?: string | null;
  verifiedContext: string;
  hint?: string | null;
}): string {
  return [
    `Matter: ${input.matterTitle}`,
    input.question ? `User question/context: ${input.question}` : "",
    input.hint ? `Hint: ${input.hint}` : "",
    "Verified context:",
    input.verifiedContext || "(none)",
  ]
    .filter(Boolean)
    .join("\n");
}
