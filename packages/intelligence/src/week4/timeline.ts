import type { SourceProvenance } from "../legal/types";

export type ChronologyEvent = {
  id: string;
  eventType: string;
  title: string;
  occurredAt: string | null;
  peopleIds: string[];
  chargeIds: string[];
  evidenceIds: string[];
  documentIds: string[];
  provenance: SourceProvenance;
  confidence: "high" | "medium" | "low";
};

export type TimelineConflict = {
  eventType: string;
  versionA: { id: string; occurredAt: string | null; provenance: SourceProvenance };
  versionB: { id: string; occurredAt: string | null; provenance: SourceProvenance };
  conflict: "DATE_CONFLICT" | "TIME_CONFLICT" | "ORDER_CONFLICT";
  confidence: "high" | "medium" | "low";
};

const ORDER = [
  "OFFENSE",
  "REPORT",
  "SEARCH",
  "SEIZURE",
  "ARREST",
  "INTERVIEW",
  "WARRANT_ISSUED",
  "WARRANT_EXECUTED",
  "EVIDENCE_COLLECTION",
  "CHARGE_FILED",
  "DISCOVERY_RECEIVED",
  "DISCOVERY_PRODUCED",
  "MOTION_FILED",
  "HEARING",
  "PLEA_EVENT",
  "TRIAL_EVENT",
  "SENTENCING",
];

export function unifyCriminalTimeline(events: ChronologyEvent[]): ChronologyEvent[] {
  return [...events].sort((a, b) => {
    if (a.occurredAt && b.occurredAt && a.occurredAt !== b.occurredAt) {
      return a.occurredAt < b.occurredAt ? -1 : 1;
    }
    return ORDER.indexOf(a.eventType) - ORDER.indexOf(b.eventType);
  });
}

export function detectTimelineConflicts(events: ChronologyEvent[]): TimelineConflict[] {
  const conflicts: TimelineConflict[] = [];
  const byType = new Map<string, ChronologyEvent[]>();
  for (const event of events) {
    const list = byType.get(event.eventType) ?? [];
    list.push(event);
    byType.set(event.eventType, list);
  }
  for (const [eventType, list] of byType) {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i]!;
        const b = list[j]!;
        if (a.occurredAt && b.occurredAt && a.occurredAt !== b.occurredAt) {
          conflicts.push({
            eventType,
            versionA: { id: a.id, occurredAt: a.occurredAt, provenance: a.provenance },
            versionB: { id: b.id, occurredAt: b.occurredAt, provenance: b.provenance },
            conflict: a.occurredAt.slice(0, 10) === b.occurredAt.slice(0, 10) ? "TIME_CONFLICT" : "DATE_CONFLICT",
            confidence: "medium",
          });
        }
      }
    }
  }
  const dated = events.filter((event) => event.occurredAt);
  for (let i = 0; i < dated.length - 1; i += 1) {
    const a = dated[i]!;
    const b = dated[i + 1]!;
    const orderA = ORDER.indexOf(a.eventType);
    const orderB = ORDER.indexOf(b.eventType);
    if (orderA >= 0 && orderB >= 0 && orderA > orderB && a.occurredAt! < b.occurredAt!) {
      conflicts.push({
        eventType: `${a.eventType}->${b.eventType}`,
        versionA: { id: a.id, occurredAt: a.occurredAt, provenance: a.provenance },
        versionB: { id: b.id, occurredAt: b.occurredAt, provenance: b.provenance },
        conflict: "ORDER_CONFLICT",
        confidence: "low",
      });
    }
  }
  return conflicts;
}
