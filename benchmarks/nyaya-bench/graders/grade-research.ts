import { fold } from "./normalize";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";

export const RESEARCH_GRADER_VERSION = "r1-2026-08-19";

export type ResearchSpec = {
  profile: string;
  requireHitCitationsAny?: string[];
  forbidHitCitations?: string[];
  requireHitTitleNeedles?: string[];
  forbidHitJurisdictions?: string[];
  requireNeedlesAny?: string[][];
  forbiddenResolvedAsFactPhrases?: string[];
  forbidAnswerPhrases?: string[];
  requireLimitedCorpusWarning?: boolean;
  requireNoRejectedQuotes?: boolean;
  requireNoFabricatedAuthorities?: boolean;
  forbidUnsupportedTreatment?: boolean;
  requireCorpusSilence?: boolean;
  requireMemo?: boolean;
  forbidPropositionCitation?: string[];
  requireNoMatterLeakOnHits?: boolean;
};

type ResearchSnapshot = {
  kind?: string;
  grounded?: boolean;
  hitCount?: number;
  citations?: Array<string | null>;
  titles?: string[];
  jurisdictions?: Array<string | null>;
  authorityTypes?: string[];
  conciseAnswer?: string;
  analysis?: string;
  memoText?: string;
  coverageWarnings?: string[];
  fabricatedAuthorityIds?: string[];
  rejectedQuoteCount?: number;
  droppedPropositionCount?: number;
  usedMatterContext?: boolean;
  matterFieldLeak?: boolean;
  propositions?: Array<{ text?: string; authorityIds?: string[] }>;
  sources?: Array<{ authorityId?: string; citation?: string; quote?: string | null }>;
  hits?: Array<{ authorityId?: string; citation?: string | null; title?: string }>;
};

function parseSpec(expectation: BenchExpectation): ResearchSpec {
  const raw = expectation.notes.trim();
  if (!raw.startsWith("{")) return { profile: expectation.expectationType };
  try {
    const parsed = JSON.parse(raw) as ResearchSpec;
    return { ...parsed, profile: parsed.profile ?? expectation.expectationType };
  } catch {
    return { profile: expectation.expectationType };
  }
}

function parseSnapshot(extras: Record<string, unknown> | undefined): ResearchSnapshot | null {
  const raw = extras?.structuredOutput;
  if (!raw || typeof raw !== "object") return null;
  const output = raw as { snapshot?: ResearchSnapshot };
  return output.snapshot ?? (raw as ResearchSnapshot);
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
    graderVersion: RESEARCH_GRADER_VERSION,
    graderKind: "research",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
    metrics: extras.metrics,
  };
}

function blob(snapshot: ResearchSnapshot): string {
  return fold(
    [
      snapshot.conciseAnswer ?? "",
      snapshot.analysis ?? "",
      snapshot.memoText ?? "",
      (snapshot.propositions ?? []).map((row) => row.text ?? "").join("\n"),
      (snapshot.coverageWarnings ?? []).join("\n"),
    ].join("\n"),
  );
}

export function gradeResearchAnswer(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
): GradeResult {
  const spec = parseSpec(expectation);
  const snapshot = parseSnapshot(answer.extras);
  if (!snapshot) {
    return result(expectation, "fail", "INFRASTRUCTURE: Structured research output missing.", {
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
      checks: { structuredOutputPresent: false },
    });
  }

  const text = blob(snapshot);
  const answerText = fold(`${snapshot.conciseAnswer ?? ""}\n${snapshot.memoText ?? ""}`);
  const citations = (snapshot.citations ?? []).map((value) => fold(value ?? ""));
  const titles = (snapshot.titles ?? []).map((value) => fold(value));
  const warnings = fold((snapshot.coverageWarnings ?? []).join("\n"));
  const forbiddenFacts = (spec.forbiddenResolvedAsFactPhrases ?? []).filter((phrase) =>
    text.includes(fold(phrase)),
  );
  const forbiddenAnswers = (spec.forbidAnswerPhrases ?? []).filter((phrase) =>
    answerText.includes(fold(phrase)),
  );
  const requiredCite =
    !spec.requireHitCitationsAny ||
    spec.requireHitCitationsAny.some((cite) => citations.some((hit) => hit.includes(fold(cite))));
  const forbiddenCiteHits = (spec.forbidHitCitations ?? []).filter((cite) =>
    citations.some((hit) => hit.includes(fold(cite))),
  );
  const titleNeedles = spec.requireHitTitleNeedles ?? [];
  const titlesOk =
    titleNeedles.length === 0 ||
    titleNeedles.every((needle) => titles.some((title) => title.includes(fold(needle))));
  const forbiddenJxn = (spec.forbidHitJurisdictions ?? []).filter((jxn) =>
    (snapshot.jurisdictions ?? []).some((value) => fold(value ?? "") === fold(jxn)),
  );
  const anyGroups = spec.requireNeedlesAny ?? [];
  const anyOk =
    anyGroups.length === 0 ||
    anyGroups.every((group) => group.some((needle) => text.includes(fold(needle))));
  const limitedOk =
    !spec.requireLimitedCorpusWarning ||
    warnings.includes("imported into this nyayagrid corpus") ||
    warnings.includes("not a comprehensive survey");
  const silenceOk =
    !spec.requireCorpusSilence ||
    (snapshot.hitCount ?? 0) === 0 ||
    snapshot.grounded === false ||
    warnings.includes("no legal authority passages were retrieved") ||
    answerText.includes("available corpus") ||
    answerText.includes("authoritative legal research has not been performed");
  const treatmentHit =
    spec.forbidUnsupportedTreatment === true &&
    (/\b(has been|was) overruled\b/.test(answerText) ||
      /\bis (still )?good law\b/.test(answerText) ||
      /\bis still valid\b/.test(answerText) ||
      /\bis controlling\b/.test(answerText));
  const hitCiteByAuthority = new Map(
    (snapshot.hits ?? []).map((hit) => [hit.authorityId ?? "", fold(hit.citation ?? "")]),
  );
  const propositionCitations = (snapshot.propositions ?? []).flatMap((row) =>
    (row.authorityIds ?? [])
      .map((id) => hitCiteByAuthority.get(id) ?? "")
      .filter(Boolean),
  );
  const wrongPropCite = (spec.forbidPropositionCitation ?? []).filter((cite) =>
    propositionCitations.some((value) => value.includes(fold(cite))),
  );

  const checks = {
    structuredOutputPresent: true,
    requiredCitationPresent: requiredCite,
    noForbiddenCitations: forbiddenCiteHits.length === 0,
    titleNeedlesPresent: titlesOk,
    noForbiddenJurisdiction: forbiddenJxn.length === 0,
    requiredNeedlesPresent: anyOk,
    noForbiddenFacts: forbiddenFacts.length === 0,
    noForbiddenAnswers: forbiddenAnswers.length === 0,
    limitedCorpusWarning: limitedOk,
    noRejectedQuotes: !spec.requireNoRejectedQuotes || (snapshot.rejectedQuoteCount ?? 0) === 0,
    noFabricatedAuthorities:
      !spec.requireNoFabricatedAuthorities || (snapshot.fabricatedAuthorityIds ?? []).length === 0,
    noUnsupportedTreatment: !treatmentHit,
    corpusSilence: silenceOk,
    memoPresent: !spec.requireMemo || snapshot.kind === "memo",
    noWrongAuthorityCite: wrongPropCite.length === 0,
    noMatterLeak: !spec.requireNoMatterLeakOnHits || snapshot.matterFieldLeak !== true,
  };

  const extra: Partial<GradeResult> = {
    checks,
    metrics: {
      hitCount: snapshot.hitCount ?? 0,
      grounded: snapshot.grounded ? 1 : 0,
      fabricatedAuthorityCount: (snapshot.fabricatedAuthorityIds ?? []).length,
      rejectedQuoteCount: snapshot.rejectedQuoteCount ?? 0,
      modelCalls: typeof answer.extras?.modelCalls === "number" ? answer.extras.modelCalls : 0,
    },
  };

  if (forbiddenFacts.length > 0 || forbiddenAnswers.length > 0) {
    return result(
      expectation,
      "fail",
      `Unsafe research claim: ${[...forbiddenFacts, ...forbiddenAnswers].join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "synthesis",
        criticalFailure: expectation.severity === "critical",
      },
    );
  }
  if (treatmentHit) {
    return result(expectation, "fail", "Research asserted editorial treatment without corpus support.", {
      ...extra,
      failureTaxonomy: "treatment overclaim",
      criticalFailure: true,
    });
  }
  if (spec.requireNoFabricatedAuthorities && (snapshot.fabricatedAuthorityIds ?? []).length > 0) {
    return result(expectation, "fail", "Synthesis cited an authority id that was not retrieved.", {
      ...extra,
      failureTaxonomy: "provenance",
      criticalFailure: true,
    });
  }
  if (spec.requireNoRejectedQuotes && (snapshot.rejectedQuoteCount ?? 0) > 0) {
    return result(expectation, "fail", "A generated quotation was not verbatim in the cited passage.", {
      ...extra,
      failureTaxonomy: "provenance",
      criticalFailure: true,
    });
  }
  if (spec.requireNoMatterLeakOnHits && snapshot.matterFieldLeak) {
    return result(expectation, "fail", "Authority search hits included matter-scoped identifiers.", {
      ...extra,
      failureTaxonomy: "trust-boundary leakage",
      criticalFailure: true,
    });
  }
  if (spec.requireCorpusSilence && !silenceOk) {
    return result(expectation, "fail", "Corpus silence was not treated conservatively.", {
      ...extra,
      failureTaxonomy: "corpus-silence behavior",
      criticalFailure: expectation.severity === "critical",
    });
  }
  if (forbiddenJxn.length > 0) {
    return result(expectation, "fail", `Wrong-jurisdiction authority retrieved: ${forbiddenJxn.join("; ")}`, {
      ...extra,
      failureTaxonomy: "jurisdiction",
      criticalFailure: expectation.severity === "critical",
    });
  }
  if (wrongPropCite.length > 0) {
    return result(expectation, "fail", `Wrong authority attached to the proposition: ${wrongPropCite.join("; ")}`, {
      ...extra,
      failureTaxonomy: "provenance",
      criticalFailure: true,
    });
  }
  if (spec.requireMemo && snapshot.kind !== "memo") {
    return result(expectation, "fail", "INFRASTRUCTURE: Research memo output missing.", {
      ...extra,
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
    });
  }
  if (!requiredCite || !titlesOk || !anyOk) {
    return result(expectation, "needs_work", "Research missed the expected retrieved authority or rule content.", {
      ...extra,
      failureTaxonomy: "retrieval",
    });
  }
  if (forbiddenCiteHits.length > 0) {
    return result(expectation, "needs_work", `Near-name decoy outranked the target: ${forbiddenCiteHits.join("; ")}`, {
      ...extra,
      failureTaxonomy: "ranking",
    });
  }
  if (!limitedOk) {
    return result(expectation, "needs_work", "Research omitted the limited-corpus coverage warning.", {
      ...extra,
      failureTaxonomy: "corpus-silence behavior",
    });
  }

  return result(expectation, "pass", "Structured research matched the hidden expectation.", extra);
}
