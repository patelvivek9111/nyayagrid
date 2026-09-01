import { getCourtById } from "./registry";
import { normalizeCourtId, normalizeStateCode } from "./normalize";

/** Persist structured authority court identity when import metadata can be matched uniquely. */
export function structuredAuthorityFields(input: {
  court?: string | null;
  jurisdiction?: string | null;
  courtId?: string | null;
  authorityState?: string | null;
  federalCircuit?: string | null;
  courtLevel?: string | null;
}) {
  const court = input.courtId
    ? getCourtById(input.courtId)
    : getCourtById(normalizeCourtId(input.court));
  const authorityState =
    (input.authorityState ? normalizeStateCode(input.authorityState) : null) ??
    court?.state ??
    (input.jurisdiction ? normalizeStateCode(input.jurisdiction) : null);
  return {
    courtId: court?.id ?? input.courtId ?? null,
    authorityState,
    federalCircuit: input.federalCircuit ?? court?.federalCircuit ?? null,
    courtLevel: input.courtLevel ?? court?.level ?? null,
  };
}
