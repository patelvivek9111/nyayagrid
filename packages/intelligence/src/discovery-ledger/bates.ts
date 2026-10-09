/**
 * Conservative Bates parsing and range review signals.
 * Does not invent missing Bates numbers or treat gaps as legal deficiencies.
 */

import type { BatesRange, BatesReviewSignal, DiscoveryProduction } from "./types";

const SINGLE = /\b([A-Za-z]{1,12})[-_]?(\d{3,12})\b/;
const RANGE = /\b([A-Za-z]{1,12})[-_]?(\d{3,12})\s*[–—-]\s*(?:\1[-_]?)?(\d{3,12})\b/;

export type ParsedBatesRange = {
  prefix: string;
  start: number;
  end: number;
  rawText: string;
};

export function parseBatesRangeText(raw: string): ParsedBatesRange | null {
  const text = raw.trim();
  if (!text) return null;
  const range = text.match(RANGE);
  if (range) {
    const prefix = range[1]!.toUpperCase();
    const start = Number(range[2]);
    const end = Number(range[3]);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return { prefix, start, end, rawText: text };
  }
  const single = text.match(SINGLE);
  if (!single) return null;
  const prefix = single[1]!.toUpperCase();
  const n = Number(single[2]);
  if (!Number.isFinite(n)) return null;
  return { prefix, start: n, end: n, rawText: text };
}

export function formatBatesNumber(prefix: string, n: number, width = 6): string {
  return `${prefix}${String(n).padStart(width, "0")}`;
}

function hasNumericBounds(range: BatesRange): range is BatesRange & { start: number; end: number } {
  return typeof range.start === "number" && typeof range.end === "number";
}

function overlaps(a: BatesRange & { start: number; end: number }, b: BatesRange & { start: number; end: number }): boolean {
  if (a.prefix.toUpperCase() !== b.prefix.toUpperCase()) return false;
  return a.start <= b.end && b.start <= a.end;
}

function identical(a: BatesRange & { start: number; end: number }, b: BatesRange & { start: number; end: number }): boolean {
  return (
    a.prefix.toUpperCase() === b.prefix.toUpperCase() &&
    a.start === b.start &&
    a.end === b.end
  );
}

/** Apparent gap only when same prefix and sorted ranges leave an interior hole. */
function apparentGap(
  a: BatesRange & { start: number; end: number },
  b: BatesRange & { start: number; end: number },
): boolean {
  if (a.prefix.toUpperCase() !== b.prefix.toUpperCase()) return false;
  const [left, right] = a.start <= b.start ? [a, b] : [b, a];
  return right.start > left.end + 1;
}

type RangeRef = { production: DiscoveryProduction; range: BatesRange & { start: number; end: number } };

function pushPairSignal(
  signals: BatesReviewSignal[],
  kind: BatesReviewSignal["kind"],
  a: RangeRef,
  b: RangeRef,
  description: string,
) {
  signals.push({
    kind,
    productionId: a.production.id,
    rangeAId: a.range.id,
    rangeBId: b.range.id,
    description,
    legalDeficiencyConclusion: null,
  });
}

export function detectBatesReviewSignals(productions: DiscoveryProduction[]): BatesReviewSignal[] {
  const signals: BatesReviewSignal[] = [];

  for (const production of productions) {
    const ranges = production.batesRanges.filter(hasNumericBounds);
    for (let i = 0; i < ranges.length; i += 1) {
      for (let j = i + 1; j < ranges.length; j += 1) {
        const a = ranges[i]!;
        const b = ranges[j]!;
        const left: RangeRef = { production, range: a };
        const right: RangeRef = { production, range: b };
        if (identical(a, b)) {
          pushPairSignal(
            signals,
            "DUPLICATE",
            left,
            right,
            `Duplicate Bates range ${a.rawText} appears twice in production ${production.label}.`,
          );
        } else if (overlaps(a, b)) {
          pushPairSignal(
            signals,
            "OVERLAP",
            left,
            right,
            `Overlapping Bates ranges ${a.rawText} and ${b.rawText} in production ${production.label} (review signal only).`,
          );
        } else if (apparentGap(a, b) && ranges.length === 2) {
          pushPairSignal(
            signals,
            "APPARENT_GAP",
            left,
            right,
            `Apparent Bates gap between ${a.rawText} and ${b.rawText} in production ${production.label}. Gap alone does not establish a legal deficiency.`,
          );
        }
      }
    }
  }

  const flat: RangeRef[] = [];
  for (const production of productions) {
    for (const range of production.batesRanges) {
      if (!hasNumericBounds(range)) continue;
      flat.push({ production, range });
    }
  }
  for (let i = 0; i < flat.length; i += 1) {
    for (let j = i + 1; j < flat.length; j += 1) {
      const a = flat[i]!;
      const b = flat[j]!;
      if (a.production.id === b.production.id) continue;
      if (a.range.prefix.toUpperCase() !== b.range.prefix.toUpperCase()) continue;
      if (identical(a.range, b.range)) {
        pushPairSignal(
          signals,
          "DUPLICATE",
          a,
          b,
          `Duplicate Bates range ${a.range.rawText} appears in productions ${a.production.label} and ${b.production.label} (review signal only).`,
        );
      } else if (overlaps(a.range, b.range)) {
        pushPairSignal(
          signals,
          "OVERLAP",
          a,
          b,
          `Overlapping Bates ranges ${a.range.rawText} and ${b.range.rawText} across productions ${a.production.label} and ${b.production.label} (review signal only).`,
        );
      } else if (apparentGap(a.range, b.range)) {
        pushPairSignal(
          signals,
          "APPARENT_GAP",
          a,
          b,
          `Apparent Bates gap between ${a.range.rawText} and ${b.range.rawText} across productions ${a.production.label} and ${b.production.label}. Gap alone does not establish a legal deficiency.`,
        );
      }
    }
  }

  return signals;
}
