import { z } from "zod";
import { normalizeConfidenceLevel } from "./professional";

export const GRAPH_RELATIONSHIP_PROMPT_VERSION = "graph-relationship-extract-v2";
export const MEMORY_PROPOSAL_PROMPT_VERSION = "matter-memory-propose-v2";

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

export type GraphNodeRef = {
  canonicalEntityType: string;
  canonicalEntityId: string;
  displayName: string;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function looksLikeUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Map a model-supplied node id or display name onto a verified node's canonical UUID. */
export function resolveGraphCanonicalId(
  value: unknown,
  type: unknown,
  nodes: GraphNodeRef[],
): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let trimmed = value.trim();
  const typeStr = typeof type === "string" ? type.trim() : "";
  const prefixed = trimmed.match(/^([a-zA-Z0-9_]+):(.+)$/);
  if (prefixed?.[2] && looksLikeUuid(prefixed[2])) {
    trimmed = prefixed[2].trim();
  }
  if (looksLikeUuid(trimmed)) {
    if (nodes.length === 0) return trimmed;
    const byId = nodes.filter(
      (node) => node.canonicalEntityId.toLowerCase() === trimmed.toLowerCase(),
    );
    if (byId.length === 0) return null;
    if (typeStr) {
      const typed = byId.filter(
        (node) => node.canonicalEntityType.toLowerCase() === typeStr.toLowerCase(),
      );
      if (typed.length === 1) return typed[0]!.canonicalEntityId;
    }
    if (byId.length === 1) return byId[0]!.canonicalEntityId;
    return null;
  }
  const lowered = trimmed.toLowerCase();
  const matches = nodes.filter((node) => {
    if (node.displayName.toLowerCase() !== lowered) return false;
    if (typeStr && node.canonicalEntityType.toLowerCase() !== typeStr.toLowerCase()) return false;
    return true;
  });
  if (matches.length === 1) return matches[0]!.canonicalEntityId;
  const typeAgnostic = nodes.filter((node) => node.displayName.toLowerCase() === lowered);
  if (typeAgnostic.length === 1) return typeAgnostic[0]!.canonicalEntityId;
  return null;
}

export function normalizeGraphRelationshipRaw(raw: unknown, nodes: GraphNodeRef[] = []): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { relationships: [] };
  const obj = { ...(raw as Record<string, unknown>) };
  const rows = Array.isArray(obj.relationships) ? obj.relationships : [];
  obj.relationships = rows.flatMap((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return [];
    const next = { ...(row as Record<string, unknown>) };
    if (next.confidence !== undefined) {
      next.confidence = normalizeConfidenceLevel(next.confidence);
    }
    const fromId = resolveGraphCanonicalId(next.fromCanonicalId, next.fromCanonicalType, nodes);
    const toId = resolveGraphCanonicalId(next.toCanonicalId, next.toCanonicalType, nodes);
    if (!fromId || !toId) return [];
    const fromNode = nodes.find((node) => node.canonicalEntityId === fromId);
    const toNode = nodes.find((node) => node.canonicalEntityId === toId);
    next.fromCanonicalId = fromId;
    next.toCanonicalId = toId;
    if (fromNode) next.fromCanonicalType = fromNode.canonicalEntityType;
    if (toNode) next.toCanonicalType = toNode.canonicalEntityType;
    if (typeof next.relationshipType === "string") {
      next.relationshipType = next.relationshipType.trim();
    }
    if (
      typeof next.relationshipType !== "string" ||
      !(GRAPH_RELATIONSHIP_TYPES as readonly string[]).includes(next.relationshipType)
    ) {
      return [];
    }
    const chunkIds = Array.isArray(next.sourceChunkIds) ? next.sourceChunkIds : [];
    next.sourceChunkIds = chunkIds.filter((id) => typeof id === "string" && looksLikeUuid(id));
    if ((next.sourceChunkIds as string[]).length === 0) return [];
    return [next];
  });
  return obj;
}

export function parseGraphRelationshipExtraction(
  raw: unknown,
  nodes: GraphNodeRef[] = [],
): GraphRelationshipExtraction {
  const normalized = normalizeGraphRelationshipRaw(raw, nodes);
  const parsed = graphRelationshipExtractionSchema.safeParse(normalized);
  if (parsed.success) return parsed.data;
  return { relationships: [] };
}

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
  sourceChunkIds: z
    .array(z.string())
    .optional()
    .default([])
    .transform((ids) => ids.filter((id) => z.string().uuid().safeParse(id).success)),
});

export const memoryProposalResponseSchema = z.object({
  proposals: z.array(memoryProposalSchema).default([]),
});

export type MemoryProposal = z.infer<typeof memoryProposalSchema>;

export function buildGraphRelationshipSystemPrompt(): string {
  return [
    "You propose graph relationships between verified matter nodes using ONLY provided sources.",
    "Never invent people, organizations, documents, or relationships.",
    "fromCanonicalId and toCanonicalId MUST be copied exactly from Verified nodes (the UUID after the type prefix). Never use display names as IDs.",
    "confidence MUST be the string low, medium, or high — never a number.",
    "Every relationship MUST cite valid source chunkIds from Sources.",
    "Only use relationship types from the allowed list.",
    "Return JSON: {relationships:[{fromCanonicalType,fromCanonicalId,toCanonicalId,toCanonicalType,relationshipType,label,confidence,sourceChunkIds,sourceQuotes,uncertaintyNotes}]}",
    "If evidence is insufficient or Verified nodes is empty, return {relationships:[]}.",
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
    "Verified nodes (copy canonicalEntityId UUIDs exactly; do not substitute names):",
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
    "Storage is not verification. A proposal is a suggestion, not an established fact.",
    "Do not use memoryType verified_context unless sourceChunkIds cite text that actually supports the proposition.",
    "A user hint is not evidence. Do not treat a hint as a source-supported fact.",
    "Do not resolve evidentiary tension into a single established fact. If sources conflict, return no factual proposal or a factual_caveat that names the tension and each source's role.",
    "Badge, card-reader, or ACCESS GRANTED activity is not proof that a named person physically entered a place.",
    "Silence or a local invoice statement is not proof of a universal negative.",
    "Cite sourceChunkIds from Sources only when that chunk text supports the proposition. If you cannot cite supporting text, omit sourceChunkIds.",
    "Return JSON: {proposals:[{memoryType,title,content,importance,confidence,rationale,sourceChunkIds}]}",
    "If nothing is worth remembering, return {proposals:[]}.",
  ].join(" ");
}

export function buildMemoryProposalUserPrompt(input: {
  matterTitle: string;
  question?: string | null;
  verifiedContext: string;
  hint?: string | null;
  chunks?: Array<{ chunkId: string; content: string }>;
}): string {
  return [
    `Matter: ${input.matterTitle}`,
    input.question ? `User question/context: ${input.question}` : "",
    input.hint ? `Hint: ${input.hint}` : "",
    "Verified context:",
    input.verifiedContext || "(none)",
    "Sources:",
    ...(input.chunks?.length
      ? input.chunks.map((c) => `- chunkId=${c.chunkId} | text=|${c.content}|`)
      : ["(none)"]),
  ]
    .filter(Boolean)
    .join("\n");
}
