#!/usr/bin/env node
/**
 * WP-05 synthetic alert rehearsal.
 *
 * Sends privacy-safe firing + resolved alerts for ready-probe-failing.
 * Does NOT take the application down. Does NOT invent successful delivery —
 * exit code reflects SMTP/transport outcome.
 *
 * Env:
 *   OPS_ALERT_TRANSPORT=memory|console|smtp (default memory)
 *   OPS_ALERT_TO (default patelvivek9111@gmail.com)
 *   SMTP_* / EMAIL_FROM when transport=smtp
 *
 * Usage:
 *   node scripts/maintenance/alert-rehearse.mjs
 *   OPS_ALERT_TRANSPORT=smtp node scripts/maintenance/alert-rehearse.mjs
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const reportPath = join(
  __dirname,
  "../../packages/research/corpus/reports/wp05-alert-rehearsal.json",
);

const transportName = String(process.env.OPS_ALERT_TRANSPORT ?? "memory").toLowerCase();
const host = process.env.OPS_ALERT_HOST ?? "https://staging.nyayagrid.com";

async function loadObservability() {
  // Prefer built/source via workspace package resolution when available.
  try {
    return await import("@nyayagrid/observability");
  } catch {
    // Fall back to compiled-free direct TS is not available in plain node;
    // use inline minimal path via tsx if operator runs through npm script.
    throw new Error(
      "Unable to import @nyayagrid/observability. Run via: npm run ops:alert-rehearse",
    );
  }
}

async function main() {
  const obs = await loadObservability();
  const { deliverAlert, MemoryAlertTransport, ConsoleAlertTransport } = obs;
  let transport;
  if (transportName === "smtp") {
    const { SmtpAlertTransport, smtpConfigFromEnv } = obs;
    transport = new SmtpAlertTransport(smtpConfigFromEnv(process.env));
  } else if (transportName === "console") {
    transport = new ConsoleAlertTransport();
  } else {
    transport = new MemoryAlertTransport();
  }

  const firing = await deliverAlert(transport, {
    policyId: "ready-probe-failing",
    message: "Synthetic readiness failure (WP-05 staging rehearsal — not a real outage)",
    host,
    status: "firing",
  });
  const resolved = await deliverAlert(transport, {
    policyId: "ready-probe-failing",
    message: "Synthetic readiness recovery (WP-05 staging rehearsal)",
    host,
    status: "resolved",
  });

  const report = {
    classification: "NYAYAGRID_WP05_ALERT_REHEARSAL",
    at: new Date().toISOString(),
    transport: transport.name,
    destination:
      transportName === "smtp"
        ? (process.env.OPS_ALERT_TO ?? "patelvivek9111@gmail.com")
        : transport.name,
    firing: {
      delivered: firing.delivered,
      detail: firing.detail,
      at: firing.event.at,
      status: firing.event.status,
    },
    resolved: {
      delivered: resolved.delivered,
      detail: resolved.detail,
      at: resolved.event.at,
      status: resolved.event.status,
    },
    acknowledgment: {
      verified: false,
      note: "Operator must confirm inbox receipt and reply/ack; automation cannot certify human acknowledgment.",
    },
    result:
      firing.delivered && resolved.delivered
        ? transportName === "smtp"
          ? "SMTP_ACCEPTED_OPERATOR_ACK_PENDING"
          : "LOCAL_TRANSPORT_PASS"
        : "FAIL",
  };

  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (report.result === "FAIL") process.exit(1);
}

main().catch((err) => {
  const report = {
    classification: "NYAYAGRID_WP05_ALERT_REHEARSAL",
    at: new Date().toISOString(),
    result: "ERROR",
    error: String(err?.message ?? err).slice(0, 400),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
});
