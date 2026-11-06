/**
 * Professional firm time → draft invoice assistance.
 *
 * Totals are fee *assistance* only: minutes × optional hourly rate. This is not payment
 * processing, trust accounting, or a guarantee of collectible fees. When rate is absent,
 * amountCents is null and callers must display minutes, not invented dollars.
 */

export type FirmTimeEntryForBilling = {
  id: string;
  status: "suggested" | "posted" | "rejected" | string;
  minutes: number;
  billable: boolean;
  hourlyRateCents: number | null;
  description: string;
};

export type FirmInvoiceLineDraft = {
  timeEntryId: string;
  description: string;
  minutes: number;
  billable: boolean;
  hourlyRateCents: number | null;
  amountCents: number | null;
};

export type FirmInvoiceTotals = {
  totalMinutes: number;
  billableMinutes: number;
  nonBillableMinutes: number;
  /** Sum of line amounts when every billable line has a rate; otherwise null. */
  totalCents: number | null;
  hasCompleteRates: boolean;
};

export type FirmInvoiceStatus = "draft" | "issued" | "void";

/** Round half-up to nearest cent for fractional hours × rate. */
export function computeLineAmountCents(
  minutes: number,
  hourlyRateCents: number | null | undefined,
  billable: boolean,
): number | null {
  if (!billable) return 0;
  if (hourlyRateCents == null) return null;
  if (!Number.isFinite(minutes) || minutes < 0) return null;
  if (!Number.isFinite(hourlyRateCents) || hourlyRateCents < 0) return null;
  return Math.round((minutes / 60) * hourlyRateCents);
}

export function selectPostedUnbilledEntries(
  entries: FirmTimeEntryForBilling[],
  alreadyBilledTimeEntryIds: ReadonlySet<string>,
): FirmTimeEntryForBilling[] {
  return entries.filter(
    (entry) =>
      entry.status === "posted" &&
      entry.billable &&
      entry.minutes > 0 &&
      !alreadyBilledTimeEntryIds.has(entry.id),
  );
}

export function buildInvoiceLineDrafts(entries: FirmTimeEntryForBilling[]): FirmInvoiceLineDraft[] {
  return entries.map((entry) => ({
    timeEntryId: entry.id,
    description: entry.description,
    minutes: entry.minutes,
    billable: entry.billable,
    hourlyRateCents: entry.hourlyRateCents,
    amountCents: computeLineAmountCents(entry.minutes, entry.hourlyRateCents, entry.billable),
  }));
}

export function rollupInvoiceTotals(
  lines: Array<{ minutes: number; billable?: boolean; amountCents: number | null }>,
): FirmInvoiceTotals {
  let totalMinutes = 0;
  let billableMinutes = 0;
  let nonBillableMinutes = 0;
  let totalCents = 0;
  let hasCompleteRates = true;
  let anyBillable = false;

  for (const line of lines) {
    const minutes = Number.isFinite(line.minutes) ? line.minutes : 0;
    totalMinutes += minutes;
    const billable = line.billable !== false;
    if (billable) {
      anyBillable = true;
      billableMinutes += minutes;
      if (line.amountCents == null) {
        hasCompleteRates = false;
      } else {
        totalCents += line.amountCents;
      }
    } else {
      nonBillableMinutes += minutes;
    }
  }

  return {
    totalMinutes,
    billableMinutes,
    nonBillableMinutes,
    totalCents: anyBillable && hasCompleteRates ? totalCents : anyBillable ? null : 0,
    hasCompleteRates: !anyBillable || hasCompleteRates,
  };
}

export function canTransitionInvoiceStatus(
  current: FirmInvoiceStatus,
  action: "issue" | "void",
): { ok: true } | { ok: false; reason: string } {
  if (action === "issue") {
    if (current !== "draft") return { ok: false, reason: "Only draft invoices can be issued" };
    return { ok: true };
  }
  if (current === "void") return { ok: false, reason: "Invoice is already void" };
  return { ok: true };
}

export function assertValidMinutes(minutes: number): string | null {
  if (!Number.isInteger(minutes)) return "minutes must be an integer";
  if (minutes < 1) return "minutes must be at least 1";
  if (minutes > 24 * 60) return "minutes must be at most 1440";
  return null;
}

export function assertValidHourlyRateCents(rate: number | null | undefined): string | null {
  if (rate == null) return null;
  if (!Number.isInteger(rate)) return "hourlyRateCents must be an integer";
  if (rate < 0) return "hourlyRateCents cannot be negative";
  if (rate > 10_000_00) return "hourlyRateCents exceeds supported maximum";
  return null;
}
