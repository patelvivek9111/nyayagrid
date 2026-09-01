import type { AIProvider } from "@nyayagrid/ai";
import type { Database } from "@nyayagrid/database";
import {
  analyzeContract,
  analyzeDeposition,
  formatProfessionalAnalysisForPrompt,
  getContractAnalysis,
  getEvidenceIntelligence,
  listFindings,
  loadProfessionalAnalysisContext,
  askNyayaAnalysisTitles,
  reviewAnalysisItem,
} from "@nyayagrid/intelligence";
import type { AnalysisBenchAction, BenchScenario, BenchTask } from "./catalog";
import type { IngestedMatter } from "./ingest";
import { adaptAnalysisOutput, documentIndexFor } from "./adapt-structured";
import { executeEvidenceMatrixTarget } from "./execute-evidence";

function findDoc(matter: IngestedMatter, pattern: string) {
  const re = new RegExp(pattern, "i");
  return matter.documents.find((doc) => re.test(doc.filename) || re.test(doc.title));
}

function requireDoc(matter: IngestedMatter, pattern: string | undefined, label: string) {
  if (!pattern) throw new Error(`${label} requires documentPattern`);
  const doc = findDoc(matter, pattern);
  if (!doc) throw new Error(`No ingested document matching ${pattern}`);
  return doc;
}

function askNyayaLists(context: Parameters<typeof askNyayaAnalysisTitles>[0]) {
  const titles = askNyayaAnalysisTitles(context);
  return {
    proposedInAskNyaya: titles.proposed,
    reviewedInAskNyaya: titles.reviewed,
  };
}

function contractAnalysisId(result: Awaited<ReturnType<typeof analyzeContract>>): string {
  const payload = result.analysis as { analysis?: { id: string }; id?: string };
  const id = payload.analysis?.id ?? payload.id;
  if (!id) throw new Error("Missing contract analysis id");
  return id;
}

function contractTelemetry(result: Awaited<ReturnType<typeof analyzeContract>>) {
  if (result.skipped) {
    return {
      rejectedMalformed: 0,
      rejectedNoSource: 0,
      rejectedBadSpan: 0,
      normalizedCount: 0,
      jsonParseFailed: false,
      duplicateSuppressed: 0,
    };
  }
  return {
    rejectedMalformed: result.rejectedMalformed,
    rejectedNoSource: result.rejectedNoSource,
    rejectedBadSpan: result.rejectedBadSpan,
    normalizedCount: result.normalizedCount,
    jsonParseFailed: result.jsonParseFailed,
    duplicateSuppressed: result.duplicateSuppressed,
  };
}

export async function executeAnalysisTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const { db, matter, task, ai } = params;
  const action: AnalysisBenchAction = task.analysisAction ?? {
    kind: "analyze_contract",
    documentPattern: "01_Main_Agreement",
  };
  const orgMatterUser = {
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
    ai,
  };

  let modelCalls = 0;
  let skipped = false;
  const createdIds: string[] = [];

  if (action.kind === "analyze_contract" || action.kind === "downstream_context") {
    const doc = requireDoc(matter, action.documentPattern, action.kind);
    const first = await analyzeContract({
      ...orgMatterUser,
      documentId: doc.nyayaDocumentId,
      documentVersionId: doc.nyayaVersionId,
      force: true,
    });
    modelCalls += first.skipped ? 0 : 1;
    skipped = first.skipped;
    const analysisId = contractAnalysisId(first);
    const full = await getContractAnalysis({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      analysisId,
    });
    createdIds.push(...(full?.items.map((item) => item.id) ?? []));
    const context = await loadProfessionalAnalysisContext({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      limit: 12,
    });
    const formattedForPrompt = formatProfessionalAnalysisForPrompt(context);
    const structured = adaptAnalysisOutput({
      taskId: task.taskId,
      matter,
      actionKind: action.kind,
      engine: "contract",
      contract: full,
      depositionFindings: [],
      evidenceMatrix: [],
      formattedForPrompt,
      createdIds,
      skipped,
      modelCalls,
      proposedInAskNyaya: askNyayaLists(context).proposedInAskNyaya,
      reviewedInAskNyaya: askNyayaLists(context).reviewedInAskNyaya,
      ...contractTelemetry(first),
      parentSummary: full?.analysis.summary ?? null,
    });
    return {
      answer: JSON.stringify(structured, null, 2),
      extras: {
        executionTarget: "professional_analysis",
        structuredKind: "analysis",
        structuredOutput: structured,
        documentIndex: documentIndexFor(matter),
        analysisEngine: "contract",
        modelCalls,
      },
    };
  }

  if (action.kind === "duplicate_contract") {
    const doc = requireDoc(matter, action.documentPattern, action.kind);
    const first = await analyzeContract({
      ...orgMatterUser,
      documentId: doc.nyayaDocumentId,
      documentVersionId: doc.nyayaVersionId,
      force: true,
    });
    modelCalls += 1;
    const second = await analyzeContract({
      ...orgMatterUser,
      documentId: doc.nyayaDocumentId,
      documentVersionId: doc.nyayaVersionId,
    });
    skipped = second.skipped;
    const analysisId = contractAnalysisId(second);
    const full = await getContractAnalysis({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      analysisId,
    });
    createdIds.push(...(full?.items.map((item) => item.id) ?? []));
    const structured = adaptAnalysisOutput({
      taskId: task.taskId,
      matter,
      actionKind: action.kind,
      engine: "contract",
      contract: full,
      depositionFindings: [],
      evidenceMatrix: [],
      formattedForPrompt: "",
      createdIds,
      skipped,
      modelCalls,
      proposedInAskNyaya: [],
      reviewedInAskNyaya: [],
      ...contractTelemetry(second),
      parentSummary: full?.analysis.summary ?? null,
    });
    return {
      answer: JSON.stringify(structured, null, 2),
      extras: {
        executionTarget: "professional_analysis",
        structuredKind: "analysis",
        structuredOutput: structured,
        documentIndex: documentIndexFor(matter),
        analysisEngine: "contract",
        modelCalls,
      },
    };
  }

  if (action.kind === "review_contract_item") {
    const doc = requireDoc(matter, action.documentPattern, action.kind);
    const analyzed = await analyzeContract({
      ...orgMatterUser,
      documentId: doc.nyayaDocumentId,
      documentVersionId: doc.nyayaVersionId,
      force: true,
    });
    modelCalls += analyzed.skipped ? 0 : 1;
    const analysisId = contractAnalysisId(analyzed);
    const before = await getContractAnalysis({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      analysisId,
    });
    const target = before?.items[0];
    if (target) {
      await reviewAnalysisItem({
        db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
        itemId: target.id,
        userId: matter.userId,
        action: action.reviewAction === "dismissed" ? "dismissed" : "reviewed",
      });
      createdIds.push(target.id);
    }
    const full = await getContractAnalysis({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      analysisId,
    });
    const context = await loadProfessionalAnalysisContext({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      limit: 12,
    });
    const structured = adaptAnalysisOutput({
      taskId: task.taskId,
      matter,
      actionKind: action.kind,
      engine: "contract",
      contract: full,
      depositionFindings: [],
      evidenceMatrix: [],
      formattedForPrompt: formatProfessionalAnalysisForPrompt(context),
      createdIds,
      skipped: false,
      modelCalls,
      proposedInAskNyaya: askNyayaLists(context).proposedInAskNyaya,
      reviewedInAskNyaya: askNyayaLists(context).reviewedInAskNyaya,
      ...contractTelemetry(analyzed),
      parentSummary: full?.analysis.summary ?? null,
    });
    return {
      answer: JSON.stringify(structured, null, 2),
      extras: {
        executionTarget: "professional_analysis",
        structuredKind: "analysis",
        structuredOutput: structured,
        documentIndex: documentIndexFor(matter),
        analysisEngine: "contract",
        modelCalls,
      },
    };
  }

  if (action.kind === "analyze_deposition") {
    const doc = requireDoc(matter, action.documentPattern, action.kind);
    const result = await analyzeDeposition({
      ...orgMatterUser,
      documentId: doc.nyayaDocumentId,
      documentVersionId: doc.nyayaVersionId,
      force: true,
    });
    modelCalls += result.skipped ? 0 : 1;
    skipped = result.skipped;
    const findings = await listFindings({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      runType: "deposition",
      includeSources: true,
    });
    const runFindings = findings.filter((row) => row.analysisRunId === result.run.id);
    createdIds.push(...runFindings.map((row) => row.id));
    const context = await loadProfessionalAnalysisContext({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      limit: 12,
    });
    const structured = adaptAnalysisOutput({
      taskId: task.taskId,
      matter,
      actionKind: action.kind,
      engine: "deposition",
      contract: null,
      depositionFindings: runFindings.map((row) => ({
        id: row.id,
        findingType: row.findingType,
        title: row.title,
        explanation: row.explanation,
        status: row.status,
        confidence: row.confidence,
        sources: row.sources ?? [],
      })),
      evidenceMatrix: [],
      formattedForPrompt: formatProfessionalAnalysisForPrompt(context),
      createdIds,
      skipped,
      modelCalls,
      proposedInAskNyaya: askNyayaLists(context).proposedInAskNyaya,
      reviewedInAskNyaya: askNyayaLists(context).reviewedInAskNyaya,
      rejectedMalformed: result.skipped ? 0 : result.rejectedMalformed,
      rejectedNoSource: result.skipped ? 0 : result.rejectedNoSource,
      normalizedCount: result.skipped ? 0 : result.normalizedCount,
      jsonParseFailed: result.skipped ? false : result.jsonParseFailed,
      parseRetryCount: result.skipped ? 0 : result.parseRetryCount,
    });
    return {
      answer: JSON.stringify(structured, null, 2),
      extras: {
        executionTarget: "professional_analysis",
        structuredKind: "analysis",
        structuredOutput: structured,
        documentIndex: documentIndexFor(matter),
        analysisEngine: "deposition",
        modelCalls,
        rejectedMalformed: result.skipped ? 0 : result.rejectedMalformed,
        rejectedNoSource: result.skipped ? 0 : result.rejectedNoSource,
        normalizedCount: result.skipped ? 0 : result.normalizedCount,
        jsonParseFailed: result.skipped ? false : result.jsonParseFailed,
        parseRetryCount: result.skipped ? 0 : result.parseRetryCount,
      },
    };
  }

  if (action.kind === "evidence_matrix") {
    if (task.category === "evidence") {
      return executeEvidenceMatrixTarget(params);
    }
    const evidence = await getEvidenceIntelligence({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
    });
    const structured = adaptAnalysisOutput({
      taskId: task.taskId,
      matter,
      actionKind: action.kind,
      engine: "evidence_matrix",
      contract: null,
      depositionFindings: [],
      evidenceMatrix: evidence.evidenceMatrix.issues,
      formattedForPrompt: "",
      createdIds: [],
      skipped: false,
      modelCalls: 0,
      proposedInAskNyaya: [],
      reviewedInAskNyaya: [],
    });
    return {
      answer: JSON.stringify(structured, null, 2),
      extras: {
        executionTarget: "professional_analysis",
        structuredKind: "analysis",
        structuredOutput: structured,
        documentIndex: documentIndexFor(matter),
        analysisEngine: "evidence_matrix",
        modelCalls: 0,
      },
    };
  }

  throw new Error(`Unsupported analysis action ${action.kind}`);
}
