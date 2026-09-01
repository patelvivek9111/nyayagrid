import { fold } from "./normalize";
import {
  assertsMutualImpossibility,
  expectedSemanticClass,
  infersPhysicalActorFromSystemActivity,
  isBadgeVersusTestimonyPair,
  isImpreciseDateVersusExactPair,
  mapFindingToSemanticClass,
} from "./semantic-map";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";
import {
  parseContradictionOutput,
  STRUCTURED_GRADER_VERSION,
  type CanonicalContradictionFinding,
} from "./structured-schemas";

function stem(name: string): string {
  return fold(name.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " "));
}

function findingFilenames(finding: CanonicalContradictionFinding): string[] {
  return [...finding.sourceA, ...finding.sourceB]
    .map((source) => source.filename)
    .filter((name): name is string => Boolean(name))
    .map(stem);
}

function findingCorpus(finding: CanonicalContradictionFinding): string {
  return [
    findingClaimText(finding),
    ...finding.sourceA.map((s) => s.supportingText),
    ...finding.sourceB.map((s) => s.supportingText),
  ].join("\n");
}

function findingClaimText(finding: CanonicalContradictionFinding): string {
  return [finding.title, finding.explanation ?? "", finding.statementA, finding.statementB].join(
    "\n",
  );
}

/** Title + explanation only. Supporting-text blobs concatenate unrelated PDF pages. */
function findingAssertedClaim(finding: CanonicalContradictionFinding): string {
  return [finding.title, finding.explanation ?? ""].join("\n");
}

function pairMatches(finding: CanonicalContradictionFinding, supportingDocs: string[]): boolean {
  if (supportingDocs.length === 0) return true;
  const files = findingFilenames(finding);
  if (files.length === 0) return false;
  return supportingDocs.every((doc) => files.some((file) => file.includes(stem(doc)) || stem(doc).includes(file)));
}

function provenancePresent(finding: CanonicalContradictionFinding): boolean {
  return finding.sourceA.length > 0 && finding.sourceB.length > 0;
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
    expectationType: expectation.expectationType,
    severity: extras.criticalFailure ? "critical" : expectation.severity,
    detail,
    needlesRequired: [],
    needlesFound: [],
    graderVersion: STRUCTURED_GRADER_VERSION,
    graderKind: "contradiction",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
  };
}

function relevantFindings(
  findings: CanonicalContradictionFinding[],
  expectation: BenchExpectation,
): CanonicalContradictionFinding[] {
  const expected = expectedSemanticClass(expectation);
  return findings.filter((finding) => {
    if (expected === "tension") return isBadgeVersusTestimonyPair(findingAssertedClaim(finding));
    if (expected === "compatible") return isImpreciseDateVersusExactPair(findingClaimText(finding));
    if (pairMatches(finding, expectation.supportingDocs)) return true;
    return false;
  });
}

export function gradeContradictionAnswer(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
): GradeResult {
  const output = parseContradictionOutput(answer.extras);
  if (!output) {
    return result(expectation, "fail", "Structured contradiction output missing after persistence.", {
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
      checks: { structuredOutputPresent: false },
    });
  }

  const expected = expectedSemanticClass(expectation);
  const mappedFindings = output.findings.map((finding) => ({
    ...finding,
    semanticClass: mapFindingToSemanticClass(finding),
  }));
  const relevant = relevantFindings(mappedFindings, expectation);
  const primary = relevant[0] ?? null;
  const actorOverclaim = mappedFindings.some((finding) =>
    infersPhysicalActorFromSystemActivity(findingClaimText(finding)),
  );
  const provenanceOk = primary ? provenancePresent(primary) : expected === "compatible";
  const sourcePairOk = primary ? pairMatches(primary, expectation.supportingDocs) : expected === "compatible";

  const checks = {
    correctSemanticClass: false,
    correctSourcePair: sourcePairOk,
    noFalseContradiction: true,
    noActorInference: !actorOverclaim,
    provenancePresent: provenanceOk,
  };

  if (actorOverclaim) {
    return result(
      expectation,
      "fail",
      "Finding treats system/badge activity as proof of a person's physical conduct.",
      {
        failureTaxonomy: "actor inference",
        criticalFailure: true,
        checks: { ...checks, noActorInference: false, correctSemanticClass: false },
      },
    );
  }

  if (expected === "compatible") {
    const falseHits = relevant;
    checks.noFalseContradiction = falseHits.length === 0;
    checks.correctSemanticClass = falseHits.length === 0;
    if (falseHits.length > 0) {
      const datePrecision = falseHits.some((finding) =>
        isImpreciseDateVersusExactPair(findingCorpus(finding)),
      );
      return result(
        expectation,
        "fail",
        "Asserted a contradiction or tension for mutually compatible evidence.",
        {
          failureTaxonomy: datePrecision ? "date precision" : "false contradiction",
          criticalFailure: true,
          checks,
        },
      );
    }
    return result(expectation, "pass", "Did not classify compatible evidence as a contradiction.", {
      checks,
    });
  }

  if (expected === "tension" || expected === "contradiction") {
    if (!primary) {
      return result(expectation, "fail", "Missed the expected conflict pair; no matching finding.", {
        failureTaxonomy: "missed contradiction",
        checks: { ...checks, correctSemanticClass: false, correctSourcePair: false },
      });
    }
    if (
      assertsMutualImpossibility(findingClaimText(primary)) &&
      isBadgeVersusTestimonyPair(findingCorpus(primary))
    ) {
      return result(
        expectation,
        "fail",
        "Treated testimony versus badge activity as mutually impossible.",
        {
          failureTaxonomy: "false contradiction",
          criticalFailure: true,
          checks: { ...checks, noFalseContradiction: false, correctSemanticClass: false },
        },
      );
    }
    if (!provenanceOk) {
      return result(expectation, "fail", "Matching finding lacks dual-sided provenance.", {
        failureTaxonomy: "provenance",
        checks: { ...checks, provenancePresent: false },
      });
    }
    if (expectation.supportingDocs.length > 0 && !sourcePairOk) {
      return result(expectation, "fail", "Matching finding cites the wrong source pair.", {
        failureTaxonomy: "wrong source pair",
        checks,
      });
    }
    if (primary.semanticClass === "compatible") {
      return result(expectation, "fail", "Classified a real conflict as compatible.", {
        failureTaxonomy: expected === "tension" ? "tension misclassified" : "missed contradiction",
        checks,
      });
    }
    if (expected === "tension" && primary.semanticClass === "contradiction") {
      checks.correctSemanticClass = true;
      return result(
        expectation,
        "needs_work",
        "Found the testimony/log pair but labeled it a contradiction rather than evidentiary tension. Sources match; production cross-document label is not treated as a false contradiction.",
        {
          failureTaxonomy: "tension misclassified",
          checks,
        },
      );
    }
    checks.correctSemanticClass = primary.semanticClass === expected;
    if (!checks.correctSemanticClass) {
      return result(
        expectation,
        "fail",
        `Expected semantic class ${expected}; mapped class was ${primary.semanticClass}.`,
        {
          failureTaxonomy: expected === "tension" ? "tension misclassified" : "false contradiction",
          checks,
        },
      );
    }
    return result(
      expectation,
      "pass",
      `Correctly identified ${expected} with matching sources.`,
      { checks },
    );
  }

  if (!primary) {
    checks.correctSemanticClass = true;
    return result(expectation, "pass", "Abstained / insufficient: no finding asserted.", { checks });
  }
  return result(expectation, "needs_work", "Expected insufficient/abstention but a finding was persisted.", {
    failureTaxonomy: "false contradiction",
    checks,
  });
}
