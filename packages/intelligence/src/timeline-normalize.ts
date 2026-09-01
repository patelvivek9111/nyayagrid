import type { ExtractionChunk, TimelineProposal } from "@nyayagrid/ai";
import {
  inferTimelineDate,
  isoDayFromUnknown,
  looksLikeDurationDerivedDate,
  sourceStatesCalendarDay,
  type TimelineDatePrecision,
} from "@nyayagrid/ai";
import { jaccard, tokenize } from "./provenance";

const ISO_RE = /\b(20\d{2}-\d{2}-\d{2})\b/g;
const LONG_DATE_RE =
  /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b/gi;

const MONTHS: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

export type TimelineEventLike = {
  title: string;
  description?: string | null;
  eventType: string;
  eventDate?: string | null;
  eventDateEnd?: string | null;
  datePrecision?: TimelineDatePrecision;
  actors?: string[];
  sourceChunkIds: string[];
  sourceQuotes?: string[];
  confidence?: "low" | "medium" | "high";
  uncertaintyNotes?: string | null;
};

export type RejectedTimelineMemory = {
  title: string;
  description?: string | null;
  eventType: string;
  eventDate?: Date | string | null;
  documentVersionIds: string[];
};

type DatedCue = {
  iso: string;
  index: number;
  window: string;
  matched: string;
};

function toIsoFromLong(month: string, day: string, year: string): string {
  return `${year}-${MONTHS[month.toLowerCase()] ?? "01"}-${String(Number(day)).padStart(2, "0")}`;
}

function collectDates(text: string): DatedCue[] {
  const found: DatedCue[] = [];
  for (const match of text.matchAll(ISO_RE)) {
    found.push({
      iso: match[1]!,
      index: match.index ?? 0,
      window: text.slice(Math.max(0, (match.index ?? 0) - 70), (match.index ?? 0) + match[0].length + 50),
      matched: match[0]!,
    });
  }
  for (const match of text.matchAll(LONG_DATE_RE)) {
    const iso = toIsoFromLong(match[1]!, match[2]!, match[3]!);
    found.push({
      iso,
      index: match.index ?? 0,
      window: text.slice(Math.max(0, (match.index ?? 0) - 70), (match.index ?? 0) + match[0].length + 50),
      matched: match[0]!,
    });
  }
  const seen = new Set<string>();
  return found.filter((row) => {
    const key = `${row.iso}@${row.index}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function nearestCueKind(
  window: string,
  iso: string,
  matched: string,
): {
  eventType: string;
  title: string;
  kind: string;
} | null {
  const folded = window.toLowerCase();
  if (/\bamended from\b.+\bto\b.+\beffective\b/.test(folded)) return null;

  const matchedAt = window.indexOf(matched);
  const isoAt = window.indexOf(iso);
  const dateAt = matchedAt >= 0 ? matchedAt : Math.max(0, isoAt);
  const before = folded.slice(Math.max(0, dateAt - 40), dateAt);
  const after = folded.slice(dateAt, dateAt + 40);

  if (/invoice\s+date\s*[:.]?\s*$/.test(before) || /invoiced on\s*$/.test(before) || /invoice issued\s*$/.test(before)) {
    return { eventType: "invoice_issued", title: "Invoice issued", kind: "invoice_issued" };
  }
  if (/due\s+date\s*[:.]?\s*$/.test(before) || /payment due\s*$/.test(before)) {
    return { eventType: "invoice_due", title: "Invoice due date", kind: "invoice_due" };
  }
  if (/transmitted\s+on\s*$/.test(before) || /remittance/.test(before)) {
    return { eventType: "remittance", title: "Remittance transmitted", kind: "remittance" };
  }
  if (
    /email\s+dated\s*$/.test(before) ||
    /late[- ]payment/.test(before) ||
    /received|receipt/.test(after) ||
    /dispute note/.test(before)
  ) {
    return { eventType: "payment_notice", title: "Payment receipt or late-payment notice", kind: "receipt" };
  }
  if (/\b(signed|executed)\s*$/.test(before)) {
    return { eventType: "agreement_signed", title: "Agreement signed", kind: "signed" };
  }
  if (/\beffective\s*$/.test(before)) {
    return { eventType: "effective_date", title: "Effective date", kind: "effective" };
  }
  if (/\b(meeting|minutes|held)\b/.test(before) || /\b(meeting|minutes)\b/.test(after)) {
    return { eventType: "meeting", title: "Meeting", kind: "meeting" };
  }
  return null;
}

export function extractDatedEventPropositionsFromText(
  text: string,
  chunkId: string,
): TimelineProposal[] {
  const events: TimelineProposal[] = [];
  const seen = new Set<string>();
  for (const cue of collectDates(text)) {
    const classified = nearestCueKind(cue.window, cue.iso, cue.matched);
    if (!classified) continue;
    const key = `${classified.kind}|${cue.iso}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const inferred = inferTimelineDate(cue.window, cue.iso);
    if (looksLikeDurationDerivedDate(text, cue.iso)) continue;
    const quote = cue.window.replace(/\s+/g, " ").trim().slice(0, 400);
    const eventDate =
      inferred.datePrecision === "range" || inferred.datePrecision === "approximate"
        ? inferred.eventDate
        : cue.iso;
    events.push({
      title: classified.title,
      description: quote,
      eventType: classified.eventType,
      eventDate,
      eventDateEnd: inferred.eventDateEnd,
      datePrecision: inferred.datePrecision,
      actors: [],
      sourceChunkIds: [chunkId],
      sourceQuotes: [quote],
      confidence: "high",
      uncertaintyNotes: inferred.uncertaintyNotes,
    });
  }
  return events;
}

export function extractDatedEventPropositionsFromChunks(chunks: ExtractionChunk[]): TimelineProposal[] {
  return chunks.flatMap((chunk) => extractDatedEventPropositionsFromText(chunk.content, chunk.chunkId));
}

const SYSTEM_ACTIVITY_RE =
  /\b(access granted|badge(?:\s+(?:access|log|activity|assigned))?|exit sensor|assigned badge|access log)\b/i;
const PHYSICAL_ACT_RE =
  /\b(physically entered|personally entered|entered the records room|records room entry|the witness entered)\b/i;
const DENIAL_RE = /\b(did not enter|never entered|does not (independently )?prove who|not independently prove)\b/i;

export function groundTimelineActorsAndTitle(event: TimelineEventLike, sourceText: string): TimelineEventLike {
  const blob = [event.title, event.description ?? "", sourceText, (event.actors ?? []).join(" ")].join("\n");
  if (DENIAL_RE.test(blob) && (PHYSICAL_ACT_RE.test(event.title) || /entry/i.test(event.title))) {
    return {
      ...event,
      title: "Testimony denying records-room entry",
      eventType: "testimony",
      uncertaintyNotes:
        event.uncertaintyNotes ??
        "Source is a denial of entry; title must not describe a positive entry event.",
    };
  }
  if (SYSTEM_ACTIVITY_RE.test(blob) && (PHYSICAL_ACT_RE.test(event.title) || PHYSICAL_ACT_RE.test(blob))) {
    const assigned = sourceText.match(/assigned to ([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/);
    const name = assigned?.[1]?.trim();
    return {
      ...event,
      title: name
        ? `Badge assigned to ${name} recorded access`
        : "Badge activity recorded access",
      eventType: "badge_activity",
      actors: [],
      uncertaintyNotes:
        event.uncertaintyNotes ??
        "Credential or system activity does not establish a named person's physical act.",
    };
  }
  if (SYSTEM_ACTIVITY_RE.test(blob) && (event.actors?.length ?? 0) > 0) {
    const assigned = sourceText.match(/assigned to ([A-Z][A-Za-z.]+(?:\s+[A-Z][A-Za-z.]+){0,3})/);
    const name = assigned?.[1]?.trim();
    return {
      ...event,
      title: /exit/i.test(event.title)
        ? name
          ? `Badge assigned to ${name} recorded exit`
          : "Badge activity recorded exit"
        : name
          ? `Badge assigned to ${name} recorded access`
          : event.title,
      eventType: "badge_activity",
      actors: [],
      uncertaintyNotes:
        event.uncertaintyNotes ??
        "Credential or system activity does not establish a named person's physical act.",
    };
  }
  return event;
}

export function applyTimelineDatePrecision(
  event: TimelineEventLike,
  sourceText: string,
): TimelineEventLike {
  const inferred = inferTimelineDate(
    [event.sourceQuotes?.join(" ") ?? "", event.description ?? "", sourceText].join("\n"),
    event.eventDate ?? null,
  );
  const iso = inferred.eventDate ?? event.eventDate ?? null;
  if (iso && looksLikeDurationDerivedDate(sourceText, iso) && !sourceStatesCalendarDay(sourceText, iso)) {
    return {
      ...event,
      eventDate: null,
      eventDateEnd: null,
      datePrecision: "unknown",
      uncertaintyNotes:
        "Date appears derived from a duration, not a source-stated calendar day.",
    };
  }
  const claimedExact = event.datePrecision === "exact";
  const precision: TimelineDatePrecision =
    inferred.datePrecision === "unknown" && claimedExact && iso && sourceStatesCalendarDay(sourceText, iso)
      ? "exact"
      : inferred.datePrecision === "unknown" && iso && sourceStatesCalendarDay(sourceText, iso)
        ? "exact"
        : inferred.datePrecision;
  return {
    ...event,
    eventDate: iso,
    eventDateEnd: inferred.eventDateEnd ?? event.eventDateEnd ?? null,
    datePrecision: precision,
    uncertaintyNotes: event.uncertaintyNotes ?? inferred.uncertaintyNotes,
  };
}

export function matchesRejectedTimelineEvent(
  candidate: TimelineEventLike & { documentVersionIds?: string[] },
  rejected: RejectedTimelineMemory[],
): boolean {
  const candidateDay = isoDayFromUnknown(candidate.eventDate ?? null);
  const candidateTokens = tokenize(`${candidate.title} ${candidate.description ?? ""}`);
  const versions = new Set(candidate.documentVersionIds ?? []);
  for (const row of rejected) {
    if (versions.size > 0 && row.documentVersionIds.length > 0) {
      const overlap = row.documentVersionIds.some((id) => versions.has(id));
      if (!overlap) continue;
    }
    const rowDay = isoDayFromUnknown(row.eventDate ?? null);
    if (candidateDay && rowDay && candidateDay !== rowDay) continue;
    const similarity = jaccard(candidateTokens, tokenize(`${row.title} ${row.description ?? ""}`));
    if (similarity >= 0.5) return true;
  }
  return false;
}

function eventKey(event: TimelineEventLike): string {
  return `${event.eventType}|${event.eventDate ?? "unknown"}|${event.title.toLowerCase().slice(0, 60)}`;
}

export function mergeTimelineProposals(
  modelEvents: TimelineProposal[],
  deterministicEvents: TimelineProposal[],
): TimelineProposal[] {
  const merged: TimelineProposal[] = [];
  const seen = new Set<string>();
  for (const event of [...deterministicEvents, ...modelEvents]) {
    const key = `${event.eventType}|${event.eventDate ?? "unknown"}`;
    const alt = eventKey(event);
    if (seen.has(key) || seen.has(alt)) continue;
    seen.add(key);
    seen.add(alt);
    merged.push(event);
  }
  return merged;
}

export function normalizeTimelineProposal(
  event: TimelineEventLike,
  sourceText: string,
): TimelineEventLike | null {
  if (looksLikeDurationDerivedDate(sourceText, event.eventDate ?? null) && event.eventDate) {
    const iso = isoDayFromUnknown(event.eventDate);
    if (iso && !sourceStatesCalendarDay(sourceText, iso)) {
      return null;
    }
  }
  const withDates = applyTimelineDatePrecision(event, sourceText);
  return groundTimelineActorsAndTitle(withDates, sourceText);
}

export function sourceTextForEvent(event: TimelineEventLike, chunks: ExtractionChunk[]): string {
  const fromChunks = event.sourceChunkIds
    .map((id) => chunks.find((chunk) => chunk.chunkId === id)?.content ?? "")
    .join("\n");
  return [event.sourceQuotes?.join("\n") ?? "", event.description ?? "", fromChunks].join("\n");
}
