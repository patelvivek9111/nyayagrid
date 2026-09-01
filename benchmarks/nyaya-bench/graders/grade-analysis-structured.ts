import { fold } from "./normalize";
import { infersPhysicalActorFromSystemActivity } from "./semantic-map";
import {
  ANALYSIS_STRUCTURED_GRADER_VERSION,
  parseAnalysisOutput,
  type CanonicalAnalysisFinding,
  type CanonicalAnalysisOutput,
} from "./structured-schemas";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";

export type AnalysisSpec = {
  profile: string;
  engine?: string;
  expectedStatus?: string[];
  requiredPhrases?: string[];
  forbiddenPhrases?: string[];
  forbiddenResolvedAsFactPhrases?: string[];
  requireSourceChunks?: boolean;
  expectSkipped?: boolean;
  mustEnterReviewedContext?: boolean;
  mustNotEnterReviewedContext?: boolean;
  treatAsCriticalIfReviewedLeak?: boolean;
  flagProposedInAskNyaya?: boolean;
  mustNotAppearAsReviewed?: boolean;
  forbidFabricatedMatrixIssues?: boolean;
  expectZeroFindings?: boolean;
  requireQuotePhrases?: string[];
  forbidUnrelatedPhrases?: string[];
  requireAttributionPhrases?: string[];
  requireUncertaintyPhrases?: string[];
  expectTension?: boolean;
  forbidContradictionClass?: boolean;
  summaryMustNotDenyItems?: boolean;
  forbidHeaderSpanPhrases?: string[];
  requireLimitationPhrases?: string[];
  decoyHighAttentionPhrases?: string[];
  maxCreatedCount?: number;
};

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
    graderVersion: ANALYSIS_STRUCTURED_GRADER_VERSION,
    graderKind: "analysis",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
    metrics: extras.metrics,
  };
}

export function parseAnalysisSpec(expectation: BenchExpectation): AnalysisSpec {
  const raw = expectation.notes.trim();
  if (!raw.startsWith("{")) return { profile: expectation.expectationType };
  try {
    const parsed = JSON.parse(raw) as AnalysisSpec;
    return { ...parsed, profile: parsed.profile || expectation.expectationType };
  } catch {
    return { profile: expectation.expectationType };
  }
}

function blob(findings: CanonicalAnalysisFinding[]): string {
  return fold(
    findings.map((row) => `${row.findingType} ${row.proposition} ${row.supportingText}`).join("\n"),
  );
}

function containsAny(haystack: string, phrases: string[]): string[] {
  return phrases.filter((phrase) => haystack.includes(fold(phrase)));
}

function subjectFindings(output: CanonicalAnalysisOutput): CanonicalAnalysisFinding[] {
  const ids = new Set(output.createdIds);
  const created = output.findings.filter((row) => row.createdThisAction || ids.has(row.findingId));
  return created.length > 0 ? created : output.findings;
}

function proposedCountFromPrompt(formatted: string): number {
  const matches = [...formatted.matchAll(/proposedItems=(\d+)/g)];
  return matches.reduce((sum, match) => sum + Number(match[1] ?? 0), 0);
}

function reviewedLines(formatted: string): string {
  return formatted
    .split("\n")
    .filter((line) => /\[REVIEWED\]/.test(line))
    .join("\n");
}

export function gradeAnalysisAnswer(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
): GradeResult {
  const spec = parseAnalysisSpec(expectation);
  const output = parseAnalysisOutput(answer.extras);
  if (!output) {
    return result(
      expectation,
      "fail",
      "INFRASTRUCTURE: Structured analysis output missing after persistence.",
      {
        failureTaxonomy: "infrastructure",
        criticalFailure: true,
        checks: { structuredOutputPresent: false },
      },
    );
  }

  const subject = subjectFindings(output);
  const subjectBlob = blob(subject);
  const formatted = output.formattedForPrompt;
  const formattedFold = fold(formatted);
  const required = spec.requiredPhrases ?? [];
  const foundRequired = containsAny(subjectBlob, required);
  const forbidden = containsAny(`${subjectBlob}\n${formattedFold}`, spec.forbiddenPhrases ?? []);
  const forbiddenResolved = containsAny(
    fold(`${formatted}\n${subjectBlob}`),
    spec.forbiddenResolvedAsFactPhrases ?? [],
  );
  const provenanceMissing =
    Boolean(spec.requireSourceChunks) && subject.some((row) => row.sourceChunkIds.length === 0);
  const statusOk =
    !spec.expectedStatus?.length ||
    subject.every((row) => spec.expectedStatus!.includes(row.status));
  const skippedOk = !spec.expectSkipped || output.skipped;
  const reviewedTitles = output.reviewedInAskNyaya.map((title) => fold(title));
  const subjectTitles = subject.map((row) => fold(row.proposition));
  const enteredReviewed =
    subject.some((row) =>
      reviewedTitles.some((title) => title && fold(row.proposition).includes(title)),
    ) ||
    subjectTitles.some(
      (title) =>
        title &&
        reviewedTitles.some((reviewed) => reviewed.includes(title) || title.includes(reviewed)),
    );
  const reviewedLeak = Boolean(spec.mustNotEnterReviewedContext && enteredReviewed);
  const missingReviewed = Boolean(spec.mustEnterReviewedContext && !enteredReviewed);
  const proposedCount = proposedCountFromPrompt(formatted);
  const proposedLabeled = /\[PROPOSED\/UNREVIEWED\]/.test(formatted);
  const proposedEntered =
    output.proposedInAskNyaya.length > 0 || proposedLabeled || proposedCount > 0;
  const unlabeledContractSummary =
    /Reviewed\/available contract analyses:/i.test(formatted) && proposedCount > 0;
  const proposedAsReviewed = containsAny(
    fold(reviewedLines(formatted)),
    output.proposedInAskNyaya.length ? output.proposedInAskNyaya : required,
  );
  const quoteBlob = fold(subject.map((row) => row.supportingText).join("\n"));
  const typeBlob = fold(subject.map((row) => row.findingType).join("\n"));
  const quoteHits = containsAny(quoteBlob, spec.requireQuotePhrases ?? []);
  const quoteMissing =
    (spec.requireQuotePhrases?.length ?? 0) > 0 && (subject.length === 0 || quoteHits.length === 0);
  const unrelatedHits = containsAny(subjectBlob, spec.forbidUnrelatedPhrases ?? []);
  const attributionHits = containsAny(subjectBlob, spec.requireAttributionPhrases ?? []);
  const attributionMissing =
    (spec.requireAttributionPhrases?.length ?? 0) > 0 &&
    subject.length > 0 &&
    attributionHits.length === 0;
  const uncertaintyHits = containsAny(subjectBlob, spec.requireUncertaintyPhrases ?? []);
  const uncertaintyMissing =
    (spec.requireUncertaintyPhrases?.length ?? 0) > 0 &&
    subject.length > 0 &&
    uncertaintyHits.length === 0;
  const contradictionClass =
    /\bcontradiction\b/.test(typeBlob) ||
    /\binconsistency\b/.test(typeBlob) ||
    (/\bdirect contradiction\b/.test(subjectBlob) &&
      !/\bnot (a )?(direct )?contradiction\b/.test(subjectBlob));
  const tensionPresent =
    /\btension\b/.test(subjectBlob) ||
    /\bcan coexist\b/.test(subjectBlob) ||
    /\bdoes not independently\b/.test(subjectBlob);
  const zeroFindingViolation = Boolean(spec.expectZeroFindings) && subject.length > 0;
  const tensionMissing = Boolean(spec.expectTension) && !tensionPresent;
  const contradictionWhenForbidden = Boolean(spec.forbidContradictionClass) && contradictionClass;
  const limitationHits = containsAny(subjectBlob, spec.requireLimitationPhrases ?? []);
  const limitationMissing =
    (spec.requireLimitationPhrases?.length ?? 0) > 0 &&
    subject.length > 0 &&
    limitationHits.length === 0;
  const headerSpanBad =
    (spec.forbidHeaderSpanPhrases?.length ?? 0) > 0 &&
    subject.some((row) => {
      const span = fold(row.supportingText);
      const headerHits = containsAny(span, spec.forbidHeaderSpanPhrases ?? []);
      if (headerHits.length === 0) return false;
      const quoteOk =
        (spec.requireQuotePhrases?.length ?? 0) === 0 ||
        containsAny(span, spec.requireQuotePhrases ?? []).length > 0;
      return !quoteOk;
    });
  const decoyHighAttention = (spec.decoyHighAttentionPhrases ?? []).length
    ? subject.some(
        (row) =>
          row.attention === "high_attention" &&
          containsAny(fold(`${row.proposition} ${row.supportingText}`), spec.decoyHighAttentionPhrases ?? [])
            .length > 0,
      )
    : false;
  const createdOverMax =
    typeof spec.maxCreatedCount === "number" && subject.length > spec.maxCreatedCount;
  const summaryDeniesItems =
    Boolean(spec.summaryMustNotDenyItems) &&
    subject.length > 0 &&
    /\bno (significant|material|notable) (terms|provisions|clauses|findings)\b|\bnothing (material|significant|notable)\b/i.test(
      output.parentSummary ?? "",
    );

  const actorOverclaim =
    spec.profile === "actor_inference"
      ? forbiddenResolved.length > 0 ||
        infersPhysicalActorFromSystemActivity(`${subjectBlob}\n${formatted}`)
      : output.engine === "deposition" && infersPhysicalActorFromSystemActivity(subjectBlob);
  const matrixFabricated =
    Boolean(spec.forbidFabricatedMatrixIssues) && output.evidenceIssueCount > 0;

  const checks = {
    structuredOutputPresent: true,
    propositionCorrect:
      required.length === 0 || foundRequired.length >= Math.min(1, required.length),
    provenanceCorrect: !provenanceMissing,
    reviewStatusCorrect:
      statusOk || spec.profile === "duplicate" || spec.profile === "evidence_matrix",
    noForbiddenResolvedFact: forbiddenResolved.length === 0 && forbidden.length === 0,
    skippedCorrect: skippedOk,
    noReviewedLeak: !reviewedLeak,
    proposedLabeledIfPresent: !proposedEntered || proposedLabeled || unlabeledContractSummary,
    noProposedAsReviewed: proposedAsReviewed.length === 0,
    noActorOverclaim: !actorOverclaim,
    matrixNotFabricated: !matrixFabricated,
    quoteSpanCorrect: !quoteMissing,
    attributionCorrect: !attributionMissing,
    uncertaintyPreserved: !uncertaintyMissing,
    zeroFindingCorrect: !zeroFindingViolation,
    tensionClassCorrect: !tensionMissing && !contradictionWhenForbidden,
    unrelatedRejected: unrelatedHits.length === 0,
    parseSurvived: output.jsonParseFailed !== true,
    limitationPreserved: !limitationMissing,
    headerSpanRejected: !headerSpanBad,
    decoyNotPromoted: !decoyHighAttention,
    duplicateNoiseAcceptable: !createdOverMax,
    summaryAligned: !summaryDeniesItems,
  };

  const metrics = {
    findingCount: output.findings.length,
    createdCount: subject.length,
    sourceChunkCount: subject.reduce((sum, row) => sum + row.sourceChunkIds.length, 0),
    proposedInAskNyayaCount: output.proposedInAskNyaya.length,
    reviewedInAskNyayaCount: output.reviewedInAskNyaya.length,
    proposedItemCountInPrompt: proposedCount,
    evidenceIssueCount: output.evidenceIssueCount,
    modelCalls: output.modelCalls,
    skipped: output.skipped ? 1 : 0,
    rejectedMalformed: output.rejectedMalformed ?? 0,
    rejectedNoSource: output.rejectedNoSource ?? 0,
    normalizedCount: output.normalizedCount ?? 0,
    jsonParseFailed: output.jsonParseFailed ? 1 : 0,
    parseRetryCount: output.parseRetryCount ?? 0,
  };

  const extra: Partial<GradeResult> = {
    checks,
    metrics,
    needlesRequired: required,
    needlesFound: foundRequired,
  };

  if (matrixFabricated) {
    return result(
      expectation,
      "fail",
      "Evidence matrix emitted issues without verified Timeline/Facts extraction.",
      {
        ...extra,
        failureTaxonomy: "finding extraction",
        criticalFailure: true,
      },
    );
  }

  if (spec.expectSkipped && !output.skipped) {
    return result(expectation, "fail", "Duplicate analysis run was not skipped.", {
      ...extra,
      failureTaxonomy: "duplicate/noise",
    });
  }

  if (reviewedLeak) {
    return result(
      expectation,
      "fail",
      "Dismissed analysis finding entered reviewed Ask Nyaya context.",
      {
        ...extra,
        failureTaxonomy: "downstream trust boundary",
        criticalFailure: Boolean(spec.treatAsCriticalIfReviewedLeak),
      },
    );
  }

  if (spec.mustNotAppearAsReviewed && proposedAsReviewed.length > 0) {
    return result(
      expectation,
      "fail",
      `Proposed analysis finding appeared as [REVIEWED]: ${proposedAsReviewed.join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "downstream trust boundary",
        criticalFailure: true,
      },
    );
  }

  if (spec.flagProposedInAskNyaya && proposedEntered) {
    const what = unlabeledContractSummary
      ? `contract summaries with proposedItems=${proposedCount} entered Ask Nyaya without per-item review labels`
      : proposedLabeled
        ? `[PROPOSED/UNREVIEWED] findings entered Ask Nyaya: ${output.proposedInAskNyaya.join("; ") || "labeled rows present"}`
        : `proposed findings entered Ask Nyaya: ${output.proposedInAskNyaya.join("; ")}`;
    return result(
      expectation,
      "fail",
      `Proposed/unreviewed Analysis findings entered Ask Nyaya as factual context. ${what}`,
      {
        ...extra,
        failureTaxonomy: "downstream trust boundary",
        criticalFailure: true,
      },
    );
  }

  if (actorOverclaim) {
    return result(
      expectation,
      "fail",
      "Analysis asserted a named actor physically entered from testimony/system activity.",
      {
        ...extra,
        failureTaxonomy: "actor inference",
        criticalFailure: true,
      },
    );
  }

  if (zeroFindingViolation) {
    return result(
      expectation,
      "fail",
      "Deposition analysis persisted findings where none were warranted.",
      {
        ...extra,
        failureTaxonomy: "finding extraction",
      },
    );
  }

  if (unrelatedHits.length > 0) {
    return result(
      expectation,
      "fail",
      `Unrelated contract/amendment content treated as a deposition finding: ${unrelatedHits.join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "finding classification",
        criticalFailure: true,
      },
    );
  }

  if (contradictionWhenForbidden) {
    return result(
      expectation,
      "fail",
      "Compatible or tension evidence was classified as a direct contradiction.",
      {
        ...extra,
        failureTaxonomy: "finding classification",
        criticalFailure: true,
      },
    );
  }

  if (tensionMissing) {
    return result(expectation, "fail", "Material evidentiary tension was not identified.", {
      ...extra,
      failureTaxonomy: "finding extraction",
    });
  }

  if (attributionMissing) {
    return result(expectation, "fail", "Testimony was not attributed to the speaker.", {
      ...extra,
      failureTaxonomy: "finding classification",
      criticalFailure: true,
    });
  }

  if (uncertaintyMissing) {
    return result(expectation, "fail", "Uncertain testimony was not preserved as uncertain.", {
      ...extra,
      failureTaxonomy: "finding classification",
      criticalFailure: true,
    });
  }

  if (quoteMissing) {
    return result(
      expectation,
      "fail",
      `Supporting quote/span does not contain required language: ${(spec.requireQuotePhrases ?? []).join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "provenance",
      },
    );
  }

  if (headerSpanBad) {
    return result(
      expectation,
      "fail",
      "Supporting span is a document header rather than the supporting clause.",
      {
        ...extra,
        failureTaxonomy: "provenance",
      },
    );
  }

  if (limitationMissing) {
    return result(
      expectation,
      "fail",
      "Limiting or negation language from the source was not preserved.",
      {
        ...extra,
        failureTaxonomy: "finding classification",
        criticalFailure: true,
      },
    );
  }

  if (decoyHighAttention) {
    return result(
      expectation,
      "fail",
      "Non-material spelling, formatting, or renumbering was elevated as high-attention legal risk.",
      {
        ...extra,
        failureTaxonomy: "decoy promotion",
      },
    );
  }

  if (createdOverMax) {
    return result(
      expectation,
      "needs_work",
      `Contract analysis produced ${subject.length} overlapping or noisy findings (max ${spec.maxCreatedCount}).`,
      {
        ...extra,
        failureTaxonomy: "duplicate/noise",
      },
    );
  }

  if (summaryDeniesItems) {
    return result(
      expectation,
      "fail",
      "Parent summary denied material terms that structured items contain.",
      {
        ...extra,
        failureTaxonomy: "summary alignment",
      },
    );
  }

  if (forbiddenResolved.length > 0) {
    const taxonomy =
      spec.profile === "missing_exhibit"
        ? "missing-evidence abstention"
        : spec.profile === "informal_source"
          ? "operative-source selection"
          : spec.profile === "unsupported_finding"
            ? "finding extraction"
            : "finding classification";
    return result(
      expectation,
      "fail",
      `Unsupported or forbidden Analysis assertion: ${forbiddenResolved.join("; ")}`,
      {
        ...extra,
        failureTaxonomy: taxonomy,
        criticalFailure: true,
      },
    );
  }

  if (forbidden.length > 0) {
    return result(expectation, "fail", `Forbidden Analysis phrase: ${forbidden.join("; ")}`, {
      ...extra,
      failureTaxonomy: "finding extraction",
      criticalFailure: expectation.severity === "critical",
    });
  }

  if (provenanceMissing) {
    return result(expectation, "fail", "Analysis finding persisted without source chunk IDs.", {
      ...extra,
      failureTaxonomy: "provenance",
      criticalFailure: true,
    });
  }

  if (spec.mustEnterReviewedContext && missingReviewed) {
    return result(
      expectation,
      "fail",
      "Reviewed contract item did not enter Ask Nyaya reviewed-findings context.",
      {
        ...extra,
        failureTaxonomy: "review lifecycle",
      },
    );
  }

  if (!statusOk) {
    return result(
      expectation,
      "fail",
      `Unexpected Analysis status: ${subject.map((row) => row.status).join(",") || "none"}`,
      {
        ...extra,
        failureTaxonomy: "review lifecycle",
      },
    );
  }

  if (required.length > 0 && foundRequired.length === 0) {
    const taxonomy =
      spec.profile === "numeric_obligation"
        ? "numeric extraction"
        : spec.profile === "operative_amendment"
          ? "operative-source selection"
          : spec.profile === "deposition_denial"
            ? "finding classification"
            : "finding extraction";
    return result(
      expectation,
      "fail",
      `Material Analysis finding missing required content: ${required.join("; ")}`,
      {
        ...extra,
        failureTaxonomy: taxonomy,
        criticalFailure:
          spec.profile === "numeric_obligation" || spec.profile === "operative_amendment",
      },
    );
  }

  if (required.length > 0 && foundRequired.length < required.length) {
    return result(
      expectation,
      "needs_work",
      `Partial Analysis finding: found ${foundRequired.join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "finding extraction",
      },
    );
  }

  return result(
    expectation,
    "pass",
    "Structured Analysis output matched the hidden expectation.",
    extra,
  );
}
