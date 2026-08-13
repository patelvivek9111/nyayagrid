import { describe, expect, it } from "vitest";
import { buildTimelineDedupeKey, findDuplicateTimelineEvent } from "./dedupe";
import { jaccard, normalizeEntityName, tokenize } from "./provenance";

describe("matter intelligence helpers", () => {
  it("normalizes entity names", () => {
    expect(normalizeEntityName("  John   Smith ")).toBe("john smith");
  });

  it("dedupes similar timeline events conservatively", () => {
    const existing = [
      {
        id: "1",
        eventType: "agreement_signed",
        title: "Agreement executed",
        description: "Agreement executed March 4, 2026.",
        eventDate: new Date("2026-03-04T00:00:00.000Z"),
        actors: ["Acme Corp"],
        status: "proposed",
      },
    ];
    const duplicate = findDuplicateTimelineEvent(
      {
        eventType: "agreement_signed",
        title: "Agreement executed",
        description: "Agreement executed March 4, 2026 by the parties.",
        eventDate: new Date("2026-03-04T00:00:00.000Z"),
        actors: ["Acme Corp"],
      },
      existing,
    );
    expect(duplicate?.id).toBe("1");

    const differentDay = findDuplicateTimelineEvent(
      {
        eventType: "agreement_signed",
        title: "Contract signed",
        description: "The parties signed the contract on March 5.",
        eventDate: new Date("2026-03-05T00:00:00.000Z"),
        actors: ["Acme Corp"],
      },
      existing,
    );
    expect(differentDay).toBeNull();
  });

  it("builds stable dedupe keys", () => {
    expect(
      buildTimelineDedupeKey({
        eventType: "payment_sent",
        eventDate: new Date("2024-01-15T12:00:00.000Z"),
        title: "Payment Sent",
      }),
    ).toContain("payment_sent|2024-01-15|");
  });

  it("computes token similarity", () => {
    expect(
      jaccard(tokenize("agreement signed march"), tokenize("signed agreement march")),
    ).toBeGreaterThan(0.9);
  });
});
