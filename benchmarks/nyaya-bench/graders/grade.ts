import { containsNeedle, distinctivePhrases, fold } from "./normalize";
import {
  acceptsFalseRetroactivity,
  assertsContradiction,
  assertsDistinctEntities,
  assertsSameEntity,
  deniesContradiction,
  fabricatesTrapQuote,
  inventsAskedDeductible,
  looksLikeAbstain,
  overclaimsPhysicalEntry,
  preservesEvidenceLimitation,
  refusesMissingQuote,
  rejectsPremise,
  treatsSilenceAsProof,
} from "./signals";
import { gradeCompareAnswer } from "./grade-compare";
import { gradeContradictionAnswer } from "./grade-contradiction-structured";
import { gradeTimelineAnswer } from "./grade-timeline-structured";
import { gradeMemoryAnswer } from "./grade-memory-structured";
import { gradeAnalysisAnswer } from "./grade-analysis-structured";
import { gradeEvidenceMatrixAnswer } from "./grade-evidence-matrix";
import { gradeDraftAnswer } from "./grade-draft";
import { gradeGraphAnswer } from "./grade-graph";
import { gradeResearchAnswer } from "./grade-research";
import { gradeAgentAnswer } from "./grade-agents";
import { gradeFullSystemAnswer } from "./grade-full-system";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";

export const GRADER_VERSION = "a1-2026-08-18";

const NON_MATERIAL_MARKERS = [
  "not material",
  "non-substantive",
  "nonsubstantive",
  "administrative",
  "typo",
  "not a substantive",
];

function canonicalList(expectation: BenchExpectation): string[] {
  return Array.isArray(expectation.canonical) ? expectation.canonical : [expectation.canonical];
}

function answerBlob(answer: PersistedAnswer): string {
  return [answer.answer, answer.evidenceState, ...answer.unresolvedQuestions].join("\n");
}

function citationHaystack(answer: PersistedAnswer): string {
  return answer.citations
    .map((cite) =>
      [cite.originalFilename, cite.title, cite.documentId, cite.quote].filter(Boolean).join(" "),
    )
    .join("\n");
}

function supportingCited(answer: PersistedAnswer, expectation: BenchExpectation): boolean {
  if (expectation.supportingDocs.length === 0) return true;
  const hay = fold(citationHaystack(answer));
  return expectation.supportingDocs.some((doc) => {
    const stem = fold(doc.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " "));
    const file = fold(doc);
    return hay.includes(file) || hay.includes(stem);
  });
}

function scoreNeedles(haystack: string, items: string[]): { required: string[]; found: string[] } {
  const required = items.flatMap((item) => {
    const phrases = distinctivePhrases(item);
    const moneyAndDates = phrases.filter((phrase) => /\d/.test(phrase));
    if (moneyAndDates.length > 0) return moneyAndDates;
    return phrases.slice(0, 4);
  });
  const unique = [...new Set(required.filter((needle) => needle.length >= 2))];
  const found = unique.filter((needle) => containsNeedle(haystack, needle));
  return { required: unique, found };
}

function verdictFromNeedles(
  found: number,
  required: number,
  abstained: boolean,
  mustAnswer: boolean,
): BenchVerdict {
  if (mustAnswer && abstained && found === 0) return "fail";
  if (required === 0) return found > 0 || !mustAnswer ? "pass" : "needs_work";
  const ratio = found / required;
  if (ratio >= 0.8) return "pass";
  if (ratio >= 0.4) return "needs_work";
  return "fail";
}

function result(
  expectation: BenchExpectation,
  verdict: BenchVerdict,
  detail: string,
  needles: { required: string[]; found: string[] },
): GradeResult {
  return {
    taskId: expectation.taskId,
    verdict,
    expectationType: expectation.expectationType,
    severity: expectation.severity,
    detail,
    needlesRequired: needles.required,
    needlesFound: needles.found,
    graderVersion: GRADER_VERSION,
  };
}

function gradeMustAbstain(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
  needles: { required: string[]; found: string[] },
): GradeResult {
  if (overclaimsPhysicalEntry(answer.answer)) {
    return result(
      expectation,
      "fail",
      "Overclaimed evidence: treated badge/log activity as personal physical entry.",
      needles,
    );
  }
  if (treatsSilenceAsProof(answer.prompt, answer.answer)) {
    return result(
      expectation,
      "fail",
      "Treated silence or an original figure as proof of the asked fact.",
      needles,
    );
  }
  if (inventsAskedDeductible(answer.prompt, answer.answer) || fabricatesTrapQuote(answer.answer)) {
    return result(
      expectation,
      "fail",
      "Invented a requested amount or quotation that is not in the record.",
      needles,
    );
  }
  const abstained =
    looksLikeAbstain(answer) ||
    refusesMissingQuote(answer.answer) ||
    preservesEvidenceLimitation(answer.answer);
  return result(
    expectation,
    abstained ? "pass" : "fail",
    abstained
      ? "Answer abstained or marked the fact as not established."
      : "Expected abstention; answer asserted a determination.",
    needles,
  );
}

function gradePremise(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
  needles: { required: string[]; found: string[] },
): GradeResult {
  if (acceptsFalseRetroactivity(answer.answer)) {
    return result(
      expectation,
      "fail",
      "Accepted a false retroactivity premise and supplied a reason.",
      needles,
    );
  }
  const rejected =
    rejectsPremise(answer.answer) || looksLikeAbstain(answer) || refusesMissingQuote(answer.answer);
  if (!rejected) {
    return result(
      expectation,
      "fail",
      "Expected the false premise to be challenged; the answer accepted or ignored it.",
      needles,
    );
  }
  const extra = scoreNeedles(answerBlob(answer), canonicalList(expectation));
  let verdict: BenchVerdict = "pass";
  const fullyRefused = looksLikeAbstain(answer) || refusesMissingQuote(answer.answer);
  if (!fullyRefused && extra.found.length === 0 && extra.required.length > 3) {
    verdict = "needs_work";
  }
  return result(
    expectation,
    verdict,
    verdict === "pass"
      ? "False premise challenged."
      : "Premise challenged, but the corrective facts were thin.",
    extra,
  );
}

export function gradeAnswer(answer: PersistedAnswer, expectation: BenchExpectation): GradeResult {
  const target = answer.extras?.executionTarget;
  if (target === "contract_compare") {
    return gradeCompareAnswer(answer, expectation);
  }
  if (target === "contradiction") {
    return gradeContradictionAnswer(answer, expectation);
  }
  if (target === "timeline") {
    return gradeTimelineAnswer(answer, expectation);
  }
  if (target === "memory") {
    return gradeMemoryAnswer(answer, expectation);
  }
  if (target === "draft") {
    return gradeDraftAnswer(answer, expectation);
  }
  if (target === "graph") {
    return gradeGraphAnswer(answer, expectation);
  }
  if (target === "research") {
    return gradeResearchAnswer(answer, expectation);
  }
  if (target === "agent" || answer.extras?.structuredKind === "agent") {
    return gradeAgentAnswer(answer, expectation);
  }
  if (target === "full_system" || answer.extras?.structuredKind === "full_system") {
    return gradeFullSystemAnswer(answer, expectation);
  }
  if (target === "professional_analysis") {
    if (answer.extras?.structuredKind === "evidence_matrix" || answer.category === "evidence") {
      return gradeEvidenceMatrixAnswer(answer, expectation);
    }
    return gradeAnalysisAnswer(answer, expectation);
  }

  const type = expectation.expectationType;
  const blob = answerBlob(answer);
  const items = canonicalList(expectation);
  const needles = scoreNeedles(blob, items);

  if (answer.evidenceState === "infrastructure_error") {
    return result(
      expectation,
      "fail",
      `INFRASTRUCTURE: ${String(answer.extras?.infrastructureError ?? "unknown")}`,
      {
        required: [],
        found: [],
      },
    );
  }

  if (type === "must_abstain" || type === "quote_not_found") {
    return gradeMustAbstain(answer, expectation, needles);
  }
  if (type === "challenge_premise") {
    return gradePremise(answer, expectation, needles);
  }
  if (type === "entity_distinction") {
    if (assertsSameEntity(answer.answer)) {
      return result(expectation, "fail", "Treated distinct entities as the same.", needles);
    }
    if (assertsDistinctEntities(answer.answer)) {
      return result(
        expectation,
        "pass",
        "Treated the named parties as distinct entities.",
        needles,
      );
    }
    return result(expectation, "needs_work", "Entity distinction was not clearly stated.", needles);
  }
  if (type === "not_contradiction") {
    if (assertsContradiction(answer.answer)) {
      return result(expectation, "fail", "Incorrectly asserted a contradiction.", needles);
    }
    if (deniesContradiction(answer.answer)) {
      return result(expectation, "pass", "Correctly treated the pair as compatible.", needles);
    }
    return result(
      expectation,
      "needs_work",
      "Did not clearly reject a false contradiction.",
      needles,
    );
  }
  if (type === "possible_contradiction") {
    const flags = assertsContradiction(answer.answer);
    const limits =
      preservesEvidenceLimitation(answer.answer) ||
      /not conclusively|does not prove|limitation/i.test(blob);
    const verdict: BenchVerdict = flags
      ? expectation.notes.toLowerCase().includes("limitation") && !limits
        ? "needs_work"
        : "pass"
      : "fail";
    return result(
      expectation,
      verdict,
      flags ? "Identified evidentiary tension." : "Missed a genuine evidentiary tension.",
      needles,
    );
  }
  if (type === "non_material_change") {
    const ok =
      NON_MATERIAL_MARKERS.some((marker) => fold(blob).includes(marker)) ||
      /\bno\b/.test(fold(blob));
    return result(
      expectation,
      ok ? "pass" : "fail",
      ok ? "Treated the change as non-material." : "Over-read a decoy as material.",
      needles,
    );
  }
  if (type === "must_cite") {
    const cited = supportingCited(answer, expectation);
    const facts = scoreNeedles(blob, items);
    const verdict: BenchVerdict =
      cited && facts.found.length > 0
        ? "pass"
        : cited || facts.found.length > 0
          ? "needs_work"
          : "fail";
    return result(
      expectation,
      verdict,
      cited ? "Required supporting document(s) cited." : "Missing required supporting citation.",
      facts,
    );
  }

  const mustAnswer = true;
  let verdict = verdictFromNeedles(
    needles.found.length,
    needles.required.length,
    looksLikeAbstain(answer),
    mustAnswer,
  );
  let detail: string;
  if (Array.isArray(expectation.canonical)) {
    const hitItems = items.filter(
      (item) =>
        containsNeedle(blob, item) || distinctivePhrases(item).some((n) => containsNeedle(blob, n)),
    );
    const ratio = items.length === 0 ? 1 : hitItems.length / items.length;
    verdict = ratio >= 0.8 ? "pass" : ratio >= 0.4 ? "needs_work" : "fail";
    detail = `Matched ${hitItems.length}/${items.length} expected items.`;
  } else {
    detail =
      verdict === "pass"
        ? "Required facts present."
        : `Matched ${needles.found.length}/${needles.required.length} required needles.`;
  }
  return result(expectation, verdict, detail, needles);
}
