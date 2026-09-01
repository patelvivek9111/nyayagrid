export type TimelineDatePrecision =
  | "exact"
  | "approximate"
  | "month"
  | "year"
  | "range"
  | "unknown";

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

const MONTH_NAMES = Object.keys(MONTHS);
const MONTH_ALT = MONTH_NAMES.join("|");
const MONTH_RE = new RegExp(`\\b(${MONTH_ALT})\\b`, "i");

const APPROXIMATE_RE =
  /\b(around|approximately|approx\.?|about|near(?:\s+the)?|on\s+or\s+about|mid-?|middle\s+of)\b/i;
const RANGE_RE =
  /\bbetween\s+.+\s+and\s+/i;
const YEAR_ONLY_RE = /\b(?:in|during|of)\s+(20\d{2})\b/i;
const ISO_RE = /\b(20\d{2})-(\d{2})-(\d{2})\b/;
const LONG_DATE_RE = new RegExp(
  `\\b(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`,
  "i",
);
const MONTH_YEAR_RE = new RegExp(`\\b(${MONTH_ALT})\\s+(20\\d{2})\\b`, "i");
const DURATION_RE = /\b(\d{1,2})\s*[-]?\s*(month|year)s?\b/i;

export type InferredTimelineDate = {
  eventDate: string | null;
  eventDateEnd: string | null;
  datePrecision: TimelineDatePrecision;
  uncertaintyNotes: string | null;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad(monthIndex + 1)}-${pad(day)}`;
}

export function isoDayFromUnknown(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const iso = String(value).match(ISO_RE);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const long = String(value).match(LONG_DATE_RE);
  if (long) {
    const month = MONTHS[long[1]!.toLowerCase()];
    if (month == null) return null;
    return toIsoDate(Number(long[3]), month, Number(long[2]));
  }
  return null;
}

function monthName(monthIndex: number): string {
  return MONTH_NAMES[monthIndex] ?? "unknown";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Infer Timeline datePrecision from source evidence. Approximate language always
 * wins over an ISO token so "around November 10" is never upgraded to exact.
 */
export function inferTimelineDate(evidence: string, claimedDate?: string | null): InferredTimelineDate {
  const text = evidence.trim();
  if (!text) {
    return {
      eventDate: isoDayFromUnknown(claimedDate ?? null),
      eventDateEnd: null,
      datePrecision: claimedDate ? "unknown" : "unknown",
      uncertaintyNotes: null,
    };
  }

  const rangeMatch = text.match(
    new RegExp(
      `between\\s+(?:(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?|(20\\d{2}-\\d{2}-\\d{2}))\\s+and\\s+(?:(${MONTH_ALT})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,\\s*(20\\d{2}))?|(20\\d{2}-\\d{2}-\\d{2}))`,
      "i",
    ),
  );
  if (RANGE_RE.test(text) && rangeMatch) {
    const year = Number(rangeMatch[6] ?? rangeMatch[3]?.slice(0, 4) ?? rangeMatch[7]?.slice(0, 4) ?? "2026");
    const start = rangeMatch[3]
      ? rangeMatch[3]
      : rangeMatch[1]
        ? toIsoDate(year, MONTHS[rangeMatch[1].toLowerCase()] ?? 0, Number(rangeMatch[2]))
        : null;
    const end = rangeMatch[7]
      ? rangeMatch[7]
      : rangeMatch[4]
        ? toIsoDate(
            Number(rangeMatch[6] ?? year),
            MONTHS[rangeMatch[4].toLowerCase()] ?? 0,
            Number(rangeMatch[5]),
          )
        : null;
    return {
      eventDate: start,
      eventDateEnd: end,
      datePrecision: "range",
      uncertaintyNotes: null,
    };
  }

  if (APPROXIMATE_RE.test(text)) {
    const long = text.match(LONG_DATE_RE);
    const iso = text.match(ISO_RE);
    const monthYear = text.match(MONTH_YEAR_RE);
    let eventDate: string | null = null;
    let notes: string | null = "Approximate date; not an exact calendar finding.";
    if (/\bmid(?:dle)?\b/i.test(text) && monthYear) {
      const month = MONTHS[monthYear[1]!.toLowerCase()];
      eventDate = month == null ? null : toIsoDate(Number(monthYear[2]), month, 15);
      notes = `Approximately mid-${titleCase(monthYear[1]!.toLowerCase())} ${monthYear[2]}`;
    } else if (long) {
      eventDate = toIsoDate(Number(long[3]), MONTHS[long[1]!.toLowerCase()] ?? 0, Number(long[2]));
    } else if (iso) {
      eventDate = `${iso[1]}-${iso[2]}-${iso[3]}`;
    } else if (monthYear) {
      const month = MONTHS[monthYear[1]!.toLowerCase()];
      eventDate = month == null ? null : toIsoDate(Number(monthYear[2]), month, 1);
    }
    return {
      eventDate,
      eventDateEnd: null,
      datePrecision: "approximate",
      uncertaintyNotes: notes,
    };
  }

  const claimed = isoDayFromUnknown(claimedDate ?? null);

  const long = text.match(LONG_DATE_RE);
  if (long) {
    const fromLong = toIsoDate(Number(long[3]), MONTHS[long[1]!.toLowerCase()] ?? 0, Number(long[2]));
    return {
      eventDate: claimed && sourceStatesCalendarDay(text, claimed) ? claimed : fromLong,
      eventDateEnd: null,
      datePrecision: "exact",
      uncertaintyNotes: null,
    };
  }
  const iso = text.match(ISO_RE);
  if (iso) {
    const fromIso = `${iso[1]}-${iso[2]}-${iso[3]}`;
    return {
      eventDate: claimed && text.includes(claimed) ? claimed : fromIso,
      eventDateEnd: null,
      datePrecision: "exact",
      uncertaintyNotes: null,
    };
  }

  const monthYear = text.match(MONTH_YEAR_RE);
  if (monthYear) {
    const month = MONTHS[monthYear[1]!.toLowerCase()];
    return {
      eventDate: month == null ? null : toIsoDate(Number(monthYear[2]), month, 1),
      eventDateEnd: null,
      datePrecision: "month",
      uncertaintyNotes: null,
    };
  }

  const yearOnly = text.match(YEAR_ONLY_RE);
  if (yearOnly && !MONTH_RE.test(text) && !ISO_RE.test(text)) {
    return {
      eventDate: `${yearOnly[1]}-01-01`,
      eventDateEnd: null,
      datePrecision: "year",
      uncertaintyNotes: null,
    };
  }

  return {
    eventDate: claimed,
    eventDateEnd: null,
    datePrecision: claimed ? "unknown" : "unknown",
    uncertaintyNotes: claimed ? "Date recorded without a supported precision cue." : null,
  };
}

export function sourceStatesCalendarDay(text: string, isoDay: string): boolean {
  if (text.includes(isoDay)) return true;
  const [year, month, day] = isoDay.split("-").map(Number);
  if (!year || !month || !day) return false;
  const name = monthName(month - 1);
  const long = new RegExp(
    `\\b${name}\\s+0?${day}(?:st|nd|rd|th)?,?\\s+${year}\\b`,
    "i",
  );
  return long.test(text);
}

export function looksLikeDurationDerivedDate(sourceText: string, isoDay: string | null): boolean {
  if (!isoDay) return false;
  if (sourceStatesCalendarDay(sourceText, isoDay)) return false;
  return DURATION_RE.test(sourceText);
}

export function formatTimelineDateLabel(input: {
  eventDate?: Date | string | null;
  eventDateEnd?: Date | string | null;
  datePrecision?: string | null;
  uncertaintyNotes?: string | null;
}): string {
  const precision = (input.datePrecision ?? "unknown") as TimelineDatePrecision;
  const start = isoDayFromUnknown(input.eventDate ?? null);
  const end = isoDayFromUnknown(input.eventDateEnd ?? null);
  const notes = input.uncertaintyNotes?.trim() || null;

  if (precision === "unknown" || (!start && precision !== "range")) {
    return "Date unknown";
  }
  if (precision === "approximate") {
    if (notes && /approx|mid-|middle|around|about/i.test(notes)) {
      return notes.replace(/\.$/, "");
    }
    if (start) {
      const [year, month, day] = start.split("-").map(Number);
      return `Approximately ${titleCase(monthName((month ?? 1) - 1))} ${day}, ${year}`;
    }
    return "Approximately (date uncertain)";
  }
  if (precision === "month" && start) {
    const [year, month] = start.split("-").map(Number);
    return `${titleCase(monthName((month ?? 1) - 1))} ${year}`;
  }
  if (precision === "year" && start) {
    return start.slice(0, 4);
  }
  if (precision === "range") {
    if (start && end) {
      const [sy, sm, sd] = start.split("-").map(Number);
      const [ey, em, ed] = end.split("-").map(Number);
      if (sy === ey) {
        return `Between ${titleCase(monthName((sm ?? 1) - 1))} ${sd} and ${titleCase(monthName((em ?? 1) - 1))} ${ed}, ${sy}`;
      }
      return `Between ${start} and ${end}`;
    }
    return notes ?? "Date range";
  }
  return start ?? "Date unknown";
}

export function formatVerifiedTimelineEventLine(event: {
  title: string;
  eventType: string;
  eventDate?: Date | string | null;
  eventDateEnd?: Date | string | null;
  datePrecision?: string | null;
  actors?: unknown;
  description?: string | null;
  uncertaintyNotes?: string | null;
}): string {
  const dateLabel = formatTimelineDateLabel(event);
  const actors = JSON.stringify(event.actors ?? []);
  const extra = [event.eventType, `actors=${actors}`, event.description ?? ""]
    .filter((part) => part && part !== "[]")
    .join(" | ");
  return `- ${dateLabel} — ${event.title}${extra ? ` | ${extra}` : ""}`;
}
