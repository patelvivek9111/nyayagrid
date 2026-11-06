import {
  computeLineAmountCents,
  selectPostedUnbilledEntries,
  buildInvoiceLineDrafts,
  rollupInvoiceTotals,
  canTransitionInvoiceStatus,
  assertValidMinutes,
  assertValidHourlyRateCents,
} from "../packages/database/src/firm-time-billing.ts";

function check(name, cond) {
  if (!cond) throw new Error(name);
  console.log("ok", name);
}

check("60min", computeLineAmountCents(60, 25000, true) === 25000);
check("30min", computeLineAmountCents(30, 25000, true) === 12500);
check("null rate", computeLineAmountCents(60, null, true) === null);
check("nonbill", computeLineAmountCents(60, 25000, false) === 0);
check("issue draft", canTransitionInvoiceStatus("draft", "issue").ok === true);
check("issue issued", canTransitionInvoiceStatus("issued", "issue").ok === false);
check("minutes0", /at least 1/.test(assertValidMinutes(0) ?? ""));
check("rate neg", /negative/.test(assertValidHourlyRateCents(-1) ?? ""));
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
  ],
  new Set(),
);
check("select", selected.length === 1 && selected[0].id === "a");
const totals = rollupInvoiceTotals(
  buildInvoiceLineDrafts([
    {
      id: "1",
      status: "posted",
      minutes: 60,
      billable: true,
      hourlyRateCents: 20000,
      description: "r",
    },
    {
      id: "2",
      status: "posted",
      minutes: 30,
      billable: true,
      hourlyRateCents: 20000,
      description: "c",
    },
  ]),
);
check("totals", totals.totalCents === 30000 && totals.totalMinutes === 90);
console.log("UNIT_OK");
