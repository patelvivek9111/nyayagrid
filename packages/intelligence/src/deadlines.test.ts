import { describe, expect, it } from "vitest";
import { presentDeadlineForAttorney } from "./deadlines";

const source = {
  id: "src-1",
  documentId: "doc-1",
  chunkId: "chunk-1",
  page: 3,
  supportingText: "Payment is due on April 1, 2026.",
  documentTitle: "SYNTH lease",
};

describe("presentDeadlineForAttorney", () => {
  it("returns null when there are no sources", () => {
    expect(
      presentDeadlineForAttorney(
        {
          id: "d1",
          title: "Payment due",
          status: "proposed",
          dateKind: "explicit",
        },
        [],
      ),
    ).toBeNull();
  });

  it("always exposes dateKind and timezone honesty", () => {
    const presented = presentDeadlineForAttorney(
      {
        id: "d1",
        title: "Payment due",
        status: "approved",
        dueAt: "2026-04-01T00:00:00.000Z",
        dateKind: "inferred",
        datePrecision: "exact",
        timezone: null,
        origin: "ai",
      },
      [source],
    );
    expect(presented).not.toBeNull();
    expect(presented!.dateKind).toBe("inferred");
    expect(presented!.timezoneLabel).toBe("timezone unknown");
    expect(presented!.sources).toHaveLength(1);
    expect(presented!.dueAt).toBe("2026-04-01T00:00:00.000Z");
  });

  it("keeps an explicit timezone label when present", () => {
    const presented = presentDeadlineForAttorney(
      {
        id: "d1",
        title: "Filing due",
        status: "approved",
        dateKind: "explicit",
        timezone: "America/New_York",
      },
      [source],
    );
    expect(presented!.timezoneLabel).toBe("America/New_York");
    expect(presented!.dateKind).toBe("explicit");
  });
});
