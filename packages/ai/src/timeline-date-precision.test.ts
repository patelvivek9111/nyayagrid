import { describe, expect, it } from "vitest";
import {
  formatTimelineDateLabel,
  formatVerifiedTimelineEventLine,
  inferTimelineDate,
  looksLikeDurationDerivedDate,
} from "./timeline-date-precision";

describe("inferTimelineDate", () => {
  it("marks a full explicit date as exact", () => {
    expect(inferTimelineDate("Invoice date: October 1, 2026").datePrecision).toBe("exact");
    expect(inferTimelineDate("Invoice date: October 1, 2026").eventDate).toBe("2026-10-01");
    expect(inferTimelineDate("Invoice date 2026-10-01").datePrecision).toBe("exact");
  });

  it("prefers the claimed ISO when the source window contains several exact dates", () => {
    const inferred = inferTimelineDate(
      "Invoice date 2026-10-01. Due date 2026-10-31.",
      "2026-10-31",
    );
    expect(inferred.eventDate).toBe("2026-10-31");
    expect(inferred.datePrecision).toBe("exact");
  });

  it("does not upgrade approximate language to exact", () => {
    const around = inferTimelineDate("around November 10, 2026");
    expect(around.datePrecision).toBe("approximate");
    const mid = inferTimelineDate("near the middle of November 2026");
    expect(mid.datePrecision).toBe("approximate");
    const about = inferTimelineDate("on or about November 10, 2026");
    expect(about.datePrecision).toBe("approximate");
    const approx = inferTimelineDate("approximately November 10, 2026");
    expect(approx.datePrecision).toBe("approximate");
  });

  it("marks month-only and year-only evidence", () => {
    expect(inferTimelineDate("in November 2026").datePrecision).toBe("month");
    expect(inferTimelineDate("in 2026").datePrecision).toBe("year");
  });

  it("marks a stated range", () => {
    const result = inferTimelineDate("between November 10 and November 15, 2026");
    expect(result.datePrecision).toBe("range");
    expect(result.eventDate).toBe("2026-11-10");
    expect(result.eventDateEnd).toBe("2026-11-15");
  });

  it("uses unknown when no date is supported", () => {
    expect(inferTimelineDate("the parties discussed notice").datePrecision).toBe("unknown");
    expect(inferTimelineDate("the parties discussed notice").eventDate).toBeNull();
  });
});

describe("formatTimelineDateLabel", () => {
  it("formats exact, approximate, month, range, and unknown without fabricating precision", () => {
    expect(
      formatTimelineDateLabel({ eventDate: "2026-11-10", datePrecision: "exact" }),
    ).toBe("2026-11-10");
    expect(
      formatTimelineDateLabel({
        eventDate: "2026-11-15",
        datePrecision: "approximate",
        uncertaintyNotes: "Approximately mid-November 2026",
      }),
    ).toBe("Approximately mid-November 2026");
    expect(
      formatTimelineDateLabel({ eventDate: "2026-11-01", datePrecision: "month" }),
    ).toBe("November 2026");
    expect(
      formatTimelineDateLabel({
        eventDate: "2026-11-10",
        eventDateEnd: "2026-11-15",
        datePrecision: "range",
      }),
    ).toBe("Between November 10 and November 15, 2026");
    expect(
      formatTimelineDateLabel({ eventDate: "2026-11-10", datePrecision: "unknown" }),
    ).toBe("Date unknown");
  });
});

describe("formatVerifiedTimelineEventLine", () => {
  it("leads with the precision-preserving date label", () => {
    expect(
      formatVerifiedTimelineEventLine({
        title: "Review meeting",
        eventType: "meeting",
        eventDate: new Date("2026-11-10T00:00:00.000Z"),
        datePrecision: "exact",
        actors: [],
        description: null,
      }),
    ).toContain("2026-11-10 — Review meeting");
    expect(
      formatVerifiedTimelineEventLine({
        title: "Review meeting",
        eventType: "meeting",
        eventDate: new Date("2026-11-10T00:00:00.000Z"),
        datePrecision: "unknown",
        actors: [],
        description: null,
      }),
    ).toContain("Date unknown — Review meeting");
  });
});

describe("duration-derived dates", () => {
  it("detects a calculated expiration that is not stated in the source", () => {
    const source = "The lease continues for 36 months unless terminated earlier.";
    expect(looksLikeDurationDerivedDate(source, "2029-03-04")).toBe(true);
    expect(looksLikeDurationDerivedDate(`${source} ending 2029-03-04`, "2029-03-04")).toBe(false);
  });
});
