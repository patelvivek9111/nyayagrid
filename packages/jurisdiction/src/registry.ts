import { ALL_STATE_COURTS } from "./courts-state";
import { FEDERAL_COURTS, FEDERAL_CIRCUITS, circuitShortName } from "./courts-federal";
import { US_STATES } from "./states";
import type { CourtRecord, ForumType } from "./types";

export { FEDERAL_COURTS, FEDERAL_CIRCUITS, circuitShortName } from "./courts-federal";
export { ALL_STATE_COURTS, STATE_COURTS } from "./courts-state";

export const COURT_REGISTRY: CourtRecord[] = [...FEDERAL_COURTS, ...ALL_STATE_COURTS];

const COURTS_BY_ID = new Map(COURT_REGISTRY.map((court) => [court.id, court]));

export function getCourtById(id: string | null | undefined): CourtRecord | null {
  if (!id) return null;
  return COURTS_BY_ID.get(id) ?? null;
}

export function listCourts(filter?: {
  state?: string | null;
  forumType?: ForumType | null;
  activeOnly?: boolean;
}): CourtRecord[] {
  const state = filter?.state?.toUpperCase() ?? null;
  const forum = filter?.forumType ?? null;
  return COURT_REGISTRY.filter((court) => {
    if (filter?.activeOnly !== false && !court.active) return false;
    if (forum === "federal") {
      if (court.jurisdictionType !== "federal") return false;
      if (state) return court.level === "district" && court.state === state;
      return court.level === "district" || court.level === "circuit" || court.level === "scotus";
    }
    if (forum === "state") {
      if (court.jurisdictionType !== "state") return false;
      if (state) return court.state === state;
      return true;
    }
    if (forum === "administrative") return court.jurisdictionType === "administrative";
    if (state) return court.state === state;
    return true;
  });
}

export function listFederalDistrictsForState(stateCode: string): CourtRecord[] {
  const code = stateCode.toUpperCase();
  return FEDERAL_COURTS.filter((court) => court.level === "district" && court.state === code);
}

export function deriveCircuitFromCourtId(courtId: string): string | null {
  return getCourtById(courtId)?.federalCircuit ?? null;
}

export function stateDisplayName(code: string | null | undefined): string | null {
  if (!code) return null;
  return US_STATES.find((state) => state.code === code.toUpperCase())?.name ?? null;
}
