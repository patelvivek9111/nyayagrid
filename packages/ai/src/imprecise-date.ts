/**
 * Deterministic reject for “imprecise date vs exact date in the same period”
 * (e.g. “end of February” vs February 28). Used after model parse so contradiction
 * false positives do not depend on the model obeying the prompt.
 */

type DualSidedCandidate = {
  sideA: { chunkIds: string[] };
  sideB: { chunkIds: string[] };
};

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MONTH_ALT = Object.keys(MONTHS).join("|");

const EXACT_DATE_RE = new RegExp(
  `\\b(${MONTH_ALT})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`,
  "gi",
);

const IMPRECISE_END_RE = new RegExp(
  `\\b(?:(?:around|approximately|about)\\s+(?:the\\s+)?)?(?:the\\s+)?(end|beginning|start|middle)\\s+of\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?\\b`,
  "gi",
);

const IMPRECISE_LATE_EARLY_RE = new RegExp(
  `\\b(late|early|mid-?)\\s+(${MONTH_ALT})(?:\\s+(\\d{4}))?\\b`,
  "gi",
);

const ON_OR_ABOUT_RE = new RegExp(
  `\\bon\\s+or\\s+about\\s+(${MONTH_ALT})\\s+(\\d{1,2}),\\s+(\\d{4})\\b`,
  "gi",
);

export type ExactCalendarDate = {
  month: number;
  day: number;
  year: number;
};

export type ImpreciseDateWindow = {
  month: number;
  year: number | null;
  kind: "end" | "early" | "mid" | "about" | "month";
  day: number | null;
};

function monthIndex(name: string): number | null {
  const idx = MONTHS[name.toLowerCase()];
  return idx === undefined ? null : idx;
}

export function extractExactDates(text: string): ExactCalendarDate[] {
  const found: ExactCalendarDate[] = [];
  for (const match of text.matchAll(EXACT_DATE_RE)) {
    const month = monthIndex(match[1] ?? "");
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) continue;
    found.push({ month, day, year });
  }
  return found;
}

export function extractImpreciseWindows(text: string): ImpreciseDateWindow[] {
  const windows: ImpreciseDateWindow[] = [];

  for (const match of text.matchAll(IMPRECISE_END_RE)) {
    const month = monthIndex(match[2] ?? "");
    if (month == null) continue;
    const span = (match[1] ?? "").toLowerCase();
    const kind: ImpreciseDateWindow["kind"] =
      span === "end" ? "end" : span === "middle" ? "mid" : "early";
    windows.push({
      month,
      year: match[3] ? Number(match[3]) : null,
      kind,
      day: null,
    });
  }

  for (const match of text.matchAll(IMPRECISE_LATE_EARLY_RE)) {
    const month = monthIndex(match[2] ?? "");
    if (month == null) continue;
    const span = (match[1] ?? "").toLowerCase();
    windows.push({
      month,
      year: match[3] ? Number(match[3]) : null,
      kind: span.startsWith("late") ? "end" : span.startsWith("mid") ? "mid" : "early",
      day: null,
    });
  }

  for (const match of text.matchAll(ON_OR_ABOUT_RE)) {
    const month = monthIndex(match[1] ?? "");
    const day = Number(match[2]);
    const year = Number(match[3]);
    if (month == null || !Number.isFinite(day) || !Number.isFinite(year)) continue;
    windows.push({ month, year, kind: "about", day });
  }

  return windows;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export function impreciseWindowCoversDate(
  window: ImpreciseDateWindow,
  exact: ExactCalendarDate,
): boolean {
  if (window.month !== exact.month) return false;
  if (window.year != null && window.year !== exact.year) return false;
  const year = window.year ?? exact.year;
  const last = daysInMonth(year, window.month);
  let start = 1;
  let end = last;
  if (window.kind === "end") {
    start = Math.max(1, last - 9);
  } else if (window.kind === "early") {
    end = Math.min(10, last);
  } else if (window.kind === "mid") {
    start = 11;
    end = Math.min(20, last);
  } else if (window.kind === "about" && window.day != null) {
    start = Math.max(1, window.day - 2);
    end = Math.min(last, window.day + 2);
  }
  return exact.day >= start && exact.day <= end;
}

function datesEqual(a: ExactCalendarDate, b: ExactCalendarDate): boolean {
  return a.month === b.month && a.day === b.day && a.year === b.year;
}

function hasConflictingExactDates(a: ExactCalendarDate[], b: ExactCalendarDate[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  return a.some((left) => b.some((right) => !datesEqual(left, right)));
}

/**
 * True when one side states an exact calendar date and the other only restates
 * that same period imprecisely (end of month, late, on or about). False when
 * two exact dates conflict (February 28 vs March 3).
 */
export function isImpreciseDateRestatement(textA: string, textB: string): boolean {
  const exactA = extractExactDates(textA);
  const exactB = extractExactDates(textB);
  const impA = extractImpreciseWindows(textA);
  const impB = extractImpreciseWindows(textB);

  if (hasConflictingExactDates(exactA, exactB)) return false;

  const coveredBy = (exacts: ExactCalendarDate[], windows: ImpreciseDateWindow[]) =>
    exacts.length > 0 &&
    windows.length > 0 &&
    exacts.every((exact) => windows.some((window) => impreciseWindowCoversDate(window, exact)));

  if (exactA.length > 0 && exactB.length === 0 && coveredBy(exactA, impB)) return true;
  if (exactB.length > 0 && exactA.length === 0 && coveredBy(exactB, impA)) return true;

  if (exactA.length > 0 && exactB.length > 0 && !hasConflictingExactDates(exactA, exactB)) {
    if (impA.length > 0 || impB.length > 0) {
      return coveredBy(exactA, [...impA, ...impB]) || coveredBy(exactB, [...impA, ...impB]);
    }
  }

  return false;
}

function joinChunkText(chunkIds: string[], chunkTextById: Map<string, string>): string {
  return chunkIds
    .map((id) => chunkTextById.get(id) ?? "")
    .filter(Boolean)
    .join("\n");
}

export function filterImpreciseDateContradictionCandidates<T extends DualSidedCandidate>(
  candidates: T[],
  chunkTextById: Map<string, string>,
): T[] {
  return candidates.filter((candidate) => {
    const textA = joinChunkText(candidate.sideA.chunkIds, chunkTextById);
    const textB = joinChunkText(candidate.sideB.chunkIds, chunkTextById);
    if (!textA.trim() || !textB.trim()) return true;
    return !isImpreciseDateRestatement(textA, textB);
  });
}
