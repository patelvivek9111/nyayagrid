import type {
  CanonicalCompareOutput,
  CanonicalContradictionOutput,
  CanonicalAnalysisFinding,
  CanonicalAnalysisOutput,
  CanonicalMemory,
  CanonicalMemoryOutput,
  CanonicalTimelineOutput,
  ContradictionSemanticClass,
} from "../graders/structured-schemas";
import type { IngestedMatter } from "./ingest";

type ComparisonRow = {
  id: string;
  documentAId: string;
  documentBId: string;
  documentAVersionId: string;
  documentBVersionId: string;
  summary: string | null;
};

type ComparisonChangeRow = {
  oldText: string | null;
  newText: string | null;
  changeType: string;
  attention: string;
  locationA: string | null;
  locationB: string | null;
};

type FindingSourceRow = {
  documentId: string;
  documentVersionId: string | null;
  chunkId: string | null;
  supportingText: string;
  side: string | null;
};

type FindingRow = {
  id: string;
  findingType: string;
  title: string;
  explanation: string | null;
  status: string;
  sources?: FindingSourceRow[];
};

function filenameFor(matter: IngestedMatter, documentId: string): string | null {
  return matter.documents.find((doc) => doc.nyayaDocumentId === documentId)?.filename ?? null;
}

export function adaptCompareOutput(params: {
  taskId: string;
  matter: IngestedMatter;
  comparison: ComparisonRow;
  changes: ComparisonChangeRow[];
  leftFilename: string | null;
  rightFilename: string | null;
  summaryAlignment?: string | null;
  summaryUnsupportedClaimCount?: number;
}): CanonicalCompareOutput {
  const leftFilename =
    params.leftFilename ?? filenameFor(params.matter, params.comparison.documentAId);
  const rightFilename =
    params.rightFilename ?? filenameFor(params.matter, params.comparison.documentBId);
  const citations = [
    {
      documentId: params.comparison.documentAId,
      documentVersionId: params.comparison.documentAVersionId,
      filename: leftFilename,
      location: null,
    },
    {
      documentId: params.comparison.documentBId,
      documentVersionId: params.comparison.documentBVersionId,
      filename: rightFilename,
      location: null,
    },
  ];
  return {
    taskId: params.taskId,
    comparisonId: params.comparison.id,
    leftDocumentId: params.comparison.documentAId,
    rightDocumentId: params.comparison.documentBId,
    leftFilename,
    rightFilename,
    changes: params.changes.map((change) => ({
      before: change.oldText,
      after: change.newText,
      changeType: change.changeType,
      materiality: change.attention,
      locationA: change.locationA,
      locationB: change.locationB,
      sourceReferences: [
        {
          documentId: params.comparison.documentAId,
          documentVersionId: params.comparison.documentAVersionId,
          filename: leftFilename,
          location: change.locationA,
        },
        {
          documentId: params.comparison.documentBId,
          documentVersionId: params.comparison.documentBVersionId,
          filename: rightFilename,
          location: change.locationB,
        },
      ],
    })),
    summary: params.comparison.summary,
    citations,
    summaryAlignment: params.summaryAlignment ?? null,
    summaryUnsupportedClaimCount: params.summaryUnsupportedClaimCount,
  };
}

export function adaptContradictionOutput(params: {
  taskId: string;
  matter: IngestedMatter;
  findings: FindingRow[];
}): CanonicalContradictionOutput {
  const findings = params.findings.map((finding) => {
    const sources = finding.sources ?? [];
    const sourceA = sources
      .filter((s) => (s.side ?? "A").toUpperCase() === "A")
      .map((s) => ({
        documentId: s.documentId,
        documentVersionId: s.documentVersionId,
        filename: filenameFor(params.matter, s.documentId),
        chunkId: s.chunkId,
        supportingText: s.supportingText,
        side: s.side,
      }));
    const sourceB = sources
      .filter((s) => (s.side ?? "B").toUpperCase() === "B")
      .map((s) => ({
        documentId: s.documentId,
        documentVersionId: s.documentVersionId,
        filename: filenameFor(params.matter, s.documentId),
        chunkId: s.chunkId,
        supportingText: s.supportingText,
        side: s.side,
      }));
    const statementA =
      sourceA
        .map((s) => s.supportingText)
        .filter(Boolean)
        .join("\n") || finding.title;
    const statementB =
      sourceB
        .map((s) => s.supportingText)
        .filter(Boolean)
        .join("\n") ||
      finding.explanation ||
      "";
    const semanticClass: ContradictionSemanticClass =
      finding.findingType === "tension" || finding.findingType === "contradiction"
        ? finding.findingType
        : "insufficient";
    return {
      findingId: finding.id,
      productionFindingType: finding.findingType,
      semanticClass,
      statementA,
      statementB,
      sourceA,
      sourceB,
      status: finding.status,
      title: finding.title,
      explanation: finding.explanation,
    };
  });
  return { taskId: params.taskId, findings };
}

export function documentIndexFor(matter: IngestedMatter) {
  return matter.documents.map((doc) => ({
    nyayaDocumentId: doc.nyayaDocumentId,
    filename: doc.filename,
    title: doc.title,
  }));
}

type TimelineSourceRow = {
  documentId: string;
  documentVersionId?: string | null;
  chunkId?: string | null;
  supportingText?: string | null;
};

type TimelineEventRow = {
  id: string;
  eventType: string;
  title: string;
  description?: string | null;
  eventDate?: Date | string | null;
  eventDateEnd?: Date | string | null;
  datePrecision?: string | null;
  actors?: unknown;
  status: string;
  uncertaintyNotes?: string | null;
  sources?: unknown[];
};

function isoDay(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return match?.[1] ?? String(value);
}

function asActorList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry).trim()).filter(Boolean);
}

export function adaptTimelineOutput(params: {
  taskId: string;
  matter: IngestedMatter;
  events: TimelineEventRow[];
}): CanonicalTimelineOutput {
  return {
    taskId: params.taskId,
    events: params.events.map((event) => {
      const sources = (event.sources ?? []).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const source = item as TimelineSourceRow;
        if (!source.documentId) return [];
        return [
          {
            documentId: source.documentId,
            documentVersionId: source.documentVersionId ?? null,
            filename: filenameFor(params.matter, source.documentId),
            chunkId: source.chunkId ?? null,
            supportingText: source.supportingText ?? "",
          },
        ];
      });
      return {
        eventId: event.id,
        eventType: event.eventType,
        title: event.title,
        description: event.description ?? null,
        date: isoDay(event.eventDate),
        dateEnd: isoDay(event.eventDateEnd),
        datePrecision: event.datePrecision ?? "unknown",
        actors: asActorList(event.actors),
        sourceDocumentIds: [...new Set(sources.map((s) => s.documentId).filter(Boolean))],
        sourceChunkIds: [
          ...new Set(sources.map((s) => s.chunkId).filter((id): id is string => Boolean(id))),
        ],
        sources,
        status: event.status,
        uncertaintyNotes: event.uncertaintyNotes ?? null,
      };
    }),
  };
}

type PublicMemoryRow = {
  id: string;
  title: string;
  content: string;
  memoryType: string;
  status: string;
  origin?: string | null;
  sourceType?: string | null;
  confidence?: string | null;
  importance: string;
  badge?: string | null;
  supersededBy?: string | null;
  sources?: Array<{
    documentId: string;
    chunkId: string;
    supportingText: string;
    documentTitle?: string | null;
  }>;
};

export function adaptMemoryOutput(params: {
  taskId: string;
  matter: IngestedMatter;
  memories: PublicMemoryRow[];
  active: PublicMemoryRow[];
  formattedForPrompt: string;
  createdIds: string[];
  actionKind: string;
}): CanonicalMemoryOutput {
  const created = new Set(params.createdIds);
  const mapOne = (row: PublicMemoryRow): CanonicalMemory => {
    const sources = (row.sources ?? []).map((source) => ({
      documentId: source.documentId,
      chunkId: source.chunkId,
      supportingText: source.supportingText,
      filename: filenameFor(params.matter, source.documentId),
    }));
    return {
      memoryId: row.id,
      title: row.title,
      content: row.content,
      proposition: `${row.title} ${row.content}`.trim(),
      memoryType: row.memoryType,
      status: row.status,
      origin: row.origin ?? null,
      sourceType: row.sourceType ?? null,
      confidence: row.confidence ?? null,
      importance: row.importance,
      badge: row.badge ?? null,
      sourceDocumentIds: [...new Set(sources.map((s) => s.documentId).filter(Boolean))],
      sourceChunkIds: [...new Set(sources.map((s) => s.chunkId).filter(Boolean))],
      sources,
      supersededBy: row.supersededBy ?? null,
      createdThisAction: created.has(row.id),
    };
  };
  return {
    taskId: params.taskId,
    actionKind: params.actionKind,
    memories: params.memories.map(mapOne),
    activeForDownstream: params.active.map(mapOne),
    formattedForPrompt: params.formattedForPrompt,
    createdIds: params.createdIds,
  };
}

type ContractAnalysisFull = {
  analysis: { id: string; documentId: string; status: string; summary: string | null };
  items: Array<{
    id: string;
    category: string;
    title: string;
    explanation: string | null;
    status: string;
    confidence: string;
    attention?: string | null;
    sources: Array<{
      documentId: string;
      documentVersionId: string | null;
      chunkId: string;
      supportingText: string;
    }>;
  }>;
} | null;

type DepositionFindingRow = {
  id: string;
  findingType: string;
  title: string;
  explanation: string | null;
  status: string;
  confidence?: string | null;
  sources?: Array<{
    documentId: string;
    documentVersionId?: string | null;
    chunkId?: string | null;
    supportingText?: string | null;
  }>;
};

type EvidenceIssueRow = {
  issueKey: string;
  label: string;
  supporting: Array<{ kind: string; id: string; rationale: string }>;
  contrary: Array<{ kind: string; id: string; rationale: string }>;
  gaps: Array<{ rationale: string }>;
};

export function adaptAnalysisOutput(params: {
  taskId: string;
  matter: IngestedMatter;
  actionKind: string;
  engine: string;
  contract: ContractAnalysisFull;
  depositionFindings: DepositionFindingRow[];
  evidenceMatrix: EvidenceIssueRow[];
  formattedForPrompt: string;
  createdIds: string[];
  skipped: boolean;
  modelCalls: number;
  proposedInAskNyaya: string[];
  reviewedInAskNyaya: string[];
  rejectedMalformed?: number;
  rejectedNoSource?: number;
  normalizedCount?: number;
  jsonParseFailed?: boolean;
  parseRetryCount?: number;
  parentSummary?: string | null;
  rejectedBadSpan?: number;
  duplicateSuppressed?: number;
}): CanonicalAnalysisOutput {
  const created = new Set(params.createdIds);
  const findings: CanonicalAnalysisFinding[] = [];
  if (params.contract) {
    for (const item of params.contract.items) {
      const sources = item.sources.map((source) => ({
        documentId: source.documentId,
        documentVersionId: source.documentVersionId,
        filename: filenameFor(params.matter, source.documentId),
        chunkId: source.chunkId,
        supportingText: source.supportingText,
      }));
      findings.push({
        findingId: item.id,
        findingType: item.category,
        proposition: `${item.title} ${item.explanation ?? ""}`.trim(),
        status: item.status,
        confidence: item.confidence,
        attention: item.attention ?? null,
        sourceDocumentIds: [...new Set(sources.map((s) => s.documentId))],
        sourceChunkIds: [...new Set(sources.map((s) => s.chunkId).filter(Boolean))],
        supportingText: sources.map((s) => s.supportingText).join("\n"),
        originKind: "contract_item",
        createdThisAction: created.has(item.id),
        sources,
      });
    }
  }
  for (const row of params.depositionFindings) {
    const sources = (row.sources ?? []).map((source) => ({
      documentId: source.documentId,
      documentVersionId: source.documentVersionId ?? null,
      filename: filenameFor(params.matter, source.documentId),
      chunkId: source.chunkId ?? null,
      supportingText: source.supportingText ?? "",
    }));
    findings.push({
      findingId: row.id,
      findingType: row.findingType,
      proposition: `${row.title} ${row.explanation ?? ""}`.trim(),
      status: row.status,
      confidence: row.confidence ?? null,
      sourceDocumentIds: [...new Set(sources.map((s) => s.documentId).filter(Boolean))],
      sourceChunkIds: [
        ...new Set(sources.map((s) => s.chunkId).filter((id): id is string => Boolean(id))),
      ],
      supportingText: sources.map((s) => s.supportingText).join("\n"),
      originKind: "deposition_finding",
      createdThisAction: created.has(row.id),
      sources,
    });
  }
  return {
    taskId: params.taskId,
    actionKind: params.actionKind,
    engine: params.engine,
    findings,
    formattedForPrompt: params.formattedForPrompt,
    createdIds: params.createdIds,
    skipped: params.skipped,
    modelCalls: params.modelCalls,
    proposedInAskNyaya: params.proposedInAskNyaya,
    reviewedInAskNyaya: params.reviewedInAskNyaya,
    evidenceIssueCount: params.evidenceMatrix.length,
    rejectedMalformed: params.rejectedMalformed ?? 0,
    rejectedNoSource: params.rejectedNoSource ?? 0,
    normalizedCount: params.normalizedCount ?? 0,
    jsonParseFailed: params.jsonParseFailed ?? false,
    parseRetryCount: params.parseRetryCount ?? 0,
    parentSummary: params.parentSummary ?? params.contract?.analysis.summary ?? null,
    rejectedBadSpan: params.rejectedBadSpan ?? 0,
    duplicateSuppressed: params.duplicateSuppressed ?? 0,
  };
}
