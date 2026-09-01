import { US_STATES } from "./states";
import { COURT_REGISTRY, getCourtById } from "./registry";
import type { CourtRecord } from "./types";

export function canonKey(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/united states/g, "us")
    .replace(/u\.s\./g, "us")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

const STATE_ALIAS_MAP = new Map<string, string>();
for (const state of US_STATES) {
  STATE_ALIAS_MAP.set(canonKey(state.code), state.code);
  for (const alias of state.aliases) {
    STATE_ALIAS_MAP.set(canonKey(alias), state.code);
  }
}

const COURT_ALIAS_MAP = new Map<string, string[]>();
function addCourtAlias(key: string, courtId: string) {
  if (!key) return;
  const existing = COURT_ALIAS_MAP.get(key) ?? [];
  if (!existing.includes(courtId)) existing.push(courtId);
  COURT_ALIAS_MAP.set(key, existing);
}

for (const court of COURT_REGISTRY) {
  addCourtAlias(canonKey(court.id), court.id);
  addCourtAlias(canonKey(court.name), court.id);
  addCourtAlias(canonKey(court.shortName), court.id);
  for (const alias of court.aliases) {
    addCourtAlias(canonKey(alias), court.id);
  }
}

export function normalizeStateCode(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const code = STATE_ALIAS_MAP.get(canonKey(value));
  return code ?? null;
}

/**
 * Map a court string to a canonical id only when the alias is unique.
 * Ambiguous historical strings return null and the original value must be kept.
 */
export function normalizeCourtId(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const direct = getCourtById(value.trim());
  if (direct) return direct.id;
  const matches = COURT_ALIAS_MAP.get(canonKey(value));
  if (!matches || matches.length !== 1) return null;
  return matches[0] ?? null;
}

export function resolveCourtRecord(value: string | null | undefined): CourtRecord | null {
  const id = normalizeCourtId(value);
  return id ? getCourtById(id) : null;
}
