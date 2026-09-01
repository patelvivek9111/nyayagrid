import { fold } from "./normalize";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";

export const DRAFT_GRADER_VERSION = "d1-2026-08-19";

export type DraftSpec = {
  profile: string;
  requiredNeedles?: string[];
  requireNeedlesAny?: string[][];
  forbiddenResolvedAsFactPhrases?: string[];
  requireAssertionsWithChunks?: boolean;
  requireQuoteFidelity?: boolean;
  forbidWrongDocumentAttribution?: boolean;
  requireAssertionBodyAgreement?: boolean;
  forbidProposedTimelineInVerifiedContext?: boolean;
  forbidProposedMemoryInPrompt?: boolean;
  forbidAnalysisConsumed?: boolean;
  forbidProposedGraphInVerifiedContext?: boolean;
  requirePriorVersionRetained?: boolean;
  requireRevisionPreservesNumbers?: boolean;
};

type DraftOutput = {
  content?: string;
  assumptions?: string[];
  assertions?: Array<{ text?: string; chunkIds?: string[]; documentIds?: string[] }>;
  snapshot?: {
    verifiedHasProposedMarker?: boolean;
    proposedMemoryTitleInPrompt?: boolean;
    analysisConsumed?: boolean;
    proposedGraphEdgeCount?: number;
    verifiedGraphEdgeCount?: number;
    quotesUnsupported?: number;
    quoteCount?: number;
    assertionBodyAgreement?: number;
    citationsMissingDocumentId?: number;
    wrongDocument?: boolean;
    priorVersionRetained?: boolean;
    revisionDroppedV1Number?: boolean;
    autoReviewedProposed?: boolean;
  };
};

function parseSpec(expectation: BenchExpectation): DraftSpec {
  const raw = expectation.notes.trim();
  if (!raw.startsWith("{")) return { profile: expectation.expectationType };
  try {
    const parsed = JSON.parse(raw) as DraftSpec;
    return { ...parsed, profile: parsed.profile ?? expectation.expectationType };
  } catch {
    return { profile: expectation.expectationType };
  }
}

function parseOutput(extras: Record<string, unknown> | undefined): DraftOutput | null {
  const raw = extras?.structuredOutput;
  if (!raw || typeof raw !== "object") return null;
  return raw as DraftOutput;
}

function result(
  expectation: BenchExpectation,
  verdict: BenchVerdict,
  detail: string,
  extras: Partial<GradeResult>,
): GradeResult {
  return {
    taskId: expectation.taskId,
    verdict,
    expectationType: extras.expectationType ?? expectation.expectationType,
    severity: extras.criticalFailure ? "critical" : expectation.severity,
    detail,
    needlesRequired: extras.needlesRequired ?? [],
    needlesFound: extras.needlesFound ?? [],
    graderVersion: DRAFT_GRADER_VERSION,
    graderKind: "draft",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
    metrics: extras.metrics,
  };
}

export function gradeDraftAnswer(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
): GradeResult {
  const spec = parseSpec(expectation);
  const output = parseOutput(answer.extras);
  if (!output?.content) {
    return result(expectation, "fail", "INFRASTRUCTURE: Structured draft output missing.", {
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
      checks: { structuredOutputPresent: false },
    });
  }

  const text = fold(`${output.content}\n${(output.assumptions ?? []).join("\n")}`);
  const forbidden = (spec.forbiddenResolvedAsFactPhrases ?? []).filter((phrase) =>
    text.includes(fold(phrase)),
  );
  const needles = spec.requiredNeedles ?? [];
  const needlesFound = needles.filter((needle) => text.includes(fold(needle)));
  const anyGroups = spec.requireNeedlesAny ?? [];
  const anyOk =
    anyGroups.length === 0 ||
    anyGroups.every((group) => group.some((needle) => text.includes(fold(needle))));
  const snapshot = output.snapshot ?? {};
  const assertions = output.assertions ?? [];

  const checks = {
    structuredOutputPresent: true,
    noForbiddenResolvedFact: forbidden.length === 0,
    requiredNeedlesPresent: needles.length === 0 || needlesFound.length === needles.length,
    requireNeedlesAny: anyOk,
    provenanceCorrect:
      !spec.requireAssertionsWithChunks ||
      (assertions.length > 0 && assertions.every((row) => (row.chunkIds ?? []).length > 0)),
    quoteFidelity: !spec.requireQuoteFidelity || (snapshot.quotesUnsupported ?? 0) === 0,
    noWrongDocument: !spec.forbidWrongDocumentAttribution || snapshot.wrongDocument !== true,
    assertionBodyAgreement:
      !spec.requireAssertionBodyAgreement || (snapshot.assertionBodyAgreement ?? 1) >= 0.5,
    noProposedTimeline:
      !spec.forbidProposedTimelineInVerifiedContext || snapshot.verifiedHasProposedMarker !== true,
    noProposedMemory: !spec.forbidProposedMemoryInPrompt || snapshot.proposedMemoryTitleInPrompt !== true,
    analysisIsolated: !spec.forbidAnalysisConsumed || snapshot.analysisConsumed !== true,
    noProposedGraph:
      !spec.forbidProposedGraphInVerifiedContext ||
      (snapshot.verifiedGraphEdgeCount ?? 0) === 0 ||
      (snapshot.proposedGraphEdgeCount ?? 0) >= 0,
    priorVersionRetained: !spec.requirePriorVersionRetained || snapshot.priorVersionRetained === true,
    revisionPreservesNumbers:
      !spec.requireRevisionPreservesNumbers || snapshot.revisionDroppedV1Number !== true,
  };

  const extra: Partial<GradeResult> = {
    checks,
    needlesRequired: needles,
    needlesFound,
    metrics: {
      quoteCount: snapshot.quoteCount ?? 0,
      quotesUnsupported: snapshot.quotesUnsupported ?? 0,
      assertionCount: assertions.length,
      modelCalls: typeof answer.extras?.modelCalls === "number" ? answer.extras.modelCalls : 0,
    },
  };

  if (forbidden.length > 0) {
    return result(
      expectation,
      "fail",
      `Unsupported or forbidden draft assertion: ${forbidden.join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "unsupported assertion",
        criticalFailure: expectation.severity === "critical",
      },
    );
  }
  if (!checks.requiredNeedlesPresent || !anyOk) {
    return result(expectation, "needs_work", "Draft omitted required sourced numeric or term content.", {
      ...extra,
      failureTaxonomy: "numeric",
    });
  }
  if (spec.requireAssertionsWithChunks && !checks.provenanceCorrect) {
    return result(expectation, "fail", "Draft assertions lack source chunkIds.", {
      ...extra,
      failureTaxonomy: "provenance",
    });
  }
  if (spec.requireQuoteFidelity && !checks.quoteFidelity) {
    return result(expectation, "fail", "Quoted text is not present in cited source chunks.", {
      ...extra,
      failureTaxonomy: "citation",
      criticalFailure: true,
    });
  }
  if (spec.forbidWrongDocumentAttribution && snapshot.wrongDocument) {
    return result(expectation, "fail", "Draft assertion cites a document that is not in the matter.", {
      ...extra,
      failureTaxonomy: "provenance",
      criticalFailure: true,
    });
  }
  if (spec.requireAssertionBodyAgreement && !checks.assertionBodyAgreement) {
    return result(expectation, "needs_work", "Stored assertions do not agree with the draft body.", {
      ...extra,
      failureTaxonomy: "citation",
    });
  }
  if (spec.forbidProposedTimelineInVerifiedContext && snapshot.verifiedHasProposedMarker) {
    return result(expectation, "fail", "Proposed timeline leaked into verified draft context.", {
      ...extra,
      failureTaxonomy: "context trust",
      criticalFailure: true,
    });
  }
  if (spec.forbidProposedMemoryInPrompt && snapshot.proposedMemoryTitleInPrompt) {
    return result(expectation, "fail", "Proposed memory entered the draft prompt.", {
      ...extra,
      failureTaxonomy: "context trust",
      criticalFailure: true,
    });
  }
  if (spec.forbidAnalysisConsumed && snapshot.analysisConsumed) {
    return result(expectation, "fail", "Draft consumed Analysis as established fact.", {
      ...extra,
      failureTaxonomy: "context trust",
      criticalFailure: true,
    });
  }
  if (spec.requirePriorVersionRetained && !snapshot.priorVersionRetained) {
    return result(expectation, "fail", "Manual edit overwrote the prior draft version.", {
      ...extra,
      failureTaxonomy: "versioning",
    });
  }
  if (spec.requireRevisionPreservesNumbers && snapshot.revisionDroppedV1Number) {
    return result(expectation, "needs_work", "Regenerate dropped numeric tokens present in version 1.", {
      ...extra,
      failureTaxonomy: "numeric",
    });
  }

  return result(expectation, "pass", "Structured draft matched the hidden expectation.", extra);
}
