import { fold } from "./normalize";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";
import {
  parseCompareOutput,
  STRUCTURED_GRADER_VERSION,
  type CanonicalCompareChange,
  type CanonicalCompareOutput,
} from "./structured-schemas";

type ExpectedMaterialChange = {
  id: string;
  kind: "notice" | "cap" | "other";
  beforeDigits: string[];
  afterDigits: string[];
  raw: string;
};

function digits(text: string): string {
  return text.replace(/[$,\s]/g, "");
}

function corpus(change: CanonicalCompareChange): string {
  return fold(`${change.before ?? ""} ${change.after ?? ""}`);
}

function containsDigitToken(text: string, token: string): boolean {
  if (!token) return false;
  const compact = digits(text);
  if (compact.includes(token)) return true;
  const folded = fold(text);
  return folded.includes(fold(token));
}

function parseExpectedMaterialChanges(canonical: string | string[]): ExpectedMaterialChange[] {
  const items = Array.isArray(canonical) ? canonical : [canonical];
  return items.map((raw, index) => {
    const notice = raw.match(/notice period changed from (\d+)\s*to\s*(\d+)\s*days/i);
    if (notice?.[1] && notice[2]) {
      return {
        id: `notice-${index}`,
        kind: "notice",
        beforeDigits: [notice[1]],
        afterDigits: [notice[2]],
        raw,
      };
    }
    const cap = raw.match(/liability cap changed from \$?([0-9,]+)\s*to\s*\$?([0-9,]+)/i);
    if (cap?.[1] && cap[2]) {
      return {
        id: `cap-${index}`,
        kind: "cap",
        beforeDigits: [digits(cap[1])],
        afterDigits: [digits(cap[2])],
        raw,
      };
    }
    const fromTo = raw.match(/from\s+(.+?)\s+to\s+(.+)$/i);
    if (fromTo?.[1] && fromTo[2]) {
      return {
        id: `other-${index}`,
        kind: "other",
        beforeDigits: [digits(fromTo[1])].filter((tok) => /\d/.test(tok)),
        afterDigits: [digits(fromTo[2])].filter((tok) => /\d/.test(tok)),
        raw,
      };
    }
    return {
      id: `other-${index}`,
      kind: "other",
      beforeDigits: [],
      afterDigits: [],
      raw,
    };
  });
}

function matchChange(
  change: CanonicalCompareChange,
  expected: ExpectedMaterialChange,
): "match" | "swapped" | "partial" | "none" {
  const beforeText = change.before ?? "";
  const afterText = change.after ?? "";
  const beforeHit = expected.beforeDigits.every((tok) => containsDigitToken(beforeText, tok));
  const afterHit = expected.afterDigits.every((tok) => containsDigitToken(afterText, tok));
  if (beforeHit && afterHit) return "match";
  const swapped =
    expected.beforeDigits.every((tok) => containsDigitToken(afterText, tok)) &&
    expected.afterDigits.every((tok) => containsDigitToken(beforeText, tok));
  if (swapped && expected.beforeDigits.length > 0 && expected.afterDigits.length > 0) {
    return "swapped";
  }
  const combined = `${beforeText} ${afterText}`;
  const bothPresent =
    expected.beforeDigits.every((tok) => containsDigitToken(combined, tok)) &&
    expected.afterDigits.every((tok) => containsDigitToken(combined, tok));
  if (bothPresent) return "partial";
  if (afterHit || beforeHit) return "partial";
  return "none";
}

function stem(name: string): string {
  return fold(name.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " "));
}

function pairMatchesSupportingDocs(output: CanonicalCompareOutput, supportingDocs: string[]): boolean {
  const pair = [output.leftFilename, output.rightFilename].filter(Boolean).map((name) => stem(name!));
  if (pair.length < 2) return false;
  if (supportingDocs.length === 0) return true;
  return supportingDocs.every((doc) => pair.some((side) => side.includes(stem(doc)) || stem(doc).includes(side)));
}

function looksLikeExhibitRenumber(text: string): boolean {
  const folded = fold(text);
  return (
    /\brenumber/.test(folded) ||
    (/\bexhibit a\b/.test(folded) && /\bexhibit b\b/.test(folded)) ||
    /\badministrative and non-substantive\b/.test(folded)
  );
}

function looksLikeTypoDecoy(text: string): boolean {
  const folded = fold(text);
  return /\brecieve\b/.test(folded) || (/\breceive\b/.test(folded) && /\btypo\b/.test(folded));
}

function summaryPromotesDecoy(summary: string | null, decoyKind: "exhibit" | "typo"): boolean {
  if (!summary) return false;
  const folded = fold(summary);
  if (
    /\bno substantive\b/.test(folded) ||
    /\bnot (a )?substantive\b/.test(folded) ||
    /\bnon-substantive\b/.test(folded) ||
    /\badministrative (change|correction|renumber)/.test(folded)
  ) {
    return false;
  }
  const material = /\bmaterial\b|\bsubstantive\b|\bchanged the agreement\b/.test(folded);
  if (!material) return false;
  if (decoyKind === "exhibit") return /\bexhibit\b|\brenumber/.test(folded);
  return /\brecieve\b|\breceive\b|\btypo\b|\bspelling\b/.test(folded);
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
    graderKind: "compare",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
  };
}

export function gradeCompareAnswer(answer: PersistedAnswer, expectation: BenchExpectation): GradeResult {
  const output = parseCompareOutput(answer.extras);
  if (!output) {
    return result(expectation, "fail", "Structured compare output missing after persistence.", {
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
      checks: { structuredOutputPresent: false },
    });
  }

  const pairOk = pairMatchesSupportingDocs(output, expectation.supportingDocs);
  const provenanceOk =
    Boolean(output.leftDocumentId && output.rightDocumentId) &&
    output.changes.every((change) => change.sourceReferences.some((ref) => ref.documentId));

  if (expectation.expectationType === "non_material_change") {
    const prompt = fold(answer.prompt);
    const decoyKind: "exhibit" | "typo" = /\bexhibit\b|\brenumber/.test(prompt) ? "exhibit" : "typo";
    const decoyRows = output.changes.filter((change) =>
      decoyKind === "exhibit" ? looksLikeExhibitRenumber(corpus(change)) : looksLikeTypoDecoy(corpus(change)),
    );
    const promoted = decoyRows.filter((row) => row.materiality === "high_attention");
    const summaryBad = summaryPromotesDecoy(output.summary, decoyKind);
    const checks = {
      correctDocumentPair: pairOk,
      provenancePresent: provenanceOk,
      decoyNotHighAttention: promoted.length === 0,
      summaryDoesNotPromoteDecoy: !summaryBad,
    };
    if (!pairOk) {
      return result(expectation, "fail", "Compared the wrong document pair.", {
        failureTaxonomy: "wrong version/document pair",
        criticalFailure: true,
        checks,
      });
    }
    if (promoted.length > 0 || summaryBad) {
      return result(
        expectation,
        "fail",
        summaryBad
          ? "Summary presented a decoy/non-material change as a substantive amendment."
          : "Decoy/non-material change was promoted as high_attention.",
        {
          failureTaxonomy: "decoy promotion",
          criticalFailure: true,
          checks,
        },
      );
    }
    return result(expectation, "pass", "Decoy/non-material change was not promoted as material.", {
      failureTaxonomy: undefined,
      checks,
    });
  }

  const expectedChanges = parseExpectedMaterialChanges(expectation.canonical);
  const matches = expectedChanges.map((expected) => {
    const ranked = output.changes.map((change) => ({ change, hit: matchChange(change, expected) }));
    const match = ranked.find((row) => row.hit === "match");
    const swapped = ranked.find((row) => row.hit === "swapped");
    const partial = ranked.find((row) => row.hit === "partial");
    return { expected, match, swapped, partial };
  });

  const found = matches.filter((row) => row.match).length;
  const swapped = matches.filter((row) => row.swapped && !row.match);
  const missing = matches.filter((row) => !row.match && !row.swapped);
  const summaryDisagrees =
    output.summaryAlignment === "misaligned" || (output.summaryUnsupportedClaimCount ?? 0) > 0;

  const checks = {
    correctDocumentPair: pairOk,
    provenancePresent: provenanceOk,
    allMaterialChangesFound: found === expectedChanges.length && expectedChanges.length > 0,
    beforeAfterCorrect: swapped.length === 0 && found === expectedChanges.length,
    summaryAgreesWithChanges: !summaryDisagrees,
  };

  if (!pairOk) {
    return result(expectation, "fail", "Compared the wrong document pair.", {
      failureTaxonomy: "wrong version/document pair",
      criticalFailure: true,
      checks,
    });
  }
  if (swapped.length > 0) {
    return result(
      expectation,
      "fail",
      `Reported the opposite contractual change: ${swapped.map((row) => row.expected.raw).join("; ")}`,
      {
        failureTaxonomy: "numeric extraction",
        criticalFailure: true,
        checks: { ...checks, beforeAfterCorrect: false },
      },
    );
  }
  if (!provenanceOk) {
    return result(expectation, "fail", "Comparison rows lack document provenance.", {
      failureTaxonomy: "provenance",
      checks,
    });
  }
  if (found === 0) {
    return result(expectation, "fail", "Required material changes were not present on structured change rows.", {
      failureTaxonomy: "change extraction",
      checks,
    });
  }
  if (missing.length > 0) {
    const partialHits = missing.filter((row) => row.partial);
    const verdict: BenchVerdict = partialHits.length === missing.length ? "needs_work" : "fail";
    return result(
      expectation,
      verdict,
      `Material-change recall incomplete (${found}/${expectedChanges.length}). Missing: ${missing
        .map((row) => row.expected.raw)
        .join("; ")}`,
      {
        failureTaxonomy: partialHits.length === missing.length ? "numeric extraction" : "change extraction",
        checks,
      },
    );
  }
  if (summaryDisagrees) {
    return result(
      expectation,
      "needs_work",
      "Summary is misaligned with structured change rows.",
      {
        failureTaxonomy: "summary hallucination",
        checks,
      },
    );
  }
  return result(
    expectation,
    "pass",
    `Found ${found}/${expectedChanges.length} required material changes with correct before/after values.`,
    { checks },
  );
}
