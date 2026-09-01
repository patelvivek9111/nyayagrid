import { fold } from "./normalize";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";

export const EVIDENCE_MATRIX_GRADER_VERSION = "em1-2026-08-19";

export type EvidenceSpec = {
  profile: string;
  expectZeroIssues?: boolean;
  forbidProposedInMatrix?: boolean;
  forbidProposedContrary?: boolean;
  forbidDismissedInMatrix?: boolean;
  forbidRejectedInMatrix?: boolean;
  forbidAutoReview?: boolean;
  requireProvenanceFields?: boolean;
  requireQuoteOverlap?: boolean;
  forbidProvenContradiction?: boolean;
  forbidWrongDocumentAttribution?: boolean;
  forbidIndependentCorroborationIllusion?: boolean;
  forbiddenResolvedAsFactPhrases?: string[];
};

type EvidenceCitation = {
  kind?: string;
  id?: string;
  rationale?: string;
  documentId?: string | null;
  chunkId?: string | null;
  status?: string | null;
  trustClass?: string | null;
};

type EvidenceOutput = {
  issues: Array<{
    issueKey?: string;
    label?: string;
    supporting?: EvidenceCitation[];
    contrary?: EvidenceCitation[];
    gaps?: Array<{ rationale?: string }>;
  }>;
  snapshot: {
    proposedIdsInMatrix?: string[];
    dismissedIdsInMatrix?: string[];
    rejectedIdsInMatrix?: string[];
    citationsMissingDocumentId?: number;
    citationsMissingChunkId?: number;
    sameDocumentEventLinkedAsSupport?: number;
    autoReviewedProposed?: boolean;
    matrixIssueCount?: number;
    proposedContradictionCount?: number;
  };
};

function parseSpec(expectation: BenchExpectation): EvidenceSpec {
  const raw = expectation.notes.trim();
  if (!raw.startsWith("{")) return { profile: expectation.expectationType };
  try {
    return { ...(JSON.parse(raw) as EvidenceSpec), profile: JSON.parse(raw).profile ?? expectation.expectationType };
  } catch {
    return { profile: expectation.expectationType };
  }
}

function parseOutput(extras: Record<string, unknown> | undefined): EvidenceOutput | null {
  const raw = extras?.structuredOutput;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const issues = Array.isArray(rec.issues) ? rec.issues : [];
  const snapshot = (rec.snapshot as EvidenceOutput["snapshot"]) ?? {};
  return {
    issues: issues as EvidenceOutput["issues"],
    snapshot,
  };
}

function blob(output: EvidenceOutput): string {
  return fold(
    output.issues
      .map((issue) => {
        const cites = [...(issue.supporting ?? []), ...(issue.contrary ?? [])]
          .map((row) => `${row.kind ?? ""} ${row.rationale ?? ""}`)
          .join(" ");
        const gaps = (issue.gaps ?? []).map((row) => row.rationale ?? "").join(" ");
        return `${issue.issueKey ?? ""} ${issue.label ?? ""} ${cites} ${gaps}`;
      })
      .join("\n"),
  );
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
    graderVersion: EVIDENCE_MATRIX_GRADER_VERSION,
    graderKind: "evidence_matrix",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
    metrics: extras.metrics,
  };
}

export function gradeEvidenceMatrixAnswer(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
): GradeResult {
  const spec = parseSpec(expectation);
  const output = parseOutput(answer.extras);
  if (!output) {
    return result(expectation, "fail", "INFRASTRUCTURE: Structured evidence matrix output missing.", {
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
      checks: { structuredOutputPresent: false },
    });
  }

  const text = blob(output);
  const issueCount = output.issues.length;
  const proposedLeak = output.snapshot.proposedIdsInMatrix ?? [];
  const dismissedLeak = output.snapshot.dismissedIdsInMatrix ?? [];
  const rejectedLeak = output.snapshot.rejectedIdsInMatrix ?? [];
  const forbidden = (spec.forbiddenResolvedAsFactPhrases ?? []).filter((phrase) => text.includes(fold(phrase)));
  const citations = output.issues.flatMap((issue) => [...(issue.supporting ?? []), ...(issue.contrary ?? [])]);
  const missingDoc =
    (output.snapshot.citationsMissingDocumentId ?? citations.filter((row) => !row.documentId).length) > 0 &&
    citations.length > 0;
  const missingChunk =
    (output.snapshot.citationsMissingChunkId ?? citations.filter((row) => !row.chunkId).length) > 0 &&
    citations.length > 0;
  const quoteOverlapOk =
    issueCount === 0 ||
    output.issues.some((issue) => {
      const labelTokens = fold(issue.label ?? "")
        .split(/\s+/)
        .filter((tok) => tok.length >= 4);
      const span = fold(
        (issue.supporting ?? []).map((row) => row.rationale ?? "").join(" "),
      );
      return labelTokens.some((tok) => span.includes(tok));
    });
  const provenContradiction = /\bproven contradiction\b|\bestablished that both cannot\b|\bliar\b/.test(text);
  const documentIndex = Array.isArray(answer.extras?.documentIndex)
    ? (answer.extras?.documentIndex as Array<{ nyayaDocumentId?: string }>)
    : [];
  const knownDocs = new Set(documentIndex.map((row) => row.nyayaDocumentId).filter(Boolean));
  const wrongDoc = citations.some(
    (row) => Boolean(row.documentId) && knownDocs.size > 0 && !knownDocs.has(row.documentId ?? ""),
  );
  const corroborationIllusion = (output.snapshot.sameDocumentEventLinkedAsSupport ?? 0) > 0;
  const proposedContrary =
    spec.forbidProposedContrary &&
    output.issues.some((issue) =>
      (issue.contrary ?? []).some(
        (row) =>
          row.kind === "analysis_finding" &&
          (row.status === "proposed" ||
            row.trustClass === "proposed" ||
            (output.snapshot.proposedIdsInMatrix ?? []).includes(row.id ?? "")),
      ),
    );

  const checks = {
    structuredOutputPresent: true,
    zeroIssuesCorrect: !spec.expectZeroIssues || issueCount === 0,
    noProposedLeak: !spec.forbidProposedInMatrix || proposedLeak.length === 0,
    noProposedContrary: !spec.forbidProposedContrary || !proposedContrary,
    noDismissedLeak: !spec.forbidDismissedInMatrix || dismissedLeak.length === 0,
    noRejectedLeak: !spec.forbidRejectedInMatrix || rejectedLeak.length === 0,
    noAutoReview: !spec.forbidAutoReview || output.snapshot.autoReviewedProposed !== true,
    provenanceCorrect: !spec.requireProvenanceFields || (!missingDoc && !missingChunk),
    quoteOverlapCorrect: !spec.requireQuoteOverlap || quoteOverlapOk,
    noForbiddenResolvedFact: forbidden.length === 0,
    disputePreserved: !spec.forbidProvenContradiction || !provenContradiction,
    noWrongDocument: !spec.forbidWrongDocumentAttribution || !wrongDoc,
    noCorroborationIllusion:
      !spec.forbidIndependentCorroborationIllusion || !corroborationIllusion,
  };

  const extra: Partial<GradeResult> = {
    checks,
    metrics: {
      issueCount,
      proposedLeakCount: proposedLeak.length,
      dismissedLeakCount: dismissedLeak.length,
      rejectedLeakCount: rejectedLeak.length,
      citationsMissingDocumentId: output.snapshot.citationsMissingDocumentId ?? 0,
      citationsMissingChunkId: output.snapshot.citationsMissingChunkId ?? 0,
      sameDocumentEventLinkedAsSupport: output.snapshot.sameDocumentEventLinkedAsSupport ?? 0,
      modelCalls: typeof answer.extras?.modelCalls === "number" ? answer.extras.modelCalls : 0,
    },
  };

  if (spec.expectZeroIssues && issueCount > 0) {
    return result(expectation, "fail", "Evidence matrix emitted issues without verified established evidence.", {
      ...extra,
      failureTaxonomy: "unsupported-evidence",
      criticalFailure: true,
    });
  }
  if (spec.forbidProposedInMatrix && proposedLeak.length > 0) {
    return result(
      expectation,
      "fail",
      `Proposed intelligence appeared as matrix evidence: ${proposedLeak.slice(0, 8).join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "trust-boundary",
        criticalFailure: true,
      },
    );
  }
  if (spec.forbidProposedContrary && proposedContrary) {
    return result(
      expectation,
      "fail",
      "Proposed contradiction findings appeared as established contrary evidence.",
      {
        ...extra,
        failureTaxonomy: "trust-boundary",
        criticalFailure: true,
      },
    );
  }
  if (spec.forbidDismissedInMatrix && dismissedLeak.length > 0) {
    return result(expectation, "fail", "Dismissed intelligence remained in the evidence matrix.", {
      ...extra,
      failureTaxonomy: "status/review",
      criticalFailure: true,
    });
  }
  if (spec.forbidRejectedInMatrix && rejectedLeak.length > 0) {
    return result(expectation, "fail", "Rejected intelligence remained in the evidence matrix.", {
      ...extra,
      failureTaxonomy: "status/review",
      criticalFailure: true,
    });
  }
  if (forbidden.length > 0) {
    return result(
      expectation,
      "fail",
      `Unsupported or forbidden matrix assertion: ${forbidden.join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "unsupported-evidence",
        criticalFailure: true,
      },
    );
  }
  if (spec.requireProvenanceFields && (missingDoc || missingChunk)) {
    return result(
      expectation,
      "fail",
      "Matrix citations lack documentId and/or chunkId provenance.",
      {
        ...extra,
        failureTaxonomy: "provenance",
      },
    );
  }
  if (spec.requireQuoteOverlap && !quoteOverlapOk) {
    return result(expectation, "fail", "Supporting span does not overlap the matrix proposition.", {
      ...extra,
      failureTaxonomy: "provenance",
    });
  }
  if (spec.forbidProvenContradiction && provenContradiction) {
    return result(expectation, "fail", "Tension or dispute was presented as a proven contradiction.", {
      ...extra,
      failureTaxonomy: "contradiction/dispute collapse",
    });
  }
  if (spec.forbidWrongDocumentAttribution && wrongDoc) {
    return result(expectation, "fail", "Matrix citation documentId is not a matter document.", {
      ...extra,
      failureTaxonomy: "wrong source association",
      criticalFailure: true,
    });
  }
  if (spec.forbidIndependentCorroborationIllusion && corroborationIllusion) {
    return result(
      expectation,
      "needs_work",
      "Same-document timeline events were attached as extra supporting corroboration for a fact.",
      {
        ...extra,
        failureTaxonomy: "duplicate evidence",
      },
    );
  }
  if (spec.forbidAutoReview && output.snapshot.autoReviewedProposed === true) {
    return result(expectation, "fail", "Evidence matrix auto-reviewed proposed intelligence.", {
      ...extra,
      failureTaxonomy: "status/review",
      criticalFailure: true,
    });
  }

  return result(expectation, "pass", "Structured evidence matrix matched the hidden expectation.", extra);
}
