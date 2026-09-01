/** Client-safe helpers for Case jurisdiction UX — presentation only; legal logic lives in @nyayagrid/jurisdiction. */

export type UiJurisdictionContract = {
  jurisdictionMode: string;
  primaryState: string | null;
  forumType: string | null;
  courtId: string | null;
  courtName: string | null;
  federalDistrict: string | null;
  federalCircuit: string | null;
  federalCircuitLabel: string | null;
  practiceArea: string | null;
  governingLawState: string | null;
  choiceOfLawStatus: string | null;
  asOfDate: string | null;
  relatedJurisdictions: Array<{ stateCode?: string | null; courtId?: string | null }>;
  coverage: string;
  summary: string;
  choiceOfLawDistinctFromForum: boolean;
  legacyJurisdiction: string | null;
  legacyCourt: string | null;
};

export type JurisdictionStateOption = { code: string; name: string };
export type JurisdictionCourtOption = {
  id: string;
  name: string;
  shortName: string | null;
  jurisdictionType: string;
  state: string | null;
  level: string;
  federalCircuit: string | null;
  federalCircuitLabel: string | null;
};

export const FORUM_TYPE_OPTIONS = [
  { value: "state", label: "State" },
  { value: "federal", label: "Federal" },
  { value: "administrative", label: "Administrative" },
  { value: "other", label: "Other" },
] as const;

export const CHOICE_OF_LAW_OPTIONS = [
  { value: "none_known", label: "None known" },
  { value: "possible", label: "Possible" },
  { value: "stated", label: "Stated in documents" },
  { value: "disputed", label: "Disputed" },
  { value: "unknown", label: "Unknown" },
] as const;

/** Honest coverage copy — never "Certified" unless Phase 6T certifies (not this phase). */
export function coverageStatusLabel(status: string | null | undefined): string {
  if (status === "supported") return "Supported coverage";
  if (status === "limited") return "Limited authority coverage";
  return "Coverage not yet validated";
}

export function coverageMustNotSayCertified(status: string | null | undefined): boolean {
  const label = coverageStatusLabel(status);
  return !/certified/i.test(label);
}

export function isJurisdictionUnset(ctx: UiJurisdictionContract | null | undefined): boolean {
  if (!ctx) return true;
  return (
    ctx.summary === "Jurisdiction not set" ||
    (ctx.jurisdictionMode === "unknown" &&
      !ctx.primaryState &&
      !ctx.courtId &&
      !ctx.governingLawState &&
      ctx.forumType !== "federal")
  );
}

/** Header line from backend summary; appends related count without inventing legal mappings. */
export function compactJurisdictionHeaderLine(ctx: UiJurisdictionContract | null | undefined): string {
  if (!ctx?.summary) return "Jurisdiction not set";
  const related = ctx.relatedJurisdictions?.filter((row) => row.stateCode || row.courtId) ?? [];
  if (related.length === 0) return ctx.summary;
  const suffix = related.length === 1 ? "+1 related" : `+${related.length} related`;
  if (ctx.summary.includes(suffix)) return ctx.summary;
  return `${ctx.summary} · ${suffix}`;
}

export function filterSelectOptions<T extends { label: string; value: string; searchText?: string }>(
  options: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((option) => {
    const haystack = (option.searchText ?? `${option.label} ${option.value}`).toLowerCase();
    return haystack.includes(q);
  });
}

export function stateSelectOptions(states: JurisdictionStateOption[]) {
  return states.map((state) => ({
    value: state.code,
    label: state.name,
    searchText: `${state.name} ${state.code}`,
  }));
}

export function courtSelectOptions(courts: JurisdictionCourtOption[]) {
  return courts.map((court) => ({
    value: court.id,
    label: court.name,
    searchText: `${court.name} ${court.shortName ?? ""} ${court.id}`,
    federalCircuitLabel: court.federalCircuitLabel,
  }));
}

export function forumDisplayLabel(forumType: string | null | undefined): string | null {
  return FORUM_TYPE_OPTIONS.find((row) => row.value === forumType)?.label ?? null;
}
