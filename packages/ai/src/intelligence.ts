import { z } from "zod";
import { inferTimelineDate } from "./timeline-date-precision";

export const MATTER_INTELLIGENCE_PROMPT_VERSION = "matter-intelligence-extract-v3";
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

const matterIntelligenceExtractionObjectSchema = z.object({
  timelineEvents: z.array(timelineProposalSchema).default([]),
  facts: z.array(matterFactProposalSchema).default([]),
  entities: z.array(entityProposalSchema).default([]),
  deadlines: z.array(deadlineProposalSchema).default([]),
});

export const matterIntelligenceExtractionSchema = matterIntelligenceExtractionObjectSchema;

export type MatterIntelligenceExtraction = z.infer<typeof matterIntelligenceExtractionObjectSchema>;
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

export type NormalizeIntelligenceOptions = {
  availableChunkIds?: string[];
  availableChunks?: ExtractionChunk[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = asNonEmptyString(obj[key]);
    if (value) return value;
  }
  return undefined;
}

function pickStringArray(obj: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const raw = obj[key];
    if (!Array.isArray(raw)) continue;
    const values = raw
      .map((entry) => asNonEmptyString(entry))
      .filter((entry): entry is string => Boolean(entry));
    if (values.length > 0) return values;
  }
  return [];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function normalizeSourceChunkIds(
  obj: Record<string, unknown>,
  chunks: ExtractionChunk[],
): string[] {
  const known = new Map(chunks.map((chunk) => [chunk.chunkId, chunk]));
  const candidates: string[] = [];
  const raw =
    obj.sourceChunkIds ?? obj.chunkIds ?? obj.chunks ?? obj.sources ?? obj.sourceRefs ?? obj.citations;

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") {
        candidates.push(entry);
        continue;
      }
      const record = asRecord(entry);
      if (!record) continue;
      const id =
        asNonEmptyString(record.chunkId) ??
        asNonEmptyString(record.id) ??
        asNonEmptyString(record.sourceChunkId);
      if (id) candidates.push(id);
    }
  } else {
    const single =
      asNonEmptyString(obj.sourceChunkId) ??
      asNonEmptyString(obj.chunkId) ??
      asNonEmptyString(obj.source_id);
    if (single) candidates.push(single);
  }

  const exact = [...new Set(candidates.filter(isUuid))];
  if (known.size > 0) {
    const matched = exact.filter((id) => known.has(id));
    if (matched.length > 0) return matched;
  } else if (exact.length > 0) {
    return exact;
  }

  const quotes = normalizeSourceQuotes(obj);
  const overlapping: string[] = [];
  for (const chunk of chunks) {
    if (!chunk.content) continue;
    for (const quote of quotes) {
      const needle = quote.trim().slice(0, 80);
      if (needle.length >= 12 && chunk.content.includes(needle)) {
        overlapping.push(chunk.chunkId);
        break;
      }
    }
  }
  if (overlapping.length > 0) return [...new Set(overlapping)];

  const mentioned = [
    ...quotes,
    asNonEmptyString(obj.title) ?? "",
    asNonEmptyString(obj.description) ?? "",
  ]
    .join(" ")
    .match(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi);
  if (mentioned) {
    const nearby = [...new Set(mentioned.filter((id) => known.has(id)))];
    if (nearby.length > 0) return nearby;
  }

  return [];
}

function chunksFromOptions(options: NormalizeIntelligenceOptions): ExtractionChunk[] {
  if (options.availableChunks?.length) return options.availableChunks;
  return (options.availableChunkIds ?? []).map((chunkId) => ({
    chunkId,
    documentId: "",
    documentVersionId: "",
    content: "",
  }));
}

function normalizeSourceQuotes(obj: Record<string, unknown>): string[] {
  const fromArray = pickStringArray(obj, ["sourceQuotes", "quotes", "excerpts"]);
  if (fromArray.length > 0) return fromArray;
  const single = pickString(obj, ["quote", "excerpt", "supportingText", "text"]);
  return single ? [single] : [];
}

function slugifyFactKey(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
  return slug.length > 0 ? slug : "fact";
}

function normalizeConfidence(value: unknown): "low" | "medium" | "high" | undefined {
  const raw = asNonEmptyString(value)?.toLowerCase();
  if (raw === "low" || raw === "medium" || raw === "high") return raw;
  if (raw === "med") return "medium";
  return undefined;
}

function normalizeDatePrecision(
  value: unknown,
): z.infer<typeof datePrecisionSchema> | undefined {
  const raw = asNonEmptyString(value)?.toLowerCase();
  if (
    raw === "exact" ||
    raw === "approximate" ||
    raw === "month" ||
    raw === "year" ||
    raw === "range" ||
    raw === "unknown"
  ) {
    return raw;
  }
  return undefined;
}

function normalizeTimelineEvent(
  item: unknown,
  chunks: ExtractionChunk[],
): Record<string, unknown> | null {
  const obj = asRecord(item);
  if (!obj) return null;
  const title = pickString(obj, ["title", "name", "event", "summary", "label"]);
  const eventType =
    pickString(obj, ["eventType", "type", "category", "kind"]) ??
    (title ? slugifyFactKey(title) : undefined);
  const sourceChunkIds = normalizeSourceChunkIds(obj, chunks);
  if (!title || !eventType || sourceChunkIds.length === 0) return null;
  const sourceQuotes = normalizeSourceQuotes(obj);
  const description = pickString(obj, ["description", "details", "detail", "summary"]) ?? "";
  const eventDate = pickString(obj, ["eventDate", "date", "occurredAt", "on"]) ?? null;
  const eventDateEnd = pickString(obj, ["eventDateEnd", "endDate", "until"]) ?? null;
  const chunkText = sourceChunkIds
    .map((id) => chunks.find((chunk) => chunk.chunkId === id)?.content ?? "")
    .join("\n");
  const inferred = inferTimelineDate(
    [sourceQuotes.join("\n"), description, chunkText].join("\n"),
    eventDate,
  );
  const claimed = normalizeDatePrecision(obj.datePrecision);
  const datePrecision =
    claimed && claimed !== "exact"
      ? claimed
      : inferred.datePrecision !== "unknown"
        ? inferred.datePrecision
        : (claimed ?? "unknown");
  return {
    title,
    description,
    eventType,
    eventDate: inferred.eventDate ?? eventDate,
    eventDateEnd: inferred.eventDateEnd ?? eventDateEnd,
    datePrecision,
    actors: pickStringArray(obj, ["actors", "parties", "people"]),
    sourceChunkIds,
    sourceQuotes,
    confidence: normalizeConfidence(obj.confidence) ?? "medium",
    uncertaintyNotes:
      pickString(obj, ["uncertaintyNotes", "notes", "caveats"]) ?? inferred.uncertaintyNotes,
  };
}

function normalizeFact(item: unknown, chunks: ExtractionChunk[]): Record<string, unknown> | null {
  const obj = asRecord(item);
  if (!obj) return null;
  const label = pickString(obj, ["label", "name", "title", "fact", "key"]);
  const value = pickString(obj, ["value", "text", "content", "description", "detail", "answer"]);
  const factKey =
    pickString(obj, ["factKey", "key", "slug", "id"]) ??
    (label ? slugifyFactKey(label) : undefined);
  const sourceChunkIds = normalizeSourceChunkIds(obj, chunks);
  if (!factKey || !label || !value || sourceChunkIds.length === 0) return null;
  return {
    factKey: factKey.slice(0, 120),
    label,
    value,
    normalizedValue: pickString(obj, ["normalizedValue", "normalized", "canonicalValue"]) ?? null,
    sourceChunkIds,
    sourceQuotes: normalizeSourceQuotes(obj),
    confidence: normalizeConfidence(obj.confidence) ?? "medium",
    uncertaintyNotes: pickString(obj, ["uncertaintyNotes", "notes", "caveats"]) ?? null,
  };
}

function inferEntityType(name: string, hinted?: string): "person" | "organization" {
  const hint = hinted?.toLowerCase();
  if (hint === "person" || hint === "individual" || hint === "human") return "person";
  if (
    hint === "organization" ||
    hint === "org" ||
    hint === "company" ||
    hint === "corporation" ||
    hint === "entity"
  ) {
    return "organization";
  }
  return /corp|inc\.?|llc|ltd|company|bank|llp|plc|gmbh|ag\b/i.test(name)
    ? "organization"
    : "person";
}

function normalizeEntity(item: unknown, chunks: ExtractionChunk[]): Record<string, unknown> | null {
  if (typeof item === "string") {
    return null;
  }

  const obj = asRecord(item);
  if (!obj) return null;
  const displayName = pickString(obj, ["displayName", "name", "entity", "title", "label"]);
  const sourceChunkIds = normalizeSourceChunkIds(obj, chunks);
  if (!displayName || sourceChunkIds.length === 0) return null;
  const entityTypeRaw = pickString(obj, ["entityType", "type", "kind"]);
  return {
    entityType: inferEntityType(displayName, entityTypeRaw),
    displayName,
    aliases: pickStringArray(obj, ["aliases", "aka", "alsoKnownAs"]),
    roles: pickStringArray(obj, ["roles", "role", "partyRoles"]),
    description: pickString(obj, ["description", "details", "note"]) ?? null,
    sourceChunkIds,
    sourceQuotes: normalizeSourceQuotes(obj),
    confidence: normalizeConfidence(obj.confidence) ?? "medium",
  };
}

function normalizeDeadline(
  item: unknown,
  chunks: ExtractionChunk[],
): Record<string, unknown> | null {
  const obj = asRecord(item);
  if (!obj) return null;
  const title = pickString(obj, ["title", "name", "label", "deadline", "summary"]);
  const sourceChunkIds = normalizeSourceChunkIds(obj, chunks);
  if (!title || sourceChunkIds.length === 0) return null;
  const dateKindRaw = asNonEmptyString(obj.dateKind)?.toLowerCase();
  return {
    title,
    description: pickString(obj, ["description", "details", "detail", "text"]) ?? null,
    dueAt: pickString(obj, ["dueAt", "dueDate", "date", "deadlineDate"]) ?? null,
    dueAtEnd: pickString(obj, ["dueAtEnd", "endDate", "until"]) ?? null,
    datePrecision: normalizeDatePrecision(obj.datePrecision) ?? "unknown",
    dateKind: dateKindRaw === "inferred" ? "inferred" : "explicit",
    timezone: pickString(obj, ["timezone", "tz"]) ?? null,
    sourceChunkIds,
    sourceQuotes: normalizeSourceQuotes(obj),
    confidence: normalizeConfidence(obj.confidence) ?? "medium",
    uncertaintyNotes: pickString(obj, ["uncertaintyNotes", "notes", "caveats"]) ?? null,
  };
}

/**
 * Live models often return near-schema JSON (string entities, `name` instead of `displayName`,
 * missing `factKey` / `sourceChunkIds`). Normalize before Zod so extraction does not hard-fail.
 */
export function normalizeMatterIntelligenceExtractionRaw(
  raw: unknown,
  options: NormalizeIntelligenceOptions = {},
): unknown {
  const root = asRecord(raw) ?? {};
  const chunks = chunksFromOptions(options);

  const timelineRaw = Array.isArray(root.timelineEvents)
    ? root.timelineEvents
    : Array.isArray(root.timeline)
      ? root.timeline
      : Array.isArray(root.events)
        ? root.events
        : [];
  const factsRaw = Array.isArray(root.facts)
    ? root.facts
    : Array.isArray(root.matterFacts)
      ? root.matterFacts
      : [];
  const entitiesRaw = Array.isArray(root.entities)
    ? root.entities
    : Array.isArray(root.parties)
      ? root.parties
      : Array.isArray(root.people)
        ? root.people
        : [];
  const deadlinesRaw = Array.isArray(root.deadlines)
    ? root.deadlines
    : Array.isArray(root.deadlineCandidates)
      ? root.deadlineCandidates
      : [];

  return {
    timelineEvents: timelineRaw
      .map((item) => normalizeTimelineEvent(item, chunks))
      .filter(Boolean),
    facts: factsRaw.map((item) => normalizeFact(item, chunks)).filter(Boolean),
    entities: entitiesRaw.map((item) => normalizeEntity(item, chunks)).filter(Boolean),
    deadlines: deadlinesRaw
      .map((item) => normalizeDeadline(item, chunks))
      .filter(Boolean),
  };
}

export function parseMatterIntelligenceExtraction(
  raw: unknown,
  options: NormalizeIntelligenceOptions = {},
): MatterIntelligenceExtraction {
  return matterIntelligenceExtractionObjectSchema.parse(
    normalizeMatterIntelligenceExtractionRaw(raw, options),
  );
}

export function buildMatterIntelligenceSystemPrompt(): string {
  return [
    "You extract proposed matter intelligence from authorized document chunks only.",
    "Never invent facts, dates, names, deadlines, or citations.",
    "Every candidate MUST include sourceChunkIds using the exact chunkId UUIDs provided in Sources.",
    "If you cannot identify a sourceChunkId UUID, omit the candidate. Never invent source ids and never treat the whole document as the source.",
    "Prefer explicit dates. Mark ambiguous deadlines as inferred.",
    "Return JSON only with keys: timelineEvents, facts, entities, deadlines.",
    "facts items MUST be objects: {factKey, label, value, sourceChunkIds, sourceQuotes?, confidence?}.",
    "entities items MUST be objects: {entityType:\"person\"|\"organization\", displayName, sourceChunkIds, roles?, aliases?, sourceQuotes?, confidence?} — never bare strings.",
    "timelineEvents items MUST be objects: {title, eventType, sourceChunkIds, eventDate?, eventDateEnd?, datePrecision, description?, actors?, sourceQuotes?, confidence?, uncertaintyNotes?}.",
    "datePrecision MUST be one of exact, approximate, month, year, range, unknown.",
    "Use exact only for a full explicit calendar date stated in the source. Do not upgrade around/near mid-/on or about/approximately to exact.",
    "If a source contains multiple distinct dated events such as invoice issued, due date, remittance, and receipt, emit one timeline event per proposition. Do not collapse them.",
    "Do not treat badge or access-log activity as a named person's physical act.",
    "Do not title a denial as a positive entry event.",
    "Do not calculate term-expiration dates from durations unless that calendar day is stated in the source.",
    "deadlines items MUST be objects: {title, sourceChunkIds, dueAt?, dateKind:\"explicit\"|\"inferred\", sourceQuotes?, confidence?}.",
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
