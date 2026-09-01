export const STRUCTURED_GRADER_VERSION = "b1-2026-08-18";
export const TIMELINE_STRUCTURED_GRADER_VERSION = "t1-2026-08-19";
export const MEMORY_STRUCTURED_GRADER_VERSION = "m1-2026-08-19";
export const ANALYSIS_STRUCTURED_GRADER_VERSION = "ca1-2026-08-19";

function asString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => asString(entry)).filter((entry): entry is string => Boolean(entry));
}

export type CanonicalCompareSourceRef = {
  documentId: string;
  documentVersionId: string | null;
  filename: string | null;
  location: string | null;
};

export type CanonicalCompareChange = {
  before: string | null;
  after: string | null;
  changeType: string;
  materiality: string;
  locationA: string | null;
  locationB: string | null;
  sourceReferences: CanonicalCompareSourceRef[];
};

export type CanonicalCompareOutput = {
  taskId: string;
  comparisonId: string;
  leftDocumentId: string;
  rightDocumentId: string;
  leftFilename: string | null;
  rightFilename: string | null;
  changes: CanonicalCompareChange[];
  summary: string | null;
  citations: CanonicalCompareSourceRef[];
  summaryAlignment: string | null;
  summaryUnsupportedClaimCount?: number;
};

export type ContradictionSemanticClass =
  "contradiction" | "tension" | "compatible" | "insufficient";

export type CanonicalContradictionSource = {
  documentId: string;
  documentVersionId: string | null;
  filename: string | null;
  chunkId: string | null;
  supportingText: string;
  side: string | null;
};

export type CanonicalContradictionFinding = {
  findingId: string;
  productionFindingType: string;
  semanticClass: ContradictionSemanticClass;
  statementA: string;
  statementB: string;
  sourceA: CanonicalContradictionSource[];
  sourceB: CanonicalContradictionSource[];
  status: string;
  title: string;
  explanation: string | null;
};

export type CanonicalContradictionOutput = {
  taskId: string;
  findings: CanonicalContradictionFinding[];
};

export type CanonicalTimelineSource = {
  documentId: string;
  documentVersionId: string | null;
  filename: string | null;
  chunkId: string | null;
  supportingText: string;
};

export type CanonicalTimelineEvent = {
  eventId: string;
  eventType: string;
  title: string;
  description: string | null;
  date: string | null;
  dateEnd: string | null;
  datePrecision: string;
  actors: string[];
  sourceDocumentIds: string[];
  sourceChunkIds: string[];
  sources: CanonicalTimelineSource[];
  status: string;
  uncertaintyNotes: string | null;
};

export type CanonicalTimelineOutput = {
  taskId: string;
  events: CanonicalTimelineEvent[];
};

export type CanonicalMemorySource = {
  documentId: string;
  chunkId: string | null;
  supportingText: string;
  filename: string | null;
};

export type CanonicalMemory = {
  memoryId: string;
  title: string;
  content: string;
  proposition: string;
  memoryType: string;
  status: string;
  origin: string | null;
  sourceType: string | null;
  confidence: string | null;
  importance: string;
  badge: string | null;
  sourceDocumentIds: string[];
  sourceChunkIds: string[];
  sources: CanonicalMemorySource[];
  supersededBy: string | null;
  createdThisAction: boolean;
};

export type CanonicalMemoryOutput = {
  taskId: string;
  actionKind: string;
  memories: CanonicalMemory[];
  activeForDownstream: CanonicalMemory[];
  formattedForPrompt: string;
  createdIds: string[];
};

export type CanonicalAnalysisSource = {
  documentId: string;
  documentVersionId: string | null;
  filename: string | null;
  chunkId: string | null;
  supportingText: string;
};

export type CanonicalAnalysisFinding = {
  findingId: string;
  findingType: string;
  proposition: string;
  status: string;
  confidence: string | null;
  attention?: string | null;
  sourceDocumentIds: string[];
  sourceChunkIds: string[];
  supportingText: string;
  originKind: string;
  createdThisAction: boolean;
  sources: CanonicalAnalysisSource[];
};

export type CanonicalAnalysisOutput = {
  taskId: string;
  actionKind: string;
  engine: string;
  findings: CanonicalAnalysisFinding[];
  formattedForPrompt: string;
  createdIds: string[];
  skipped: boolean;
  modelCalls: number;
  proposedInAskNyaya: string[];
  reviewedInAskNyaya: string[];
  evidenceIssueCount: number;
  rejectedMalformed?: number;
  rejectedNoSource?: number;
  normalizedCount?: number;
  jsonParseFailed?: boolean;
  parseRetryCount?: number;
  parentSummary?: string | null;
  rejectedBadSpan?: number;
  duplicateSuppressed?: number;
};

function parseSourceRef(value: unknown): CanonicalCompareSourceRef {
  const rec = asRecord(value) ?? {};
  return {
    documentId: asString(rec.documentId) ?? "",
    documentVersionId: asString(rec.documentVersionId),
    filename: asString(rec.filename),
    location: asString(rec.location),
  };
}

function parseContradictionSource(value: unknown): CanonicalContradictionSource {
  const rec = asRecord(value) ?? {};
  return {
    documentId: asString(rec.documentId) ?? "",
    documentVersionId: asString(rec.documentVersionId),
    filename: asString(rec.filename),
    chunkId: asString(rec.chunkId),
    supportingText: asString(rec.supportingText) ?? "",
    side: asString(rec.side),
  };
}

export function parseCompareOutput(
  extras: Record<string, unknown> | undefined,
): CanonicalCompareOutput | null {
  const raw = extras?.structuredOutput;
  const rec = asRecord(raw);
  if (!rec) return null;
  if (extras?.structuredKind !== "compare" && extras?.executionTarget !== "contract_compare") {
    return null;
  }
  const changesRaw = Array.isArray(rec.changes) ? rec.changes : [];
  const citationsRaw = Array.isArray(rec.citations) ? rec.citations : [];
  return {
    taskId: asString(rec.taskId) ?? "",
    comparisonId: asString(rec.comparisonId) ?? "",
    leftDocumentId: asString(rec.leftDocumentId) ?? "",
    rightDocumentId: asString(rec.rightDocumentId) ?? "",
    leftFilename: asString(rec.leftFilename),
    rightFilename: asString(rec.rightFilename),
    changes: changesRaw.map((row) => {
      const e = asRecord(row) ?? {};
      const refs = Array.isArray(e.sourceReferences) ? e.sourceReferences : [];
      return {
        before: asString(e.before) ?? asString(e.oldText),
        after: asString(e.after) ?? asString(e.newText),
        changeType: asString(e.changeType) ?? "",
        materiality: asString(e.materiality) ?? asString(e.attention) ?? "",
        locationA: asString(e.locationA),
        locationB: asString(e.locationB),
        sourceReferences: refs.map(parseSourceRef),
      };
    }),
    summary: asString(rec.summary),
    citations: citationsRaw.map(parseSourceRef),
    summaryAlignment: asString(rec.summaryAlignment),
    summaryUnsupportedClaimCount:
      typeof rec.summaryUnsupportedClaimCount === "number"
        ? rec.summaryUnsupportedClaimCount
        : undefined,
  };
}

export function parseContradictionOutput(
  extras: Record<string, unknown> | undefined,
): CanonicalContradictionOutput | null {
  const raw = extras?.structuredOutput;
  const rec = asRecord(raw);
  if (!rec) return null;
  if (extras?.structuredKind !== "contradiction" && extras?.executionTarget !== "contradiction") {
    return null;
  }
  const findingsRaw = Array.isArray(rec.findings) ? rec.findings : [];
  return {
    taskId: asString(rec.taskId) ?? "",
    findings: findingsRaw.map((row) => {
      const e = asRecord(row) ?? {};
      const sourceA = Array.isArray(e.sourceA) ? e.sourceA : [];
      const sourceB = Array.isArray(e.sourceB) ? e.sourceB : [];
      const semantic = asString(e.semanticClass);
      const semanticClass: ContradictionSemanticClass =
        semantic === "tension" ||
        semantic === "compatible" ||
        semantic === "insufficient" ||
        semantic === "contradiction"
          ? semantic
          : "insufficient";
      return {
        findingId: asString(e.findingId) ?? asString(e.id) ?? "",
        productionFindingType: asString(e.productionFindingType) ?? asString(e.findingType) ?? "",
        semanticClass,
        statementA: asString(e.statementA) ?? "",
        statementB: asString(e.statementB) ?? "",
        sourceA: sourceA.map(parseContradictionSource),
        sourceB: sourceB.map(parseContradictionSource),
        status: asString(e.status) ?? "proposed",
        title: asString(e.title) ?? "",
        explanation: asString(e.explanation),
      };
    }),
  };
}

export function parseTimelineOutput(
  extras: Record<string, unknown> | undefined,
): CanonicalTimelineOutput | null {
  const raw = extras?.structuredOutput;
  const rec = asRecord(raw);
  if (!rec) return null;
  if (extras?.structuredKind !== "timeline" && extras?.executionTarget !== "timeline") {
    return null;
  }
  const eventsRaw = Array.isArray(rec.events) ? rec.events : [];
  return {
    taskId: asString(rec.taskId) ?? "",
    events: eventsRaw.map((row) => {
      const e = asRecord(row) ?? {};
      const sourcesRaw = Array.isArray(e.sources) ? e.sources : [];
      const sources: CanonicalTimelineSource[] = sourcesRaw.map((item) => {
        const s = asRecord(item) ?? {};
        return {
          documentId: asString(s.documentId) ?? "",
          documentVersionId: asString(s.documentVersionId),
          filename: asString(s.filename),
          chunkId: asString(s.chunkId),
          supportingText: asString(s.supportingText) ?? "",
        };
      });
      const sourceDocumentIds = asStringArray(e.sourceDocumentIds).length
        ? asStringArray(e.sourceDocumentIds)
        : [...new Set(sources.map((s) => s.documentId).filter(Boolean))];
      const sourceChunkIds = asStringArray(e.sourceChunkIds).length
        ? asStringArray(e.sourceChunkIds)
        : [...new Set(sources.map((s) => s.chunkId).filter((id): id is string => Boolean(id)))];
      return {
        eventId: asString(e.eventId) ?? asString(e.id) ?? "",
        eventType: asString(e.eventType) ?? "",
        title: asString(e.title) ?? "",
        description: asString(e.description),
        date: asString(e.date) ?? asString(e.eventDate),
        dateEnd: asString(e.dateEnd) ?? asString(e.eventDateEnd),
        datePrecision: asString(e.datePrecision) ?? "unknown",
        actors: asStringArray(e.actors),
        sourceDocumentIds,
        sourceChunkIds,
        sources,
        status: asString(e.status) ?? "proposed",
        uncertaintyNotes: asString(e.uncertaintyNotes),
      };
    }),
  };
}

function parseCanonicalMemory(row: unknown, created: Set<string>): CanonicalMemory {
  const e = asRecord(row) ?? {};
  const sourcesRaw = Array.isArray(e.sources) ? e.sources : [];
  const sources: CanonicalMemorySource[] = sourcesRaw.map((item) => {
    const s = asRecord(item) ?? {};
    return {
      documentId: asString(s.documentId) ?? "",
      chunkId: asString(s.chunkId),
      supportingText: asString(s.supportingText) ?? "",
      filename: asString(s.filename) ?? asString(s.documentTitle),
    };
  });
  const memoryId = asString(e.memoryId) ?? asString(e.id) ?? "";
  const title = asString(e.title) ?? "";
  const content = asString(e.content) ?? "";
  return {
    memoryId,
    title,
    content,
    proposition: asString(e.proposition) ?? `${title} ${content}`.trim(),
    memoryType: asString(e.memoryType) ?? "other",
    status: asString(e.status) ?? "proposed",
    origin: asString(e.origin),
    sourceType: asString(e.sourceType),
    confidence: asString(e.confidence),
    importance: asString(e.importance) ?? "normal",
    badge: asString(e.badge),
    sourceDocumentIds: asStringArray(e.sourceDocumentIds).length
      ? asStringArray(e.sourceDocumentIds)
      : [...new Set(sources.map((s) => s.documentId).filter(Boolean))],
    sourceChunkIds: asStringArray(e.sourceChunkIds).length
      ? asStringArray(e.sourceChunkIds)
      : [...new Set(sources.map((s) => s.chunkId).filter((id): id is string => Boolean(id)))],
    sources,
    supersededBy: asString(e.supersededBy),
    createdThisAction: Boolean(e.createdThisAction) || created.has(memoryId),
  };
}

export function parseMemoryOutput(
  extras: Record<string, unknown> | undefined,
): CanonicalMemoryOutput | null {
  const raw = extras?.structuredOutput;
  const rec = asRecord(raw);
  if (!rec) return null;
  if (extras?.structuredKind !== "memory" && extras?.executionTarget !== "memory") {
    return null;
  }
  const createdIds = asStringArray(rec.createdIds);
  const created = new Set(createdIds);
  const memoriesRaw = Array.isArray(rec.memories) ? rec.memories : [];
  const activeRaw = Array.isArray(rec.activeForDownstream) ? rec.activeForDownstream : [];
  return {
    taskId: asString(rec.taskId) ?? "",
    actionKind: asString(rec.actionKind) ?? "",
    memories: memoriesRaw.map((row) => parseCanonicalMemory(row, created)),
    activeForDownstream: activeRaw.map((row) => parseCanonicalMemory(row, created)),
    formattedForPrompt: asString(rec.formattedForPrompt) ?? "",
    createdIds,
  };
}

export function parseAnalysisOutput(
  extras: Record<string, unknown> | undefined,
): CanonicalAnalysisOutput | null {
  const raw = extras?.structuredOutput;
  const rec = asRecord(raw);
  if (!rec) return null;
  if (
    extras?.structuredKind !== "analysis" &&
    extras?.executionTarget !== "professional_analysis"
  ) {
    return null;
  }
  const createdIds = asStringArray(rec.createdIds);
  const created = new Set(createdIds);
  const findingsRaw = Array.isArray(rec.findings) ? rec.findings : [];
  return {
    taskId: asString(rec.taskId) ?? "",
    actionKind: asString(rec.actionKind) ?? "",
    engine: asString(rec.engine) ?? "",
    findings: findingsRaw.map((row) => {
      const e = asRecord(row) ?? {};
      const sourcesRaw = Array.isArray(e.sources) ? e.sources : [];
      const sources: CanonicalAnalysisSource[] = sourcesRaw.map((item) => {
        const s = asRecord(item) ?? {};
        return {
          documentId: asString(s.documentId) ?? "",
          documentVersionId: asString(s.documentVersionId),
          filename: asString(s.filename),
          chunkId: asString(s.chunkId),
          supportingText: asString(s.supportingText) ?? "",
        };
      });
      const sourceDocumentIds =
        asStringArray(e.sourceDocumentIds).length > 0
          ? asStringArray(e.sourceDocumentIds)
          : [...new Set(sources.map((s) => s.documentId).filter(Boolean))];
      const sourceChunkIds =
        asStringArray(e.sourceChunkIds).length > 0
          ? asStringArray(e.sourceChunkIds)
          : [...new Set(sources.map((s) => s.chunkId).filter((id): id is string => Boolean(id)))];
      const findingId = asString(e.findingId) ?? asString(e.id) ?? "";
      return {
        findingId,
        findingType: asString(e.findingType) ?? asString(e.category) ?? "",
        proposition:
          asString(e.proposition) ??
          `${asString(e.title) ?? ""} ${asString(e.explanation) ?? ""}`.trim(),
        status: asString(e.status) ?? "proposed",
        confidence: asString(e.confidence),
        attention: asString(e.attention),
        sourceDocumentIds,
        sourceChunkIds,
        supportingText: sources.map((s) => s.supportingText).join("\n"),
        originKind: asString(e.originKind) ?? "",
        createdThisAction: created.has(findingId) || Boolean(e.createdThisAction),
        sources,
      };
    }),
    formattedForPrompt: asString(rec.formattedForPrompt) ?? "",
    createdIds,
    skipped: rec.skipped === true,
    modelCalls: typeof rec.modelCalls === "number" ? rec.modelCalls : 0,
    proposedInAskNyaya: asStringArray(rec.proposedInAskNyaya),
    reviewedInAskNyaya: asStringArray(rec.reviewedInAskNyaya),
    evidenceIssueCount: typeof rec.evidenceIssueCount === "number" ? rec.evidenceIssueCount : 0,
    rejectedMalformed: typeof rec.rejectedMalformed === "number" ? rec.rejectedMalformed : 0,
    rejectedNoSource: typeof rec.rejectedNoSource === "number" ? rec.rejectedNoSource : 0,
    normalizedCount: typeof rec.normalizedCount === "number" ? rec.normalizedCount : 0,
    jsonParseFailed: rec.jsonParseFailed === true,
    parseRetryCount: typeof rec.parseRetryCount === "number" ? rec.parseRetryCount : 0,
    parentSummary: asString(rec.parentSummary),
    rejectedBadSpan: typeof rec.rejectedBadSpan === "number" ? rec.rejectedBadSpan : 0,
    duplicateSuppressed: typeof rec.duplicateSuppressed === "number" ? rec.duplicateSuppressed : 0,
  };
}
