import type { AIProvider } from "@nyayagrid/ai";
import type { Database } from "@nyayagrid/database";
import {
  analyzeContract,
  analyzeDeposition,
  detectContradictionCandidates,
  extractMatterIntelligenceForReadyDocuments,
  getContractAnalysis,
  getEvidenceIntelligence,
  listContractAnalyses,
  listFindings,
  listProposedIntelligence,
  listTimelineEvents,
  markDocumentImportant,
  reviewAnalysisItem,
  reviewFinding,
  reviewMatterFact,
  reviewTimelineEvent,
} from "@nyayagrid/intelligence";
import type { AnalysisBenchAction, BenchScenario, BenchTask } from "./catalog";
import type { IngestedMatter } from "./ingest";
import { documentIndexFor } from "./adapt-structured";

function findDoc(matter: IngestedMatter, pattern: string) {
  const re = new RegExp(pattern, "i");
  return matter.documents.find((doc) => re.test(doc.filename) || re.test(doc.title));
}

export type CanonicalEvidenceCitation = {
  kind: string;
  id: string;
  rationale: string;
  documentId: string | null;
  documentVersionId: string | null;
  chunkId: string | null;
  trustClass: string | null;
  status: string | null;
};

export type CanonicalEvidenceOutput = {
  taskId: string;
  actionKind: string;
  engine: "evidence_matrix";
  issues: Array<{
    issueKey: string;
    label: string;
    supporting: CanonicalEvidenceCitation[];
    contrary: CanonicalEvidenceCitation[];
    gaps: Array<{ rationale: string }>;
  }>;
  snapshot: {
    proposedTimelineCount: number;
    approvedTimelineCount: number;
    rejectedTimelineCount: number;
    proposedFactCount: number;
    approvedFactCount: number;
    rejectedFactCount: number;
    proposedAnalysisCount: number;
    reviewedAnalysisCount: number;
    dismissedAnalysisCount: number;
    proposedContradictionCount: number;
    reviewedContradictionCount: number;
    dismissedContradictionCount: number;
    matrixIssueCount: number;
    proposedIdsInMatrix: string[];
    dismissedIdsInMatrix: string[];
    rejectedIdsInMatrix: string[];
    citationsMissingDocumentId: number;
    citationsMissingChunkId: number;
    sameDocumentEventLinkedAsSupport: number;
    autoReviewedProposed: boolean;
  };
  modelCalls: number;
};

function asCitation(row: { kind: string; id: string; rationale: string }): CanonicalEvidenceCitation {
  const rec = row as CanonicalEvidenceCitation;
  return {
    kind: row.kind,
    id: row.id,
    rationale: row.rationale,
    documentId: rec.documentId ?? null,
    documentVersionId: rec.documentVersionId ?? null,
    chunkId: rec.chunkId ?? null,
    trustClass: rec.trustClass ?? null,
    status: rec.status ?? null,
  };
}

export async function executeEvidenceMatrixTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const { db, matter, task, ai } = params;
  const action: AnalysisBenchAction = task.analysisAction ?? { kind: "evidence_matrix" };
  const org = {
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
  };
  let modelCalls = 0;

  if (action.extractIntelligence) {
    await extractMatterIntelligenceForReadyDocuments({
      ...org,
      ai,
    });
    modelCalls += 1;
  }

  if (action.analyzeDeposition) {
    const doc = findDoc(matter, action.documentPattern ?? "05_Deposition_Mercer");
    if (!doc) throw new Error("No deposition document for evidence matrix setup");
    const result = await analyzeDeposition({
      ...org,
      documentId: doc.nyayaDocumentId,
      documentVersionId: doc.nyayaVersionId,
      ai,
      force: true,
    });
    if (!result.skipped) modelCalls += 1;
  }

  if (action.analyzeContract) {
    const doc = findDoc(matter, action.documentPattern ?? "01_Main_Agreement");
    if (!doc) throw new Error("No contract document for evidence matrix setup");
    const result = await analyzeContract({
      ...org,
      documentId: doc.nyayaDocumentId,
      documentVersionId: doc.nyayaVersionId,
      ai,
      force: true,
    });
    if (!result.skipped) modelCalls += 1;
    if (action.reviewAction) {
      const analyses = await listContractAnalyses({
        db,
        organizationId: matter.organizationId,
        matterId: matter.matterId,
        documentId: doc.nyayaDocumentId,
      });
      const analysisId = analyses[0]?.id;
      if (analysisId) {
        const full = await getContractAnalysis({
          db,
          organizationId: matter.organizationId,
          matterId: matter.matterId,
          analysisId,
        });
        const item = full?.items[0];
        if (item) {
          await reviewAnalysisItem({
            ...org,
            itemId: item.id,
            action: action.reviewAction,
          });
        }
      }
    }
  }

  if (action.detectContradictions) {
    const result = await detectContradictionCandidates({
      ...org,
      ai,
      force: true,
    });
    if (!result.skipped) modelCalls += 1;
  }

  if (action.reviewContradiction) {
    const findings = await listFindings({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      runType: "contradiction",
    });
    for (const finding of findings) {
      if (finding.status === "proposed" || finding.status === "reviewed") {
        await reviewFinding({
          ...org,
          findingId: finding.id,
          action: action.reviewContradiction,
        });
      }
    }
  }

  if (action.rejectTimeline) {
    const events = await listTimelineEvents({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      status: "proposed",
    });
    for (const event of events) {
      await reviewTimelineEvent({
        ...org,
        eventId: event.id,
        action: "reject",
        rejectionReason: "Bench overlay rejected proposed timeline for evidence-matrix trust test.",
      });
    }
  }

  if (action.rejectFacts) {
    const proposed = await listProposedIntelligence({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
    });
    for (const fact of proposed.facts) {
      await reviewMatterFact({
        ...org,
        factId: fact.id,
        action: "reject",
        rejectionReason: "Bench overlay rejected proposed fact for evidence-matrix trust test.",
      });
    }
  }

  if (action.approveFacts) {
    const proposed = await listProposedIntelligence({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
    });
    for (const fact of proposed.facts) {
      try {
        await reviewMatterFact({
          ...org,
          factId: fact.id,
          action: "approve",
        });
      } catch {
        // unsourced facts cannot be approved; leave proposed
      }
    }
  }

  if (action.approveTimeline) {
    const events = await listTimelineEvents({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      status: "proposed",
    });
    for (const event of events) {
      try {
        await reviewTimelineEvent({
          ...org,
          eventId: event.id,
          action: "approve",
        });
      } catch {
        // unsourced events cannot be approved
      }
    }
  }

  if (action.markImportantPattern) {
    const doc = findDoc(matter, action.markImportantPattern);
    if (doc) {
      await markDocumentImportant({
        ...org,
        documentId: doc.nyayaDocumentId,
        important: true,
      });
    }
  }

  const beforeProposedEvents = await listTimelineEvents({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    status: "proposed",
  });
  const beforeProposedIntel = await listProposedIntelligence({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
  });
  const calledStatusMutation = Boolean(
    action.approveTimeline ||
      action.approveFacts ||
      action.rejectTimeline ||
      action.rejectFacts ||
      action.reviewContradiction ||
      action.reviewAction,
  );

  const evidence = await getEvidenceIntelligence({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
  });

  const proposedEvents = await listTimelineEvents({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    status: "proposed",
  });
  const approvedEvents = await listTimelineEvents({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    status: ["approved", "edited_and_approved"],
  });
  const rejectedEvents = await listTimelineEvents({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    status: "rejected",
  });
  const proposedIntel = await listProposedIntelligence({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
  });
  const allFindings = await listFindings({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    includeSources: true,
  });
  const contractAnalyses = await listContractAnalyses({
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
  });
  let proposedAnalysis = 0;
  let reviewedAnalysis = 0;
  let dismissedAnalysis = 0;
  for (const row of contractAnalyses) {
    const full = await getContractAnalysis({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      analysisId: row.id,
    });
    for (const item of full?.items ?? []) {
      if (item.status === "proposed") proposedAnalysis += 1;
      if (item.status === "reviewed") reviewedAnalysis += 1;
      if (item.status === "dismissed") dismissedAnalysis += 1;
    }
  }
  const contradiction = allFindings.filter((row) => {
    const runType = row.run?.runType ?? "";
    const type = `${row.findingType ?? ""}`.toLowerCase();
    return runType === "contradiction" || type.includes("contradiction") || type.includes("tension");
  });
  const depositionOrContractFindings = allFindings.filter((row) => {
    const runType = row.run?.runType ?? "";
    return runType === "deposition";
  });
  for (const finding of depositionOrContractFindings) {
    if (finding.status === "proposed") proposedAnalysis += 1;
    if (finding.status === "reviewed") reviewedAnalysis += 1;
    if (finding.status === "dismissed") dismissedAnalysis += 1;
  }

  const proposedContradictionIds = contradiction
    .filter((row) => row.status === "proposed")
    .map((row) => row.id);
  const dismissedIds = [
    ...allFindings.filter((row) => row.status === "dismissed").map((row) => row.id),
    ...contradiction.filter((row) => row.status === "dismissed").map((row) => row.id),
  ];
  const proposedIds = new Set<string>([
    ...proposedEvents.map((row) => row.id),
    ...proposedIntel.facts.map((row) => row.id),
    ...allFindings.filter((row) => row.status === "proposed").map((row) => row.id),
  ]);
  const rejectedIds = new Set(rejectedEvents.map((row) => row.id));
  const dismissedSet = new Set(dismissedIds);

  const issues = evidence.evidenceMatrix.issues.map((issue) => ({
    issueKey: issue.issueKey,
    label: issue.label,
    supporting: issue.supporting.map(asCitation),
    contrary: issue.contrary.map(asCitation),
    gaps: issue.gaps,
  }));
  const matrixIds = issues.flatMap((issue) => [
    ...issue.supporting.map((row) => row.id),
    ...issue.contrary.map((row) => row.id),
  ]);
  const citations = issues.flatMap((issue) => [...issue.supporting, ...issue.contrary]);
  const sameDocumentEventLinkedAsSupport = issues.filter(
    (issue) =>
      issue.supporting.some((row) => row.kind === "timeline_event") &&
      issue.supporting.some((row) => row.kind === "fact_source"),
  ).length;

  const structured: CanonicalEvidenceOutput = {
    taskId: task.taskId,
    actionKind: action.kind,
    engine: "evidence_matrix",
    issues,
    snapshot: {
      proposedTimelineCount: proposedEvents.length,
      approvedTimelineCount: approvedEvents.length,
      rejectedTimelineCount: rejectedEvents.length,
      proposedFactCount: proposedIntel.facts.length,
      approvedFactCount: evidence.evidenceMatrix.issues.filter(
        (issue) => !issue.issueKey.startsWith("event:"),
      ).length,
      rejectedFactCount: 0,
      proposedAnalysisCount: proposedAnalysis,
      reviewedAnalysisCount: reviewedAnalysis,
      dismissedAnalysisCount: dismissedAnalysis,
      proposedContradictionCount: proposedContradictionIds.length,
      reviewedContradictionCount: contradiction.filter((row) => row.status === "reviewed").length,
      dismissedContradictionCount: contradiction.filter((row) => row.status === "dismissed").length,
      matrixIssueCount: issues.length,
      proposedIdsInMatrix: matrixIds.filter((id) => proposedIds.has(id)),
      dismissedIdsInMatrix: matrixIds.filter((id) => dismissedSet.has(id)),
      rejectedIdsInMatrix: matrixIds.filter((id) => rejectedIds.has(id)),
      citationsMissingDocumentId: citations.filter((row) => !row.documentId).length,
      citationsMissingChunkId: citations.filter((row) => !row.chunkId).length,
      sameDocumentEventLinkedAsSupport,
      autoReviewedProposed:
        !calledStatusMutation &&
        (proposedEvents.length < beforeProposedEvents.length ||
          proposedIntel.facts.length < beforeProposedIntel.facts.length) &&
        (approvedEvents.length > 0 ||
          evidence.evidenceMatrix.issues.filter((issue) => !issue.issueKey.startsWith("event:"))
            .length > 0),
    },
    modelCalls,
  };

  return {
    answer: JSON.stringify(structured, null, 2),
    extras: {
      executionTarget: "professional_analysis",
      structuredKind: "evidence_matrix",
      structuredOutput: structured,
      documentIndex: documentIndexFor(matter),
      analysisEngine: "evidence_matrix",
      modelCalls,
    },
  };
}
