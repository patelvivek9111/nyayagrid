import { describe, expect, it } from "vitest";
import {
  assertValidHourlyRateCents,
  assertValidMinutes,
  buildInvoiceLineDrafts,
  canTransitionInvoiceStatus,
  computeLineAmountCents,
  rollupInvoiceTotals,
  selectPostedUnbilledEntries,
} from "./firm-time-billing";

describe("firm-time-billing", () => {
  it("computes line amounts from minutes and hourly rate", () => {
    expect(computeLineAmountCents(60, 25000, true)).toBe(25000);
    expect(computeLineAmountCents(30, 25000, true)).toBe(12500);
    expect(computeLineAmountCents(90, 20000, true)).toBe(30000);
  });

  it("returns 0 for non-billable and null when rate missing", () => {
    expect(computeLineAmountCents(60, 25000, false)).toBe(0);
    expect(computeLineAmountCents(60, null, true)).toBe(null);
    expect(computeLineAmountCents(-1, 25000, true)).toBe(null);
  });

  it("selects only posted billable unbilled entries with positive minutes", () => {
    const selected = selectPostedUnbilledEntries(
      [
        {
          id: "a",
          status: "posted",
          minutes: 30,
          billable: true,
          hourlyRateCents: 10000,
          description: "a",
        },
        {
          id: "b",
          status: "suggested",
          minutes: 30,
          billable: true,
          hourlyRateCents: 10000,
          description: "b",
        },
        {
          id: "c",
          status: "posted",
          minutes: 30,
          billable: false,
          hourlyRateCents: 10000,
          description: "c",
        },
        {
          id: "d",
          status: "posted",
          minutes: 15,
          billable: true,
          hourlyRateCents: 10000,
          description: "d",
        },
      ],
      new Set(["d"]),
    );
    expect(selected.map((e) => e.id)).toEqual(["a"]);
  });

  it("rolls up invoice totals and withholds dollar total when rates incomplete", () => {
    const lines = buildInvoiceLineDrafts([
      {
        id: "1",
        status: "posted",
        minutes: 60,
        billable: true,
        hourlyRateCents: 20000,
        description: "research",
      },
      {
        id: "2",
        status: "posted",
        minutes: 30,
        billable: true,
        hourlyRateCents: null,
        description: "call",
      },
    ]);
    const incomplete = rollupInvoiceTotals(lines);
    expect(incomplete.totalMinutes).toBe(90);
    expect(incomplete.billableMinutes).toBe(90);
    expect(incomplete.hasCompleteRates).toBe(false);
    expect(incomplete.totalCents).toBe(null);

    const complete = rollupInvoiceTotals(
      buildInvoiceLineDrafts([
        {
          id: "1",
          status: "posted",
          minutes: 60,
          billable: true,
          hourlyRateCents: 20000,
          description: "research",
        },
        {
          id: "2",
          status: "posted",
          minutes: 30,
          billable: true,
          hourlyRateCents: 20000,
          description: "call",
        },
      ]),
    );
    expect(complete.totalCents).toBe(30000);
    expect(complete.hasCompleteRates).toBe(true);
  });

  it("enforces invoice status transitions", () => {
    expect(canTransitionInvoiceStatus("draft", "issue")).toEqual({ ok: true });
    expect(canTransitionInvoiceStatus("issued", "issue").ok).toBe(false);
    expect(canTransitionInvoiceStatus("void", "void").ok).toBe(false);
    expect(canTransitionInvoiceStatus("issued", "void")).toEqual({ ok: true });
  });

  it("rejects zero, negative, and oversized minutes or rates", () => {
    expect(assertValidMinutes(0)).toMatch(/at least 1/);
    expect(assertValidMinutes(-5)).toMatch(/at least 1/);
    expect(assertValidMinutes(1441)).toMatch(/at most/);
    expect(assertValidMinutes(30)).toBeNull();
    expect(assertValidHourlyRateCents(-1)).toMatch(/negative/);
    expect(assertValidHourlyRateCents(15000)).toBeNull();
  });
});
