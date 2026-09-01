import { getCourtById } from "./registry";
import { normalizeCourtId, normalizeStateCode } from "./normalize";
import { US_STATES } from "./states";
import {
  InvalidJurisdictionError,
  type ChoiceOfLawStatus,
  type ForumType,
  type JurisdictionMode,
  type JurisdictionSource,
  type MatterJurisdictionInput,
  type RelatedJurisdiction,
} from "./types";

export type NormalizedMatterJurisdiction = {
  jurisdictionMode: JurisdictionMode;
  forumType: ForumType | null;
  primaryState: string | null;
  courtId: string | null;
  courtName: string | null;
  federalDistrict: string | null;
  federalCircuit: string | null;
  governingLawState: string | null;
  choiceOfLawStatus: ChoiceOfLawStatus;
  asOfDate: string | null;
  relatedJurisdictions: RelatedJurisdiction[];
  practiceArea: string | null;
  jurisdiction: string | null;
  court: string | null;
  jurisdictionSource: JurisdictionSource;
};

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function isChoiceOfLawStatus(value: string | null | undefined): value is ChoiceOfLawStatus {
  return (
    value === "none_known" ||
    value === "possible" ||
    value === "stated" ||
    value === "disputed" ||
    value === "unknown"
  );
}

function normalizeRelated(rows: RelatedJurisdiction[] | null | undefined): RelatedJurisdiction[] {
  if (!rows?.length) return [];
  const out: RelatedJurisdiction[] = [];
  for (const row of rows) {
    const stateCode = row.stateCode ? normalizeStateCode(row.stateCode) : null;
    const courtId = row.courtId ? normalizeCourtId(row.courtId) : null;
    if (row.courtId && !courtId && !normalizeStateCode(row.stateCode ?? null) && !stateCode) {
      throw new InvalidJurisdictionError(`Unknown related court: ${row.courtId}`);
    }
    if (!stateCode && !courtId) continue;
    out.push({ stateCode, courtId });
  }
  return out;
}

export function deriveJurisdictionMode(params: {
  forumType: ForumType | null;
  primaryState: string | null;
  courtId: string | null;
  governingLawState: string | null;
  relatedJurisdictions: RelatedJurisdiction[];
}): JurisdictionMode {
  const relatedStates = new Set(
    params.relatedJurisdictions
      .map((row) => row.stateCode)
      .filter((code): code is string => Boolean(code)),
  );
  const hasRelated =
    relatedStates.size > 0 &&
    (relatedStates.size > 1 ||
      !params.primaryState ||
      !relatedStates.has(params.primaryState) ||
      params.relatedJurisdictions.some((row) => row.courtId));
  const distinctGoverning =
    Boolean(params.governingLawState) &&
    Boolean(params.primaryState) &&
    params.governingLawState !== params.primaryState;
  if (hasRelated || distinctGoverning) return "multi_jurisdiction";
  if (params.forumType === "federal" || params.courtId?.startsWith("us-")) return "federal";
  if (params.forumType === "state" || params.primaryState) return "state";
  if (params.forumType === "administrative" || params.forumType === "other") {
    return params.primaryState ? "state" : "unknown";
  }
  return "unknown";
}

export function applyMatterJurisdictionInput(
  input: MatterJurisdictionInput,
  existing?: Partial<NormalizedMatterJurisdiction> | null,
): NormalizedMatterJurisdiction {
  const courtIdRaw = input.courtId !== undefined ? input.courtId : existing?.courtId ?? null;
  const court = courtIdRaw ? getCourtById(courtIdRaw) ?? (() => {
    const id = normalizeCourtId(courtIdRaw);
    return id ? getCourtById(id) : null;
  })() : null;
  if (courtIdRaw && !court) {
    throw new InvalidJurisdictionError(`Unknown courtId: ${courtIdRaw}`);
  }

  let primaryState =
    input.primaryState !== undefined
      ? input.primaryState
        ? normalizeStateCode(input.primaryState)
        : null
      : existing?.primaryState ?? null;
  if (input.primaryState && !primaryState) {
    throw new InvalidJurisdictionError(`Unknown primaryState: ${input.primaryState}`);
  }
  if (court?.state) {
    if (primaryState && primaryState !== court.state) {
      throw new InvalidJurisdictionError(
        `Court ${court.id} is associated with ${court.state}, not ${primaryState}`,
      );
    }
    primaryState = court.state;
  }

  let forumType: ForumType | null =
    input.forumType !== undefined ? input.forumType : existing?.forumType ?? null;
  if (court?.jurisdictionType === "federal") forumType = "federal";
  if (court?.jurisdictionType === "state") forumType = "state";
  if (court?.jurisdictionType === "administrative") forumType = "administrative";

  const federalCircuit = court?.federalCircuit ?? (forumType === "federal" ? existing?.federalCircuit ?? null : null);
  if (court?.level === "district" && court.federalCircuit) {
    // Circuit is derived from the district. Callers cannot store a conflicting circuit.
  }

  if (input.federalCircuit) {
    assertFederalCircuitConsistent(court?.id ?? null, input.federalCircuit);
  }
  if (court?.federalCircuit && input.federalCircuit && court.federalCircuit !== input.federalCircuit) {
    throw new InvalidJurisdictionError(
      `Court ${court.shortName} is in the ${court.federalCircuit} Circuit, not ${input.federalCircuit}`,
    );
  }

  const governingLawState =
    input.governingLawState !== undefined
      ? input.governingLawState
        ? normalizeStateCode(input.governingLawState)
        : null
      : existing?.governingLawState ?? null;
  if (input.governingLawState && input.governingLawState.trim() && !governingLawState) {
    throw new InvalidJurisdictionError(`Unknown governingLawState: ${input.governingLawState}`);
  }

  const relatedJurisdictions =
    input.relatedJurisdictions !== undefined
      ? normalizeRelated(input.relatedJurisdictions)
      : existing?.relatedJurisdictions ?? [];

  const choiceOfLawStatus: ChoiceOfLawStatus = isChoiceOfLawStatus(input.choiceOfLawStatus)
    ? input.choiceOfLawStatus
    : existing?.choiceOfLawStatus ?? (governingLawState ? "stated" : "none_known");

  const asOfDate =
    input.asOfDate !== undefined
      ? input.asOfDate
      : existing
        ? (existing.asOfDate ?? null)
        : todayUtcDate();

  const practiceArea =
    input.practiceArea !== undefined ? input.practiceArea : existing?.practiceArea ?? null;

  const jurisdictionMode = deriveJurisdictionMode({
    forumType,
    primaryState,
    courtId: court?.id ?? null,
    governingLawState,
    relatedJurisdictions,
  });

  const stateName = US_STATES.find((state) => state.code === primaryState)?.name ?? null;
  const displayJurisdiction =
    input.jurisdiction !== undefined
      ? input.jurisdiction
      : court?.jurisdictionType === "federal"
        ? stateName
          ? `Federal — ${stateName}`
          : "Federal"
        : stateName ?? existing?.jurisdiction ?? null;
  const displayCourt =
    input.court !== undefined ? input.court : court?.name ?? existing?.court ?? null;

  return {
    jurisdictionMode,
    forumType,
    primaryState,
    courtId: court?.id ?? null,
    courtName: court?.name ?? null,
    federalDistrict: court?.level === "district" ? court.id : null,
    federalCircuit: court?.federalCircuit ?? (forumType === "federal" ? federalCircuit : null),
    governingLawState,
    choiceOfLawStatus,
    asOfDate,
    relatedJurisdictions,
    practiceArea,
    jurisdiction: displayJurisdiction,
    court: displayCourt,
    jurisdictionSource: "user_metadata",
  };
}

export function jurisdictionInputFromBody(body: {
  forumType?: ForumType | null;
  primaryState?: string | null;
  courtId?: string | null;
  federalCircuit?: string | null;
  governingLawState?: string | null;
  choiceOfLawStatus?: ChoiceOfLawStatus | null;
  asOfDate?: string | null;
  relatedJurisdictions?: RelatedJurisdiction[] | null;
  practiceArea?: string | null;
  jurisdiction?: string | null;
  court?: string | null;
}): MatterJurisdictionInput {
  return {
    forumType: body.forumType,
    primaryState: body.primaryState,
    courtId: body.courtId,
    federalCircuit: body.federalCircuit,
    governingLawState: body.governingLawState,
    choiceOfLawStatus: body.choiceOfLawStatus,
    asOfDate: body.asOfDate,
    relatedJurisdictions: body.relatedJurisdictions,
    practiceArea: body.practiceArea,
    jurisdiction: body.jurisdiction,
    court: body.court,
  };
}

export function existingJurisdictionFromMatter(matter: {
  jurisdictionMode?: string | null;
  forumType?: string | null;
  primaryState?: string | null;
  courtId?: string | null;
  courtName?: string | null;
  federalDistrict?: string | null;
  federalCircuit?: string | null;
  governingLawState?: string | null;
  choiceOfLawStatus?: string | null;
  asOfDate?: string | Date | null;
  relatedJurisdictions?: RelatedJurisdiction[] | null;
  practiceArea?: string | null;
  jurisdiction?: string | null;
  court?: string | null;
}): Partial<NormalizedMatterJurisdiction> {
  return {
    jurisdictionMode: (matter.jurisdictionMode as NormalizedMatterJurisdiction["jurisdictionMode"]) ?? "unknown",
    forumType: (matter.forumType as ForumType | null) ?? null,
    primaryState: matter.primaryState ?? null,
    courtId: matter.courtId ?? null,
    courtName: matter.courtName ?? null,
    federalDistrict: matter.federalDistrict ?? null,
    federalCircuit: matter.federalCircuit ?? null,
    governingLawState: matter.governingLawState ?? null,
    choiceOfLawStatus: (matter.choiceOfLawStatus as ChoiceOfLawStatus) ?? "unknown",
    asOfDate:
      matter.asOfDate instanceof Date
        ? matter.asOfDate.toISOString().slice(0, 10)
        : (matter.asOfDate ?? null),
    relatedJurisdictions: matter.relatedJurisdictions ?? [],
    practiceArea: matter.practiceArea ?? null,
    jurisdiction: matter.jurisdiction ?? null,
    court: matter.court ?? null,
    jurisdictionSource: "user_metadata",
  };
}

export function assertFederalCircuitConsistent(courtId: string | null, circuit: string | null): void {
  if (!courtId || !circuit) return;
  const court = getCourtById(courtId);
  if (court?.federalCircuit && court.federalCircuit !== circuit) {
    throw new InvalidJurisdictionError(
      `Court ${court.shortName} is in the ${court.federalCircuit} Circuit, not ${circuit}`,
    );
  }
}
