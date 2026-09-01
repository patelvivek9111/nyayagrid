import type { AIProvider } from "@nyayagrid/ai";
import type { Database } from "@nyayagrid/database";
import {
  compareDocuments,
  detectContradictionCandidates,
  extractMatterIntelligenceForReadyDocuments,
  listFindings,
  listTimelineEvents,
} from "@nyayagrid/intelligence";
import type { BenchScenario, BenchTask } from "./catalog";
import type { IngestedMatter } from "./ingest";
import type { ExecutionTarget } from "./routing";
import { adaptCompareOutput, adaptContradictionOutput, adaptTimelineOutput, documentIndexFor } from "./adapt-structured";
import { executeAnalysisTarget } from "./execute-analysis";
import { executeDraftTarget } from "./execute-draft";
import { executeGraphTarget } from "./execute-graph";
import { executeResearchTarget } from "./execute-research";
import { executeAgentTarget } from "./execute-agents";
import { executeFullSystemTarget } from "./execute-full-system";
import { executeMemoryTarget } from "./execute-memory";

function findDoc(matter: IngestedMatter, pattern: RegExp) {
  return matter.documents.find((doc) => pattern.test(doc.filename) || pattern.test(doc.documentId));
}

function asText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export async function executeSubsystemTarget(params: {
  db: Database;
  scenario: BenchScenario;
  task: BenchTask;
  matter: IngestedMatter;
  target: ExecutionTarget;
  ai: AIProvider;
}): Promise<{ answer: string; extras: Record<string, unknown> }> {
  const { db, matter, task, scenario, target, ai } = params;
  const orgMatterUser = {
    db,
    organizationId: matter.organizationId,
    matterId: matter.matterId,
    userId: matter.userId,
    ai,
  };

  if (target === "contract_compare") {
    const original =
      findDoc(matter, /lease|main.?agreement|01_|msa|agreement|note\.pdf/i) ?? matter.documents[0];
    const amendment =
      findDoc(matter, /amendment1|amendment_1|02_|addendum|modification/i) ?? matter.documents[1];
    if (!original || !amendment) {
      throw new Error("Contract compare requires two ingested document versions");
    }
    const comparison = await compareDocuments({
      ...orgMatterUser,
      documentAId: original.nyayaDocumentId,
      versionAId: original.nyayaVersionId,
      documentBId: amendment.nyayaDocumentId,
      versionBId: amendment.nyayaVersionId,
      includeAiSummary: true,
    });
    const structured = adaptCompareOutput({
      taskId: task.taskId,
      matter,
      comparison: comparison.comparison,
      changes: comparison.changes,
      leftFilename: original.filename,
      rightFilename: amendment.filename,
      summaryAlignment: comparison.summaryScore.alignment,
      summaryUnsupportedClaimCount: comparison.summaryScore.unsupportedClaims.length,
    });
    return {
      answer: asText(structured),
      extras: {
        executionTarget: target,
        structuredKind: "compare",
        structuredOutput: structured,
        documentIndex: documentIndexFor(matter),
        comparisonId: comparison.comparison.id,
        comparisonSummary: comparison.comparison.summary,
        comparisonChangeCount: comparison.changes.length,
      },
    };
  }

  if (target === "contradiction") {
    const detected = await detectContradictionCandidates({ ...orgMatterUser, force: true });
    const withSources = await listFindings({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      runType: "contradiction",
      includeSources: true,
      includeTimelineLinks: false,
    });
    const runFindings = withSources.filter((row) => row.analysisRunId === detected.run.id);
    const structured = adaptContradictionOutput({
      taskId: task.taskId,
      matter,
      findings: runFindings,
    });
    return {
      answer: asText(structured),
      extras: {
        executionTarget: target,
        structuredKind: "contradiction",
        structuredOutput: structured,
        documentIndex: documentIndexFor(matter),
        contradictionFindingCount: structured.findings.length,
        contradictionRunId: detected.run.id,
      },
    };
  }

  if (target === "timeline") {
    await extractMatterIntelligenceForReadyDocuments(orgMatterUser);
    const events = await listTimelineEvents({
      db,
      organizationId: matter.organizationId,
      matterId: matter.matterId,
      status: ["proposed", "approved", "edited_and_approved"],
      includeSources: true,
    });
    const structured = adaptTimelineOutput({
      taskId: task.taskId,
      matter,
      events,
    });
    return {
      answer: asText(structured),
      extras: {
        executionTarget: target,
        structuredKind: "timeline",
        structuredOutput: structured,
        documentIndex: documentIndexFor(matter),
        timelineEventCount: structured.events.length,
      },
    };
  }

  if (target === "graph") {
    return executeGraphTarget({ db, scenario, task, matter, ai });
  }

  if (target === "memory") {
    return executeMemoryTarget({ db, scenario, task, matter, ai });
  }

  if (target === "professional_analysis") {
    return executeAnalysisTarget({ db, scenario, task, matter, ai });
  }

  if (target === "research") {
    return executeResearchTarget({ db, scenario, task, matter, ai });
  }

  if (target === "draft") {
    return executeDraftTarget({ db, scenario, task, matter, ai });
  }

  if (target === "analysis") {
    throw new Error(
      "executionTarget=analysis is not a single production engine. Use compare, contradiction, contract-analysis, or deposition-analysis. This phase scores only compare and contradiction.",
    );
  }

  if (target === "agent") {
    return executeAgentTarget({ db, scenario, task, matter, ai });
  }

  if (target === "full_system") {
    return executeFullSystemTarget({ db, scenario, task, matter, ai });
  }

  throw new Error(`No subsystem executor for target ${target}`);
}
