import { validateQuoteAgainstText } from "@nyayagrid/research";
import type { C2APracticeArea, C2AResearchSpec, C2AStateCode } from "../datasets/t6t/c2a-catalog";

export type C2ASeverity = "PASS" | "NEEDS_WORK" | "FAIL" | "CRITICAL";
export type C2ACoverageLabel = "VALIDATED" | "LIMITED" | "UNVALIDATED" | "FAILED";
export type C2AFailureCode =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N";

export type C2AHit = {
  authorityId: string;
  citation: string | null;
  title: string;
  authorityType: string;
  authorityState: string | null;
  court: string | null;
  courtId: string | null;
  courtLevel: string | null;
  hierarchyRelationship?: string | null;
  temporalApplicability?: string | null;
  sourceProvider: string | null;
  snippet: string;
  canonicalSourceUrl: string | null;
  effectiveDate: string | null;
  sourceExternalId: string | null;
};

export type C2ASynthesis = {
  conciseAnswer: string;
  propositions: Array<{ text: string; authorityIds: string[]; chunkIds: string[] }>;
  sources: Array<{ authorityId: string; chunkId?: string | null; quote?: string | null }>;
  coverageWarnings: string[];
  jurisdictionCaveats: string[];
  unresolvedIssues: string[];
  fabricatedAuthorityIds: string[];
  rejectedQuoteCount: number;
  grounded: boolean;
};

export type C2ATaskResult = {
  id: string;
  state: C2AStateCode;
  kind: C2AResearchSpec["kind"];
  practiceArea: C2APracticeArea;
  severity: C2ASeverity;
  detail: string;
  rootCause?: C2AFailureCode;
  qualityPass: boolean;
};

export type C2AGradeInput = {
  spec: C2AResearchSpec;
  hits: C2AHit[];
  synthesis: C2ASynthesis;
  sourceTextByAuthorityId: Record<string, string>;
};

const CURRENT_LAW_OVERCLAIM =
  /\b(definitely the current law|currently effective|no temporal uncertainty|this is (definitely )?the current law)\b/i;
const ABSTAIN_MARKERS =
  /\b(does not (contain|include|cover)|not (in|within) (the )?(corpus|imported)|insufficient|cannot (answer|determine|confirm)|no (imported|retrieved) (authority|statute)|unvalidated|not enough|excerpt does not|beyond the (excerpt|imported)|unknown (effective|temporal)|waiting period.{0,40}(not|no|cannot))\b/i;

function topHits(hits: C2AHit[], n = 5): C2AHit[] {
  return hits.slice(0, n);
}

function homeHits(hits: C2AHit[], state: string): C2AHit[] {
  return hits.filter((hit) => hit.authorityState === state);
}

function controllingForeign(hits: C2AHit[], home: string): C2AHit[] {
  return hits.filter(
    (hit) =>
      hit.hierarchyRelationship === "controlling" &&
      hit.authorityState &&
      hit.authorityState !== home,
  );
}

function matchCitation(hit: C2AHit, needle: string | null): boolean {
  if (!needle) return true;
  const hay = `${hit.citation ?? ""} ${hit.title}`;
  return hay.toLowerCase().includes(needle.toLowerCase());
}

function retrievedExpected(hits: C2AHit[], spec: C2AResearchSpec): boolean {
  return hits.some((hit) => {
    const idOk = spec.expectSourceExternalId
      ? hit.sourceExternalId === spec.expectSourceExternalId
      : true;
    const citeOk = matchCitation(hit, spec.expectCitationContains);
    const stateOk = !spec.expectState || hit.authorityState === spec.expectState;
    return idOk && citeOk && stateOk;
  });
}

function answerText(synthesis: C2ASynthesis): string {
  return [
    synthesis.conciseAnswer,
    ...synthesis.propositions.map((row) => row.text),
    ...synthesis.coverageWarnings,
    ...synthesis.jurisdictionCaveats,
    ...synthesis.unresolvedIssues,
  ].join("\n");
}

function tokensGrounded(text: string, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  const hay = text.toLowerCase();
  const hits = tokens.filter((token) => token.length > 2 && hay.includes(token.toLowerCase()));
  return hits.length >= Math.min(1, tokens.filter((t) => t.length > 2).length);
}

function quotesOk(synthesis: C2ASynthesis, sourceTextByAuthorityId: Record<string, string>): boolean {
  for (const source of synthesis.sources) {
    const quote = source.quote?.trim();
    if (!quote) continue;
    const body = sourceTextByAuthorityId[source.authorityId] ?? "";
    if (!validateQuoteAgainstText(quote, body).valid) return false;
  }
  return true;
}

function result(
  spec: C2AResearchSpec,
  severity: C2ASeverity,
  detail: string,
  rootCause?: C2AFailureCode,
): C2ATaskResult {
  return {
    id: spec.id,
    state: spec.state,
    kind: spec.kind,
    practiceArea: spec.practiceArea,
    severity,
    detail,
    rootCause,
    qualityPass: severity === "PASS",
  };
}

export function gradeC2ATask(input: C2AGradeInput): C2ATaskResult {
  const { spec, hits, synthesis, sourceTextByAuthorityId } = input;
  const text = answerText(synthesis);

  if (synthesis.fabricatedAuthorityIds.length > 0) {
    return result(spec, "CRITICAL", "Fabricated authority id in synthesis.", "F");
  }
  if (!quotesOk(synthesis, sourceTextByAuthorityId) || synthesis.rejectedQuoteCount > 0) {
    return result(spec, "CRITICAL", "Quoted language is not verbatim in stored source text.", "H");
  }
  const syntheticControlling = hits.filter(
    (hit) =>
      hit.hierarchyRelationship === "controlling" &&
      hit.sourceProvider !== "us-primary-corpus",
  );
  if (syntheticControlling.length > 0) {
    return result(
      spec,
      "CRITICAL",
      "Synthetic or non-primary authority labeled controlling for a state-law question.",
      "E",
    );
  }
  const foreign = controllingForeign(hits, spec.expectState);
  if (foreign.length > 0) {
    return result(
      spec,
      "CRITICAL",
      `Wrong-state authority labeled controlling: ${foreign.map((h) => h.authorityState).join(",")}.`,
      "E",
    );
  }

  if (spec.expectAbstention || spec.expectLimitation) {
    const inventedCite = /\b\d+\s+[A-Z][a-z]+\.?\s+(Code|Stat|C\.S|P\.S)\b/.test(synthesis.conciseAnswer) &&
      !hits.some((hit) => (hit.citation ?? "").length > 0 && synthesis.conciseAnswer.includes(hit.citation ?? "###"));
    if (inventedCite) {
      return result(spec, "CRITICAL", "Invented statute citation on an out-of-corpus question.", "F");
    }
    const safe = ABSTAIN_MARKERS.test(text) || synthesis.coverageWarnings.length > 0 || !synthesis.grounded;
    if (spec.kind === "temporal-current-law") {
      const overclaim = CURRENT_LAW_OVERCLAIM.test(synthesis.conciseAnswer) && !ABSTAIN_MARKERS.test(text);
      if (overclaim) {
        return result(spec, "FAIL", "Current-law language used without effective-date proof.", "I");
      }
      const statuteHits = homeHits(hits, spec.expectState).filter((hit) => !hit.effectiveDate);
      const claimedApplicable = statuteHits.some((hit) => hit.temporalApplicability === "applicable");
      if (claimedApplicable) {
        return result(spec, "FAIL", "Missing effective dates treated as currently applicable.", "I");
      }
      return result(spec, "PASS", "Temporal uncertainty preserved; no current-law overclaim.");
    }
    if (!safe && /waiting period|dissent|vote count/i.test(spec.question) && /\b\d+\s+days?\b/i.test(synthesis.conciseAnswer)) {
      return result(spec, "FAIL", "Unsupported out-of-corpus proposition presented confidently.", "K");
    }
    return result(
      spec,
      safe ? "PASS" : "NEEDS_WORK",
      safe
        ? "Abstained or limited when corpus does not support the question."
        : "Did not clearly limit or abstain for an unsupported question.",
      safe ? undefined : "J",
    );
  }

  const found = retrievedExpected(topHits(hits, 8), spec);
  if (!found && (spec.kind === "contract-statute" || spec.kind === "employment-statute" || spec.kind === "high-court-case")) {
    return result(spec, "FAIL", "Expected home-state authority was not retrieved in top hits.", "B");
  }
  if (!found && spec.kind !== "hierarchy" && spec.kind !== "labeling") {
    return result(spec, "NEEDS_WORK", "Expected authority not clearly retrieved.", "B");
  }

  if (spec.kind === "wrong-state-statute" || spec.kind === "wrong-state-case" || spec.kind === "labeling") {
    if (foreign.length > 0) {
      return result(spec, "CRITICAL", "Decoy state labeled controlling.", "E");
    }
    const decoyControlling = hits.some(
      (hit) => hit.authorityState === spec.decoyState && hit.hierarchyRelationship === "controlling",
    );
    if (decoyControlling) {
      return result(spec, "CRITICAL", "Wrong-state decoy labeled controlling.", "E");
    }
    return result(spec, "PASS", "Home-state authority preferred; decoy not controlling.");
  }

  if (spec.kind === "hierarchy") {
    const homeHigh = hits.find(
      (hit) => hit.authorityState === spec.expectState && hit.courtLevel === "state_high",
    );
    if (homeHigh && homeHigh.hierarchyRelationship === "out_of_jurisdiction") {
      return result(spec, "FAIL", "Home-state high court labeled out of jurisdiction.", "E");
    }
    return result(spec, "PASS", "Home-state high court not demoted below controlling/persuasive.");
  }

  if (spec.kind === "citation") {
    const citeHay = `${synthesis.conciseAnswer} ${hits.map((h) => h.citation ?? "").join(" ")}`;
    const needle = spec.expectCitationContains ?? "";
    if (needle && !citeHay.toLowerCase().includes(needle.toLowerCase())) {
      return result(spec, "FAIL", "Stored citation was not preserved in retrieval/synthesis.", "F");
    }
    const missingUrl = homeHits(hits, spec.expectState).filter((hit) => !hit.canonicalSourceUrl);
    if (missingUrl.length > 0 && retrievedExpected(hits, spec)) {
      return result(spec, "NEEDS_WORK", "Retrieved home authority is missing canonicalSourceUrl.", "L");
    }
    return result(spec, "PASS", "Citation matches stored record and source URL is present.");
  }

  if (spec.kind === "grounding") {
    const grounded = tokensGrounded(text, spec.expectTokens) || tokensGrounded(
      homeHits(hits, spec.expectState)
        .map((hit) => hit.snippet)
        .join(" "),
      spec.expectTokens,
    );
    if (!grounded && synthesis.grounded) {
      return result(spec, "FAIL", "Synthesized rule is not supported by retrieved source tokens.", "G");
    }
    if (!grounded) {
      return result(spec, "NEEDS_WORK", "Proposition grounding is weak or the model abstained.", "G");
    }
    return result(spec, "PASS", "Synthesized proposition is supported by retrieved source text.");
  }

  if (spec.expectUnknownTemporal) {
    const undated = homeHits(hits, spec.expectState).filter((hit) => !hit.effectiveDate);
    if (undated.some((hit) => hit.temporalApplicability === "applicable")) {
      return result(spec, "FAIL", "Undated statute marked temporally applicable.", "I");
    }
  }

  return result(spec, found ? "PASS" : "NEEDS_WORK", found ? "Home-state authority retrieved." : "Retrieval incomplete.", found ? undefined : "B");
}

export function materialQualityPct(tasks: C2ATaskResult[]): number {
  if (tasks.length === 0) return 0;
  const pass = tasks.filter((task) => task.qualityPass).length;
  return Math.round((pass / tasks.length) * 1000) / 10;
}

export function labelPracticeArea(params: {
  area: C2APracticeArea;
  tasks: C2ATaskResult[];
}): { label: C2ACoverageLabel; scope: string; dbStatus: "supported" | "limited" | "unvalidated" } {
  const { area, tasks } = params;
  const critical = tasks.filter((task) => task.severity === "CRITICAL").length;
  const quality = materialQualityPct(tasks);
  const retrievalStrong = tasks
    .filter((task) =>
      area === "Contract"
        ? task.kind === "contract-statute"
        : area === "Employment"
          ? task.kind === "employment-statute"
          : task.kind === "high-court-case",
    )
    .some((task) => task.severity === "PASS");
  const safetyPass = tasks
    .filter((task) => task.kind === "wrong-state-statute" || task.kind === "wrong-state-case" || task.kind === "citation")
    .every((task) => task.severity === "PASS" || task.severity === "NEEDS_WORK");

  if (area === "Criminal") {
    return {
      label: "UNVALIDATED",
      scope: "No criminal statute corpus; high-court excerpts are not criminal-practice certification.",
      dbStatus: "unvalidated",
    };
  }
  if (critical > 0) {
    return {
      label: "FAILED",
      scope: "Material jurisdiction or synthesis defect; not eligible.",
      dbStatus: "unvalidated",
    };
  }
  if (!retrievalStrong) {
    return {
      label: "UNVALIDATED",
      scope: "Insufficient reliable retrieval for this practice-area slice.",
      dbStatus: "unvalidated",
    };
  }
  if (area === "Civil") {
    return {
      label: "LIMITED",
      scope: "Excerpt-only high-court retrieval; not general civil completeness.",
      dbStatus: "limited",
    };
  }
  if (quality >= 90 && safetyPass) {
    return {
      label: "VALIDATED",
      scope:
        area === "Contract"
          ? "UCC § 2-725 limitations retrieval and citation"
          : "Imported wage/employment statute retrieval",
      dbStatus: "supported",
    };
  }
  return {
    label: "LIMITED",
    scope:
      area === "Contract"
        ? "UCC § 2-725 present but not at 90%+ material quality"
        : "Imported wage statute present but not at 90%+ material quality",
    dbStatus: "limited",
  };
}
