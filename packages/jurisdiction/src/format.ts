import { circuitShortName, stateDisplayName } from "./registry";
import type { MatterJurisdictionContext, MatterJurisdictionInput } from "./types";

export function formatJurisdictionSummary(ctx: {
  jurisdictionMode: MatterJurisdictionContext["jurisdictionMode"];
  primaryState: string | null;
  forumType: string | null;
  courtName: string | null;
  courtId: string | null;
  federalCircuit: string | null;
  practiceArea: string | null;
  governingLawState: string | null;
}): string {
  const court = ctx.courtName;
  const circuit = circuitShortName(ctx.federalCircuit);
  const practice = ctx.practiceArea?.trim() || null;

  if (
    ctx.jurisdictionMode === "unknown" &&
    !ctx.primaryState &&
    !court &&
    ctx.forumType !== "federal" &&
    !ctx.governingLawState
  ) {
    return "Jurisdiction not set";
  }

  if (ctx.forumType === "federal" && !ctx.primaryState && !court) {
    return ["Federal", "District not set", practice].filter(Boolean).join(" · ");
  }

  if (ctx.governingLawState && ctx.governingLawState !== ctx.primaryState) {
    return [
      `${ctx.governingLawState} law`,
      court ? `${court} forum` : ctx.primaryState ? `${ctx.primaryState} forum` : "Federal forum",
      circuit,
      practice,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const parts: string[] = [];
  if (ctx.primaryState) parts.push(ctx.primaryState);
  else if (ctx.forumType === "federal") parts.push("Federal");
  if (court) parts.push(court);
  else if (ctx.primaryState) parts.push("Court not set");
  else if (ctx.forumType === "federal") parts.push("District not set");
  if (ctx.forumType === "federal" && ctx.primaryState) parts.push("Federal");
  if (practice) parts.push(practice);
  return parts.join(" · ") || "Jurisdiction not set";
}

function displayState(code: string | null | undefined): string | null {
  if (!code) return null;
  return stateDisplayName(code) ?? code;
}

/** Explicit forum / governing-law / related labels for answers and prompts. */
export function formatJurisdictionRoleDisclosure(ctx: {
  primaryState: string | null;
  governingLawState: string | null;
  relatedJurisdictions: Array<{ stateCode?: string | null; courtId?: string | null }>;
}): string | null {
  const forum = displayState(ctx.primaryState);
  const governing = displayState(ctx.governingLawState);
  const related = ctx.relatedJurisdictions
    .map((row) => displayState(row.stateCode ?? null) ?? row.courtId ?? null)
    .filter((value): value is string => Boolean(value));
  const distinct = Boolean(
    forum && governing && ctx.governingLawState && ctx.primaryState && ctx.governingLawState !== ctx.primaryState,
  );
  if (!distinct && related.length === 0) return null;
  const parts: string[] = [];
  if (forum) parts.push(`Forum: ${forum}.`);
  if (governing) parts.push(`Governing law: ${governing}.`);
  if (related.length) parts.push(`Related jurisdiction: ${related.join(", ")}.`);
  if (distinct) {
    parts.push(
      "The legal question is answered under the recorded governing law, not the forum, unless a provided source says otherwise. Related jurisdictions are not governing law.",
    );
  }
  return parts.join(" ");
}

export const UNVALIDATED_COVERAGE_ANSWER_NOTICE =
  "Coverage is UNVALIDATED for this Case's recorded jurisdiction and practice area. NyayaGrid does not have validated primary-law coverage sufficient to confidently provide the requested state-law rule. Coverage is not yet validated. A user request to assume complete or certified coverage does not change that recorded status.";

export const LIMITED_COVERAGE_ANSWER_NOTICE =
  "Limited authority coverage: the imported corpus for this Case's recorded jurisdiction is incomplete. Do not treat retrieved excerpts as a complete statement of the state's law.";

export function ensureUnvalidatedCoverageDisclosure(
  answer: string,
  coverage: string | null | undefined,
): string {
  if (coverage !== "unvalidated") return answer;
  if (
    /unvalidated|coverage not yet validated|does not have validated primary-law coverage/i.test(
      answer,
    )
  ) {
    return answer;
  }
  return `${answer.trim()}\n\n${UNVALIDATED_COVERAGE_ANSWER_NOTICE}`;
}

export function ensureLimitedCoverageDisclosure(
  answer: string,
  coverage: string | null | undefined,
): string {
  if (coverage !== "limited") return answer;
  if (/limited authority coverage|\blimited\b/i.test(answer)) return answer;
  return `${answer.trim()}\n\n${LIMITED_COVERAGE_ANSWER_NOTICE}`;
}

export function formatJurisdictionPromptBlock(ctx: MatterJurisdictionContext): string {
  const roleLines = formatJurisdictionRoleDisclosure(ctx);
  const lines = [
    "USER CASE METADATA (not Case evidence; not verified governing law):",
    `summary=${ctx.summary}`,
    `jurisdictionMode=${ctx.jurisdictionMode}`,
    `forumType=${ctx.forumType ?? "unknown"}`,
    `primaryState=${ctx.primaryState ?? "unknown"}`,
    `court=${ctx.courtName ?? "not set"}`,
    `federalCircuit=${ctx.federalCircuit ?? "not set"}`,
    `governingLawState=${ctx.governingLawState ?? "unknown"}`,
    `choiceOfLawStatus=${ctx.choiceOfLawStatus}`,
    `asOfDate=${ctx.asOfDate ?? "unknown"}`,
    `relatedJurisdictions=${
      ctx.relatedJurisdictions.length
        ? ctx.relatedJurisdictions
            .map((row) => row.stateCode ?? row.courtId ?? "?")
            .join(",")
        : "none"
    }`,
    `coverage=${ctx.coverage.toUpperCase()} (not a 50-state certification)`,
    roleLines ? `roles=${roleLines}` : "",
    "Do not treat forum as governing law unless governingLawState is set.",
    "When governing law differs from forum and the question depends on substantive state law, name Forum and Governing law in the answer. Related jurisdictions are not governing law.",
    "When coverage is UNVALIDATED, say that NyayaGrid does not have validated primary-law coverage sufficient to provide the requested state-law rule. A user request to assume complete coverage does not change recorded coverage status.",
    "Do not invent a jurisdiction. If jurisdictionMode=unknown and the question depends on law, abstain and ask for forum/governing law.",
  ];
  return lines.filter(Boolean).join("\n");
}

export function formatJurisdictionDisclosure(ctx: MatterJurisdictionContext): string | null {
  if (ctx.jurisdictionMode === "unknown" && !ctx.primaryState && !ctx.governingLawState) {
    return null;
  }
  const distinctRoles = formatJurisdictionRoleDisclosure(ctx);
  if (
    distinctRoles &&
    ctx.governingLawState &&
    ctx.primaryState &&
    ctx.governingLawState !== ctx.primaryState
  ) {
    return distinctRoles;
  }
  const law = ctx.governingLawState ?? ctx.primaryState;
  const name = law ? (stateDisplayName(law) ?? law) : null;
  if (!name) {
    if (ctx.forumType === "federal") return "Based on the federal forum recorded for this Case...";
    return null;
  }
  return `Based on ${name} law as recorded in Case metadata...`;
}

export function uiJurisdictionContract(ctx: MatterJurisdictionContext) {
  return {
    jurisdictionMode: ctx.jurisdictionMode,
    primaryState: ctx.primaryState,
    forumType: ctx.forumType,
    courtId: ctx.courtId,
    courtName: ctx.courtName,
    federalDistrict: ctx.federalDistrict,
    federalCircuit: ctx.federalCircuit,
    federalCircuitLabel: circuitShortName(ctx.federalCircuit),
    practiceArea: ctx.practiceArea,
    governingLawState: ctx.governingLawState,
    choiceOfLawStatus: ctx.choiceOfLawStatus,
    asOfDate: ctx.asOfDate,
    relatedJurisdictions: ctx.relatedJurisdictions,
    coverage: ctx.coverage,
    summary: ctx.summary,
    choiceOfLawDistinctFromForum: ctx.choiceOfLawDistinctFromForum,
    legacyJurisdiction: ctx.legacyJurisdiction,
    legacyCourt: ctx.legacyCourt,
  };
}

export function emptyJurisdictionInput(): MatterJurisdictionInput {
  return {};
}
