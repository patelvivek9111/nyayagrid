import { fold } from "./normalize";
import { infersPhysicalActorFromSystemActivity } from "./semantic-map";
import {
  parseTimelineOutput,
  TIMELINE_STRUCTURED_GRADER_VERSION,
  type CanonicalTimelineEvent,
} from "./structured-schemas";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";

export type ExpectedTimelineEvent = {
  date: string;
  text: string;
  tokens: string[];
};

const ISO_DATE = /\b(20\d{2}-\d{2}-\d{2})\b/;
const STOP = new Set([
  "the",
  "for",
  "and",
  "with",
  "from",
  "that",
  "this",
  "date",
  "dated",
]);

export function isUsableTimelineExtractionGt(expectation: BenchExpectation): boolean {
  if (expectation.expectationType === "must_abstain") return false;
  return parseExpectedTimelineEvents(expectation.canonical).length > 0;
}

export function parseExpectedTimelineEvents(canonical: string | string[]): ExpectedTimelineEvent[] {
  const rows = Array.isArray(canonical) ? canonical : [canonical];
  const expected: ExpectedTimelineEvent[] = [];
  for (const row of rows) {
    const match = String(row).match(ISO_DATE);
    if (!match) continue;
    const date = match[1]!;
    const text = fold(String(row));
    const tokens = text
      .replace(date, " ")
      .split(/[^a-z0-9$]+/)
      .filter((token) => token.length >= 3 && !STOP.has(token));
    expected.push({ date, text, tokens: [...new Set(tokens)] });
  }
  return expected;
}

function eventDateIso(event: CanonicalTimelineEvent): string | null {
  const raw = event.date;
  if (!raw) return null;
  const match = String(raw).match(ISO_DATE);
  return match?.[1] ?? null;
}

function eventBlob(event: CanonicalTimelineEvent): string {
  return fold(
    [
      event.title,
      event.description ?? "",
      event.eventType,
      event.actors.join(" "),
      event.sources.map((s) => s.supportingText).join(" "),
    ].join(" "),
  );
}

function keywordsMatch(expected: ExpectedTimelineEvent, event: CanonicalTimelineEvent): boolean {
  if (expected.tokens.length === 0) return true;
  const blob = eventBlob(event);
  const hits = expected.tokens.filter((token) => blob.includes(token));
  return hits.length >= Math.min(1, expected.tokens.length);
}

export function matchTimelineEvents(
  expected: ExpectedTimelineEvent[],
  events: CanonicalTimelineEvent[],
): Array<{ expected: ExpectedTimelineEvent; event: CanonicalTimelineEvent | null }> {
  const used = new Set<string>();
  return expected.map((item) => {
    const candidate = events.find((event) => {
      if (used.has(event.eventId)) return false;
      if (eventDateIso(event) !== item.date) return false;
      return keywordsMatch(item, event);
    });
    if (candidate) used.add(candidate.eventId);
    return { expected: item, event: candidate ?? null };
  });
}

function stem(name: string): string {
  return fold(name.replace(/\.[a-z0-9]+$/i, "").replace(/_/g, " "));
}

function sourceMatchesSupportingDocs(event: CanonicalTimelineEvent, supportingDocs: string[]): boolean {
  if (supportingDocs.length === 0) return true;
  const files = event.sources
    .map((source) => source.filename)
    .filter((name): name is string => Boolean(name))
    .map(stem);
  if (files.length === 0) return false;
  return supportingDocs.some((doc) => files.some((file) => file.includes(stem(doc)) || stem(doc).includes(file)));
}

function result(
  expectation: BenchExpectation,
  verdict: BenchVerdict,
  detail: string,
  extras: Partial<GradeResult>,
): GradeResult {
  return {
    taskId: expectation.taskId,
    verdict,
    expectationType: extras.expectationType ?? expectation.expectationType,
    severity: extras.criticalFailure ? "critical" : expectation.severity,
    detail,
    needlesRequired: extras.needlesRequired ?? [],
    needlesFound: extras.needlesFound ?? [],
    graderVersion: TIMELINE_STRUCTURED_GRADER_VERSION,
    graderKind: "timeline",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
    metrics: extras.metrics,
  };
}

export function gradeTimelineAnswer(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
): GradeResult {
  if (!isUsableTimelineExtractionGt(expectation)) {
    return result(
      expectation,
      "pass",
      "Not valid Timeline extraction ground truth (Q&A-shaped or abstention trap). Scored not_applicable.",
      {
        expectationType: "not_applicable",
        checks: { usableExtractionGt: false },
      },
    );
  }

  const output = parseTimelineOutput(answer.extras);
  if (!output) {
    return result(expectation, "fail", "INFRASTRUCTURE: Structured timeline output missing after persistence.", {
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
      checks: { structuredOutputPresent: false },
    });
  }

  const expected = parseExpectedTimelineEvents(expectation.canonical);
  const matches = matchTimelineEvents(expected, output.events);
  const recalled = matches.filter((row) => row.event).length;
  const recall = expected.length ? recalled / expected.length : 0;
  const matchedEvents = matches.map((row) => row.event).filter((event): event is CanonicalTimelineEvent => Boolean(event));
  const expectedDates = new Set(expected.map((item) => item.date));
  const sameDayEvents = output.events.filter((event) => {
    const date = eventDateIso(event);
    return date != null && expectedDates.has(date);
  });
  const precisionDenom = sameDayEvents.length;
  const precision = precisionDenom ? matchedEvents.length / precisionDenom : recall;
  const provenanceOk = matchedEvents.every(
    (event) => event.sources.length > 0 && event.sourceChunkIds.length > 0,
  );
  const sourceDocOk = matchedEvents.every((event) =>
    sourceMatchesSupportingDocs(event, expectation.supportingDocs),
  );
  const datePrecisionOk = matchedEvents.every(
    (event) => event.datePrecision === "exact" || event.datePrecision === "range",
  );
  const actorOverclaim = output.events.some((event) =>
    infersPhysicalActorFromSystemActivity(
      [event.title, event.description ?? "", event.actors.join(" ")].join("\n"),
    ),
  );
  const approvedLeak = output.events.some(
    (event) => event.status === "approved" || event.status === "edited_and_approved",
  );
  const rejectedPresent = output.events.some((event) => event.status === "rejected");
  const duplicateCount = precisionDenom > matchedEvents.length ? precisionDenom - matchedEvents.length : 0;
  const unmatchedSameDay = sameDayEvents.filter(
    (event) => !matchedEvents.some((matched) => matched.eventId === event.eventId),
  );
  const unsupported = output.events.filter((event) => event.sources.length === 0 || event.sourceChunkIds.length === 0);

  const checks = {
    structuredOutputPresent: true,
    usableExtractionGt: true,
    allExpectedEventsFound: recall === 1,
    dateCorrect: recall === 1,
    datePrecisionCorrect: datePrecisionOk,
    provenancePresent: provenanceOk,
    sourceSupportsEvent: sourceDocOk,
    noActorInference: !actorOverclaim,
    proposedNotVerified: !approvedLeak,
    noRejectedInOutput: !rejectedPresent,
    noUnsupportedMatchedEvent: matchedEvents.every((event) => event.sources.length > 0),
  };
  const extra = {
    checks,
    needlesRequired: expected.map((item) => `${item.date} ${item.tokens.join(" ")}`.trim()),
    needlesFound: matchedEvents.map((event) => `${eventDateIso(event) ?? "unknown"} ${event.title}`),
    metrics: {
      expectedCount: expected.length,
      producedCount: output.events.length,
      matchedCount: recalled,
      eventRecall: recall,
      eventPrecision: precision,
      unsupportedCount: unsupported.length,
      duplicateCount,
      sameDayCount: precisionDenom,
    },
  };

  if (actorOverclaim) {
    return result(
      expectation,
      "fail",
      "Timeline event treats system/badge activity as a named person's physical act.",
      {
        ...extra,
        failureTaxonomy: "actor extraction",
        criticalFailure: true,
        checks: { ...checks, noActorInference: false },
      },
    );
  }
  if (approvedLeak) {
    return result(
      expectation,
      "fail",
      "Unreviewed extraction produced approved/verified timeline events.",
      {
        ...extra,
        failureTaxonomy: "formatter/trust-boundary",
        criticalFailure: true,
        checks,
      },
    );
  }
  if (!provenanceOk && recalled > 0) {
    return result(expectation, "fail", "Matched timeline event lacks valid source chunks.", {
      ...extra,
      failureTaxonomy: "source mapping",
      criticalFailure: true,
      checks: { ...checks, provenancePresent: false },
    });
  }

  if (recall === 0) {
    return result(expectation, "fail", "Missed all expected dated timeline events.", {
      ...extra,
      failureTaxonomy: "event extraction",
    });
  }
  if (recall < 1) {
    const missing = matches.filter((row) => !row.event).map((row) => row.expected.date);
    return result(
      expectation,
      "needs_work",
      `Partial timeline recall ${recalled}/${expected.length}; missing ${missing.join(", ")}. extraSameDay=${unmatchedSameDay.length} duplicates=${duplicateCount} unsupported=${unsupported.length}`,
      {
        ...extra,
        failureTaxonomy: "event extraction",
      },
    );
  }
  if (!datePrecisionOk) {
    return result(
      expectation,
      "needs_work",
      "Expected dated events found, but datePrecision was not exact for ISO-dated ground truth.",
      {
        ...extra,
        failureTaxonomy: "date precision",
        checks: { ...checks, datePrecisionCorrect: false },
      },
    );
  }
  if (!sourceDocOk) {
    return result(
      expectation,
      "needs_work",
      "Expected events found, but supporting document mapping did not match the task source list.",
      {
        ...extra,
        failureTaxonomy: "source mapping",
        checks: { ...checks, sourceSupportsEvent: false },
      },
    );
  }
  return result(
    expectation,
    "pass",
    `Recovered ${recalled}/${expected.length} expected dated events. additionalMatterEvents=${output.events.length - matchedEvents.length} duplicates=${duplicateCount} unsupported=${unsupported.length}`,
    extra,
  );
}
