import { and, eq } from "@nyayagrid/database";
import type { Database } from "@nyayagrid/database";
import { matters } from "@nyayagrid/database";
import { applyMatterJurisdictionInput } from "./apply";
import { lookupJurisdictionCoverage } from "./coverage";
import { formatJurisdictionPromptBlock, formatJurisdictionSummary } from "./format";
import { normalizeCourtId, normalizeStateCode } from "./normalize";
import { getCourtById } from "./registry";
import type {
  ChoiceOfLawStatus,
  ForumType,
  JurisdictionMode,
  JurisdictionSource,
  MatterJurisdictionContext,
  RelatedJurisdiction,
} from "./types";

function asMode(value: string | null): JurisdictionMode {
  if (value === "state" || value === "federal" || value === "multi_jurisdiction" || value === "unknown") {
    return value;
  }
  return "unknown";
}

function asForum(value: string | null): ForumType | null {
  if (value === "state" || value === "federal" || value === "administrative" || value === "other") {
    return value;
  }
  return null;
}

function asChoice(value: string | null): ChoiceOfLawStatus {
  if (
    value === "none_known" ||
    value === "possible" ||
    value === "stated" ||
    value === "disputed" ||
    value === "unknown"
  ) {
    return value;
  }
  return "unknown";
}

function toDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

/**
 * Read structured Case jurisdiction. Legacy free-text is preserved.
 * Exact state/court aliases may fill forum fields; they never become governing law.
 */
export async function resolveMatterJurisdictionContext(params: {
  db: Database;
  organizationId: string;
  matterId: string;
}): Promise<MatterJurisdictionContext | null> {
  const [matter] = await params.db
    .select()
    .from(matters)
    .where(and(eq(matters.id, params.matterId), eq(matters.organizationId, params.organizationId)))
    .limit(1);
  if (!matter) return null;

  let courtId = matter.courtId ?? null;
  let primaryState = matter.primaryState ?? null;
  let forumType = asForum(matter.forumType);
  let source: JurisdictionSource =
    matter.jurisdictionSource === "user_metadata" ? "user_metadata" : "legacy_unstructured";

  if (!courtId && matter.court) {
    courtId = normalizeCourtId(matter.court);
  }
  if (!primaryState && matter.jurisdiction) {
    primaryState = normalizeStateCode(matter.jurisdiction);
  }
  const court = getCourtById(courtId);
  if (court) {
    courtId = court.id;
    if (!primaryState) primaryState = court.state;
    if (!forumType) {
      forumType =
        court.jurisdictionType === "federal"
          ? "federal"
          : court.jurisdictionType === "administrative"
            ? "administrative"
            : "state";
    }
  }

  const related = Array.isArray(matter.relatedJurisdictions)
    ? (matter.relatedJurisdictions as RelatedJurisdiction[])
    : [];
  let jurisdictionMode = asMode(matter.jurisdictionMode);
  if (jurisdictionMode === "unknown" && (courtId || primaryState || forumType)) {
    const derived = applyMatterJurisdictionInput({
      forumType,
      primaryState,
      courtId,
      governingLawState: matter.governingLawState,
      relatedJurisdictions: related,
    });
    jurisdictionMode = derived.jurisdictionMode;
    forumType = derived.forumType;
  }

  const coverage = await lookupJurisdictionCoverage({
    db: params.db,
    stateCode: primaryState,
    forumType: forumType ?? (court?.jurisdictionType === "federal" ? "federal" : "state"),
    practiceArea: matter.practiceArea,
  });

  const ctx: MatterJurisdictionContext = {
    matterId: matter.id,
    organizationId: matter.organizationId,
    jurisdictionMode,
    forumType,
    primaryState,
    courtId,
    courtName: matter.courtName ?? court?.name ?? null,
    federalDistrict: matter.federalDistrict ?? (court?.level === "district" ? court.id : null),
    federalCircuit: matter.federalCircuit ?? court?.federalCircuit ?? null,
    practiceArea: matter.practiceArea,
    asOfDate: toDay(matter.asOfDate),
    governingLawState: matter.governingLawState,
    choiceOfLawStatus: asChoice(matter.choiceOfLawStatus),
    relatedJurisdictions: related,
    source: courtId || primaryState || matter.jurisdictionMode ? (matter.jurisdictionSource === "user_metadata" ? "user_metadata" : source) : "legacy_unstructured",
    legacyJurisdiction: matter.jurisdiction,
    legacyCourt: matter.court,
    coverage: coverage.status,
    coverageByPracticeArea: coverage.byPracticeArea,
    choiceOfLawDistinctFromForum: Boolean(
      matter.governingLawState && primaryState && matter.governingLawState !== primaryState,
    ),
    summary: "",
    promptBlock: "",
  };
  ctx.summary = formatJurisdictionSummary(ctx);
  ctx.promptBlock = formatJurisdictionPromptBlock(ctx);
  return ctx;
}

export function jurisdictionColumnsFromNormalized(normalized: ReturnType<typeof applyMatterJurisdictionInput>) {
  return {
    jurisdictionMode: normalized.jurisdictionMode,
    primaryState: normalized.primaryState,
    forumType: normalized.forumType,
    courtId: normalized.courtId,
    courtName: normalized.courtName,
    federalDistrict: normalized.federalDistrict,
    federalCircuit: normalized.federalCircuit,
    governingLawState: normalized.governingLawState,
    choiceOfLawStatus: normalized.choiceOfLawStatus,
    asOfDate: normalized.asOfDate,
    relatedJurisdictions: normalized.relatedJurisdictions,
    jurisdictionSource: normalized.jurisdictionSource,
    jurisdiction: normalized.jurisdiction,
    court: normalized.court,
    practiceArea: normalized.practiceArea,
  };
}
