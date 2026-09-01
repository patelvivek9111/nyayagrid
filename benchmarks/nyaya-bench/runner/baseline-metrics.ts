import { classifyGradeFailure } from "../graders/failure-classes";
import type { GradeResult, PersistedAnswer } from "../graders/types";

function isApplicable(grade: GradeResult): boolean {
  return grade.expectationType !== "not_applicable" && !grade.detail.startsWith("INFRASTRUCTURE:");
}

export function summarizeCompareGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const rows = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return answer?.extras?.executionTarget === "contract_compare" && isApplicable(grade);
  });
  const material = rows.filter((row) => row.expectationType !== "non_material_change");
  const decoys = rows.filter((row) => row.expectationType === "non_material_change");
  const recalled = material.filter((row) => row.checks?.allMaterialChangesFound).length;
  const precise = material.filter((row) => row.checks?.beforeAfterCorrect).length;
  const decoyFp = decoys.filter((row) => row.failureTaxonomy === "decoy promotion").length;
  const provenanceFails = rows.filter((row) => row.failureTaxonomy === "provenance").length;
  const wrongPair = rows.filter(
    (row) => row.failureTaxonomy === "wrong version/document pair",
  ).length;
  const summaryDisagree = rows.filter(
    (row) => row.failureTaxonomy === "summary hallucination",
  ).length;
  return {
    tasks: rows.length,
    pass: rows.filter((row) => row.verdict === "pass").length,
    needs_work: rows.filter((row) => row.verdict === "needs_work").length,
    fail: rows.filter((row) => row.verdict === "fail").length,
    infrastructure: grades.filter(
      (row) =>
        answers.get(row.taskId)?.extras?.executionTarget === "contract_compare" &&
        row.detail.startsWith("INFRASTRUCTURE:"),
    ).length,
    critical: rows.filter((row) => row.criticalFailure && row.verdict === "fail").length,
    materialChangeRecall: material.length ? recalled / material.length : null,
    materialChangePrecision: material.length ? precise / material.length : null,
    decoyFalsePositiveRate: decoys.length ? decoyFp / decoys.length : null,
    provenanceFailures: provenanceFails,
    wrongDocumentPairFailures: wrongPair,
    summaryVsStructuredDisagreement: summaryDisagree,
    taxonomy: taxonomyCounts(rows, "contract_compare"),
    criticalFailures: rows.filter((row) => row.criticalFailure && row.verdict === "fail"),
  };
}

export function summarizeContradictionGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const rows = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return answer?.extras?.executionTarget === "contradiction" && isApplicable(grade);
  });
  const expectedTension = rows.filter((row) => row.expectationType === "possible_contradiction");
  const expectedCompatible = rows.filter((row) => row.expectationType === "not_contradiction");
  const contradictionAccuracy =
    expectedTension.length === 0
      ? null
      : expectedTension.filter((row) => row.verdict === "pass" || row.checks?.correctSemanticClass)
          .length / expectedTension.length;
  const tensionAccuracy =
    expectedTension.length === 0
      ? null
      : expectedTension.filter((row) => row.verdict === "pass").length / expectedTension.length;
  const compatibleAccuracy =
    expectedCompatible.length === 0
      ? null
      : expectedCompatible.filter((row) => row.verdict === "pass").length /
        expectedCompatible.length;
  const falsePositives = rows.filter(
    (row) =>
      row.failureTaxonomy === "false contradiction" ||
      row.failureTaxonomy === "compatible evidence misclassified" ||
      row.failureTaxonomy === "date precision",
  ).length;
  const missed = rows.filter((row) => row.failureTaxonomy === "missed contradiction").length;
  const actor = rows.filter((row) => row.failureTaxonomy === "actor inference").length;
  const provenance = rows.filter((row) => row.failureTaxonomy === "provenance").length;
  return {
    tasks: rows.length,
    pass: rows.filter((row) => row.verdict === "pass").length,
    needs_work: rows.filter((row) => row.verdict === "needs_work").length,
    fail: rows.filter((row) => row.verdict === "fail").length,
    infrastructure: grades.filter(
      (row) =>
        answers.get(row.taskId)?.extras?.executionTarget === "contradiction" &&
        row.detail.startsWith("INFRASTRUCTURE:"),
    ).length,
    critical: rows.filter((row) => row.criticalFailure && row.verdict === "fail").length,
    contradictionAccuracy,
    tensionAccuracy,
    compatibleNotContradictionAccuracy: compatibleAccuracy,
    falsePositiveContradictionRate: rows.length ? falsePositives / rows.length : null,
    missedConflictRate: expectedTension.length ? missed / expectedTension.length : null,
    actorInferenceOverclaim: actor,
    sourcePairProvenanceFailures: provenance,
    taxonomy: taxonomyCounts(rows, "contradiction"),
    criticalFailures: rows.filter((row) => row.criticalFailure && row.verdict === "fail"),
  };
}

export function summarizeTimelineGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const allTimeline = grades.filter(
    (grade) => answers.get(grade.taskId)?.extras?.executionTarget === "timeline",
  );
  const notApplicable = allTimeline.filter((row) => row.expectationType === "not_applicable");
  const scored = allTimeline.filter((row) => row.expectationType === "timeline");
  const recalled = scored.filter((row) => row.checks?.allExpectedEventsFound).length;
  const datePrecision = scored.filter((row) => row.checks?.datePrecisionCorrect).length;
  const actorOk = scored.filter((row) => row.checks?.noActorInference !== false).length;
  const provenance = scored.filter(
    (row) => row.failureTaxonomy === "source mapping" || row.failureTaxonomy === "provenance",
  ).length;
  const actor = scored.filter((row) => row.failureTaxonomy === "actor extraction").length;
  const unsupported = scored.filter((row) => row.failureTaxonomy === "invented event").length;
  const expectedCount = scored.reduce((sum, row) => sum + (row.metrics?.expectedCount ?? 0), 0);
  const producedCount = scored.reduce((sum, row) => sum + (row.metrics?.producedCount ?? 0), 0);
  const matchedCount = scored.reduce((sum, row) => sum + (row.metrics?.matchedCount ?? 0), 0);
  const unsupportedCount = scored.reduce(
    (sum, row) => sum + (row.metrics?.unsupportedCount ?? 0),
    0,
  );
  const duplicateCount = scored.reduce((sum, row) => sum + (row.metrics?.duplicateCount ?? 0), 0);
  const precisionValues = scored
    .map((row) => row.metrics?.eventPrecision)
    .filter((value): value is number => typeof value === "number");
  return {
    tasks: scored.length,
    notApplicable: notApplicable.length,
    eventsExpected: expectedCount,
    eventsProduced: producedCount,
    eventsMatched: matchedCount,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: allTimeline.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: scored.filter((row) => row.criticalFailure && row.verdict === "fail").length,
    eventRecall: scored.length ? recalled / scored.length : null,
    eventPrecision: precisionValues.length
      ? precisionValues.reduce((sum, value) => sum + value, 0) / precisionValues.length
      : null,
    dateAccuracy: scored.length ? recalled / scored.length : null,
    datePrecisionAccuracy: scored.length ? datePrecision / scored.length : null,
    actorAccuracy: scored.length ? actorOk / scored.length : null,
    actorOverclaim: actor,
    provenanceFailures: provenance,
    unsupportedEventTasks: unsupported,
    unsupportedEventCount: unsupportedCount,
    duplicateCount,
    taxonomy: taxonomyCounts(scored, "timeline"),
    criticalFailures: scored.filter((row) => row.criticalFailure && row.verdict === "fail"),
  };
}

export function summarizeMemoryGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter(
    (grade) => answers.get(grade.taskId)?.extras?.executionTarget === "memory",
  );
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const trust = scored.filter((row) => row.checks?.trustClassificationCorrect).length;
  const provenance = scored.filter((row) => row.checks?.provenanceCorrect).length;
  const proposition = scored.filter((row) => row.checks?.propositionCorrect).length;
  const downstream = scored.filter((row) => row.checks?.noDownstreamLeak === false).length;
  const manualUpgrade = scored.filter(
    (row) => row.failureTaxonomy === "manual-memory semantics",
  ).length;
  const disputed = scored.filter((row) => row.failureTaxonomy === "dispute handling").length;
  const stale = scored.filter((row) => row.failureTaxonomy === "supersession").length;
  const unsupported = scored.reduce(
    (sum, row) => sum + (row.metrics?.unsupportedActiveCount ?? 0),
    0,
  );
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    propositionAccuracy: scored.length ? proposition / scored.length : null,
    provenanceAccuracy: scored.length ? provenance / scored.length : null,
    trustStatusAccuracy: scored.length ? trust / scored.length : null,
    unsupportedMemoryRate: scored.length ? unsupported / Math.max(1, scored.length) : null,
    manualMemoryUpgradeRate: scored.length ? manualUpgrade / scored.length : null,
    disputedFactErrorRate: scored.length ? disputed / scored.length : null,
    staleMemoryRate: scored.length ? stale / scored.length : null,
    downstreamContextViolations: downstream,
    taxonomy: taxonomyCounts(scored, "memory"),
    criticalFailures: critical,
  };
}

export function summarizeAnalysisGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter(
    (grade) => answers.get(grade.taskId)?.extras?.executionTarget === "professional_analysis",
  );
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const contract = scored.filter((row) => row.taskId.startsWith("SYNTH-V2-001"));
  const deposition = scored.filter(
    (row) => row.taskId.startsWith("SYNTH-V2-006-AN00") && row.taskId !== "SYNTH-V2-006-AN012",
  );
  const matrix = scored.filter((row) => row.taskId.endsWith("-AN012"));
  const material = scored.filter((row) =>
    ["AN001", "AN002", "AN003"].some((id) => row.taskId.includes(id)),
  );
  const materialRecall = material.filter((row) => row.checks?.propositionCorrect).length;
  const provenance = scored.filter((row) => row.checks?.provenanceCorrect).length;
  const unsupported = scored.filter(
    (row) =>
      row.failureTaxonomy === "finding extraction" ||
      row.failureTaxonomy === "missing-evidence abstention" ||
      row.failureTaxonomy === "operative-source selection",
  ).length;
  const downstream = scored.filter(
    (row) => row.failureTaxonomy === "downstream trust boundary",
  ).length;
  const actor = scored.filter((row) => row.failureTaxonomy === "actor inference").length;
  const numeric = scored.filter((row) => row.taskId.includes("AN003"));
  const decoy = scored.filter(
    (row) => row.taskId.includes("AN006") || row.taskId.includes("AN005"),
  );
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    contract: {
      tasks: contract.length,
      materialRecall: material.length ? materialRecall / material.length : null,
      materialPrecision: material.length
        ? material.filter((row) => row.verdict === "pass").length / material.length
        : null,
      numericAccuracy: numeric.length
        ? numeric.filter((row) => row.checks?.propositionCorrect).length / numeric.length
        : null,
      operativeSourceAccuracy: scored.filter((row) => row.taskId.includes("AN002")).length
        ? scored.filter((row) => row.taskId.includes("AN002") && row.checks?.propositionCorrect)
            .length / scored.filter((row) => row.taskId.includes("AN002")).length
        : null,
      decoyFalsePositiveRate: decoy.length
        ? decoy.filter((row) => row.verdict === "fail").length / decoy.length
        : null,
    },
    deposition: {
      tasks: deposition.length,
      admissionDenialAccuracy: scored.filter((row) => row.taskId.includes("AN007")).length
        ? scored.filter((row) => row.taskId.includes("AN007") && row.verdict === "pass").length /
          scored.filter((row) => row.taskId.includes("AN007")).length
        : null,
      actorAccuracy: scored.filter((row) => row.taskId.includes("AN008")).length
        ? scored.filter((row) => row.taskId.includes("AN008") && row.verdict === "pass").length /
          scored.filter((row) => row.taskId.includes("AN008")).length
        : null,
      tensionConflictAccuracy: null,
      unsupportedConclusionRate: deposition.length
        ? deposition.filter((row) => row.verdict === "fail" && row.criticalFailure).length /
          deposition.length
        : null,
    },
    evidenceMatrix: {
      tasks: matrix.length,
      propositionCoverage: matrix.length
        ? matrix.filter((row) => row.verdict === "pass").length / matrix.length
        : null,
      evidenceRoleAccuracy: null,
      crossDocumentAccuracy: null,
    },
    provenanceAccuracy: scored.length ? provenance / scored.length : null,
    unsupportedFindingRate: scored.length ? unsupported / scored.length : null,
    reviewStatusAccuracy: scored.length
      ? scored.filter((row) => row.checks?.reviewStatusCorrect).length / scored.length
      : null,
    downstreamContextViolations: downstream,
    actorInferenceFailures: actor,
    duplicateNoiseRate: scored.filter((row) => row.failureTaxonomy === "duplicate/noise").length,
    taxonomy: taxonomyCounts(scored, "professional_analysis"),
    criticalFailures: critical,
  };
}

export function summarizeDepositionGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return (
      answer?.extras?.analysisEngine === "deposition" || Boolean(grade.taskId.match(/-DA\d{3}$/))
    );
  });
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const by = (suffix: string) => scored.filter((row) => row.taskId.endsWith(suffix));
  const rate = (rows: GradeResult[]) =>
    rows.length ? rows.filter((row) => row.verdict === "pass").length / rows.length : null;
  const persistedProposed = scored.filter((row) => row.checks?.reviewStatusCorrect);
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    findingRecall: rate([...by("-DA001"), ...by("-DA002"), ...by("-DA004"), ...by("-DA015")]),
    findingPrecision: scored.length
      ? scored.filter((row) => row.checks?.noForbiddenResolvedFact).length / scored.length
      : null,
    admissionAccuracy: rate(by("-DA001")),
    denialAccuracy: rate(by("-DA002")),
    actorAccuracy: rate(by("-DA005")),
    contradictionAccuracy: rate(by("-DA003")),
    tensionAccuracy: rate(by("-DA004")),
    compatibleNonConflictAccuracy: rate(by("-DA006")),
    uncertaintyPreservation: rate(by("-DA007")),
    testimonyAttributionAccuracy: rate(by("-DA008")),
    provenanceAccuracy: scored.length
      ? scored.filter((row) => row.checks?.provenanceCorrect).length / scored.length
      : null,
    quoteSpanAccuracy: scored.length
      ? scored.filter((row) => row.checks?.quoteSpanCorrect !== false).length / scored.length
      : null,
    unsupportedFindingRate: scored.length
      ? scored.filter(
          (row) =>
            row.failureTaxonomy === "finding extraction" ||
            row.failureTaxonomy === "actor inference",
        ).length / scored.length
      : null,
    zeroFindingCorrectness: rate(by("-DA014")),
    schemaParseFailureRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "infrastructure").length / scored.length
      : null,
    persistenceSuccess: scored.length
      ? scored.filter((row) => row.checks?.structuredOutputPresent).length / scored.length
      : null,
    proposedStatusAccuracy: scored.length ? persistedProposed.length / scored.length : null,
    taxonomy: taxonomyCounts(scored, "professional_analysis"),
    criticalFailures: critical,
  };
}

export function summarizeContractGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return (
      answer?.extras?.analysisEngine === "contract" || Boolean(grade.taskId.match(/-CA\d{3}$/))
    );
  });
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const by = (suffix: string) => scored.filter((row) => row.taskId.endsWith(suffix));
  const rate = (rows: GradeResult[]) =>
    rows.length ? rows.filter((row) => row.verdict === "pass").length / rows.length : null;
  const material = [
    ...by("-CA001"),
    ...by("-CA002"),
    ...by("-CA003"),
    ...by("-CA004"),
    ...by("-CA005"),
    ...by("-CA010"),
  ];
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    materialRecall: rate(material),
    materialPrecision: scored.length
      ? scored.filter((row) => row.checks?.noForbiddenResolvedFact).length / scored.length
      : null,
    numericAccuracy: rate([...by("-CA001"), ...by("-CA003"), ...by("-CA010")]),
    operativeSourceAccuracy: rate([...by("-CA002"), ...by("-CA006"), ...by("-CA009")]),
    amendmentAccuracy: rate([...by("-CA002"), ...by("-CA006"), ...by("-CA007")]),
    missingEvidenceAccuracy: rate(by("-CA008")),
    decoyFalsePositiveRate: by("-CA014").length
      ? by("-CA014").filter((row) => row.verdict === "fail").length / by("-CA014").length
      : null,
    provenanceAccuracy: scored.length
      ? scored.filter((row) => row.checks?.provenanceCorrect).length / scored.length
      : null,
    supportingSpanAccuracy: scored.length
      ? scored.filter((row) => row.checks?.quoteSpanCorrect !== false).length / scored.length
      : null,
    negationAccuracy: rate(by("-CA013")),
    duplicateNoiseRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "duplicate/noise").length / scored.length
      : null,
    summaryAlignment: rate(by("-CA016")),
    proposedStatusAccuracy: scored.length
      ? scored.filter((row) => row.checks?.reviewStatusCorrect).length / scored.length
      : null,
    taxonomy: taxonomyCounts(scored, "professional_analysis"),
    criticalFailures: critical,
  };
}

export function summarizeEvidenceGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return (
      answer?.extras?.analysisEngine === "evidence_matrix" || Boolean(grade.taskId.match(/-EM\d{3}$/))
    );
  });
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const rate = (check: string) =>
    scored.length ? scored.filter((row) => row.checks?.[check] !== false).length / scored.length : null;
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    propositionAccuracy: rate("noForbiddenResolvedFact"),
    provenanceAccuracy: rate("provenanceCorrect"),
    supportingSpanAccuracy: rate("quoteOverlapCorrect"),
    trustStatusAccuracy: rate("noProposedLeak"),
    disputedEvidenceAccuracy: rate("disputePreserved"),
    unsupportedEvidenceRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "unsupported-evidence").length / scored.length
      : null,
    proposedToVerifiedLeakageRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "trust-boundary" && row.verdict === "fail")
          .length / scored.length
      : null,
    wrongDocumentAttributionRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "wrong source association").length /
        scored.length
      : null,
    duplicateCorroborationErrorRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "duplicate evidence").length / scored.length
      : null,
    missingEvidenceFabricationRate: scored.length
      ? scored.filter(
          (row) =>
            row.failureTaxonomy === "unsupported-evidence" &&
            /exhibit z|universal|never paid/i.test(row.detail),
        ).length / scored.length
      : null,
    taxonomy: taxonomyCounts(scored, "professional_analysis"),
    criticalFailures: critical,
  };
}

export function summarizeDraftGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return answer?.extras?.structuredKind === "draft" || Boolean(grade.taskId.match(/-D\d{3}$/));
  });
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const rate = (check: string) =>
    scored.length ? scored.filter((row) => row.checks?.[check] !== false).length / scored.length : null;
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    factualAccuracy: rate("noForbiddenResolvedFact"),
    numericAccuracy: rate("requiredNeedlesPresent"),
    temporalAccuracy: rate("noForbiddenResolvedFact"),
    actorAccuracy: rate("noForbiddenResolvedFact"),
    missingEvidenceBehavior: rate("noForbiddenResolvedFact"),
    trustStatusAccuracy: rate("noProposedTimeline"),
    provenanceAccuracy: rate("provenanceCorrect"),
    quoteFidelity: rate("quoteFidelity"),
    unsupportedAssertionRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "unsupported assertion").length / scored.length
      : null,
    citationBodyAgreement: rate("assertionBodyAgreement"),
    versionIntegrity: rate("priorVersionRetained"),
    taxonomy: taxonomyCounts(scored, "draft"),
    criticalFailures: critical,
  };
}

export function summarizeGraphGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return answer?.extras?.structuredKind === "graph" || Boolean(grade.taskId.match(/-G\d{3}$/));
  });
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const rate = (check: string) =>
    scored.length ? scored.filter((row) => row.checks?.[check] !== false).length / scored.length : null;
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    edgePrecision: rate("noForbiddenResolvedFact"),
    actorAccuracy: rate("noPhysicalOverclaim"),
    negationAccuracy: rate("noPhysicalOverclaim"),
    temporalAccuracy: rate("noForbiddenResolvedFact"),
    provenanceAccuracy: rate("aiProvenance"),
    wrongDocumentRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "provenance" && /email/i.test(row.detail)).length /
        scored.length
      : null,
    unsupportedEdgeRate: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "unsupported inference").length / scored.length
      : null,
    proposedToVerifiedLeakageRate: scored.length
      ? scored.filter((row) => (row.metrics?.proposedInVerifiedCount ?? 0) > 0).length / scored.length
      : null,
    rejectedEdgeLeakageRate: scored.length
      ? scored.filter((row) => row.checks?.rejectedExcluded === false).length / scored.length
      : null,
    taxonomy: taxonomyCounts(scored, "graph"),
    criticalFailures: critical,
  };
}

export function summarizeResearchGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return answer?.extras?.structuredKind === "research" || Boolean(grade.taskId.match(/-R\d{3}$/));
  });
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const rate = (check: string) =>
    scored.length ? scored.filter((row) => row.checks?.[check] !== false).length / scored.length : null;
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    retrievalRecall: rate("requiredCitationPresent"),
    retrievalPrecision: rate("noForbiddenCitations"),
    exactCitationAccuracy: rate("requiredCitationPresent"),
    jurisdictionAccuracy: rate("noForbiddenJurisdiction"),
    primaryAuthorityAccuracy: rate("noForbiddenAnswers"),
    citationProvenanceAccuracy: rate("noFabricatedAuthorities"),
    holdingCharacterizationAccuracy: rate("noForbiddenFacts"),
    treatmentClaimAccuracy: rate("noUnsupportedTreatment"),
    corpusSilenceAccuracy: rate("corpusSilence"),
    proposedContextLeakage: scored.length
      ? scored.filter((row) => row.failureTaxonomy === "synthesis" && /one-million|always presumed/i.test(row.detail))
          .length / scored.length
      : null,
    memoGroundingAccuracy: rate("memoPresent"),
    taxonomy: taxonomyCounts(scored, "research"),
    criticalFailures: critical,
  };
}

export function summarizeAgentsGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return answer?.extras?.structuredKind === "agent" || Boolean(grade.taskId.match(/-AG\d{3}$/));
  });
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const rate = (check: string) =>
    scored.length ? scored.filter((row) => row.checks?.[check] !== false).length / scored.length : null;
  const byAgent = new Map<string, GradeResult[]>();
  for (const row of scored) {
    const answer = answers.get(row.taskId);
    const steps = (answer?.extras?.snapshot as { steps?: Array<{ agentType?: string }> } | undefined)?.steps ?? [];
    const types = [...new Set(steps.map((step) => step.agentType).filter(Boolean))] as string[];
    const key = types[0] ?? "unassigned";
    const list = byAgent.get(key) ?? [];
    list.push(row);
    byAgent.set(key, list);
  }
  const perAgent: Record<string, { tasks: number; pass: number; needs_work: number; fail: number; critical: number }> =
    {};
  for (const [agent, rows] of byAgent) {
    perAgent[agent] = {
      tasks: rows.length,
      pass: rows.filter((row) => row.verdict === "pass").length,
      needs_work: rows.filter((row) => row.verdict === "needs_work").length,
      fail: rows.filter((row) => row.verdict === "fail").length,
      critical: rows.filter((row) => row.criticalFailure && row.verdict === "fail").length,
    };
  }
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter(
      (row) => row.detail.startsWith("INFRASTRUCTURE:") || row.failureTaxonomy === "infrastructure",
    ).length,
    critical: critical.length,
    perAgent,
    goalCompletion: rate("requiredAgents") ?? rate("requiredAgentsAny"),
    correctToolChoiceRate: rate("requiredToolsAny") ?? rate("requiredTools"),
    unnecessaryToolRate: scored.length
      ? scored.filter((row) => row.checks?.forbiddenTools === false).length / scored.length
      : null,
    documentSelectionAccuracy: rate("requiredToolsAny"),
    matterScopeAccuracy: rate("matterScope"),
    approvalCompliance: rate("approvalPause") ?? rate("noPrematureTask"),
    permissionCompliance: rate("outsiderDenied") ?? rate("orgScope"),
    provenanceAccuracy: rate("provenance"),
    actorSafety: rate("actorSafety"),
    cancellationAccuracy: rate("cancelled"),
    budgetCompliance: rate("budgetStop"),
    duplicateMutationRate: scored.length
      ? scored.filter((row) => row.checks?.noDuplicateApprovals === false).length / scored.length
      : null,
    taxonomy: taxonomyCounts(scored, "agent"),
    criticalFailures: critical,
  };
}

export function summarizeFullSystemGrades(
  grades: GradeResult[],
  answers: Map<string, PersistedAnswer>,
) {
  const all = grades.filter((grade) => {
    const answer = answers.get(grade.taskId);
    return answer?.extras?.structuredKind === "full_system" || Boolean(grade.taskId.match(/-FS\d{3}$/));
  });
  const scored = all.filter((row) => row.expectationType !== "not_applicable");
  const critical = scored.filter((row) => row.criticalFailure && row.verdict === "fail");
  const rate = (check: string) =>
    scored.length ? scored.filter((row) => row.checks?.[check] !== false).length / scored.length : null;
  return {
    tasks: scored.length,
    pass: scored.filter((row) => row.verdict === "pass").length,
    needs_work: scored.filter((row) => row.verdict === "needs_work").length,
    fail: scored.filter((row) => row.verdict === "fail").length,
    infrastructure: all.filter((row) => row.detail.startsWith("INFRASTRUCTURE:")).length,
    critical: critical.length,
    proposedLeakage: scored.filter((row) => row.checks?.proposedIsolation === false).length,
    rejectedLeakage: scored.filter((row) => row.checks?.rejectedExcluded === false).length,
    actorOverclaim: scored.filter((row) => row.checks?.actorSafety === false).length,
    isolationFailures: scored.filter(
      (row) => row.checks?.isolationToken === false || row.checks?.isolationNeedle === false,
    ).length,
    viewOnlyFailures: scored.filter((row) => row.checks?.viewOnlyHttp === false).length,
    injectionFailures: scored.filter((row) => row.checks?.injection === false).length,
    actorSafety: rate("actorSafety"),
    taxonomy: taxonomyCounts(scored, "full_system"),
    criticalFailures: critical,
  };
}

function taxonomyCounts(rows: GradeResult[], executionTarget: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (row.verdict === "pass") continue;
    const key =
      classifyGradeFailure({
        detail: row.detail,
        expectationType: row.expectationType,
        executionTarget,
        taxonomy: row.failureTaxonomy,
      }) ??
      row.failureTaxonomy ??
      "unclassified";
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}
