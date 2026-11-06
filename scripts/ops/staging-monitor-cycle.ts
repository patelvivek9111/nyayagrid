#!/usr/bin/env npx tsx
/**
 * WP-05 staging continuous monitor — one evaluation cycle.
 * Never prints secrets.
 *
 * Env:
 *   MONITOR_READY_URL, MONITOR_STATE_PATH, MONITOR_PROBE_TIMEOUT_MS
 *   MONITOR_NOTIFY = off | memory | smtp
 *   MONITOR_REQUIRE_SMTP = 1 → refuse if notify!=smtp or SMTP config incomplete
 *   SMTP_* / EMAIL_FROM / OPS_ALERT_TO for smtp mode
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  emptyMonitorState,
  evaluateProbe,
  mapReadyChecks,
  type MonitorState,
} from "../../packages/observability/src/continuous-monitor.ts";
import {
  deliverAlert,
  MemoryAlertTransport,
} from "../../packages/observability/src/alert-delivery.ts";
import {
  SmtpAlertTransport,
  smtpConfigFromEnv,
} from "../../packages/observability/src/smtp-alert-transport.ts";

const READY_URL =
  process.env.MONITOR_READY_URL?.trim() || "https://staging.nyayagrid.com/api/health/ready";
const STATE_PATH = resolve(
  process.env.MONITOR_STATE_PATH?.trim() || ".monitor-state/staging-monitor-state.json",
);
const TIMEOUT_MS = Number(process.env.MONITOR_PROBE_TIMEOUT_MS || 10_000);
const NOTIFY_MODE = (process.env.MONITOR_NOTIFY || "off").toLowerCase();
const REQUIRE_SMTP =
  process.env.MONITOR_REQUIRE_SMTP === "1" ||
  process.env.MONITOR_REQUIRE_SMTP === "true" ||
  process.env.MONITOR_REQUIRE_SMTP === "yes";

function smtpSecretsPresent(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { ok: boolean; missing: string[] } {
  const required = [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USERNAME",
    "SMTP_PASSWORD",
    "EMAIL_FROM",
    "OPS_ALERT_TO",
  ] as const;
  const missing = required.filter((k) => !String(env[k] ?? "").trim());
  // EMAIL_FROM may also be provided as SMTP_FROM by some hosts
  if (missing.includes("EMAIL_FROM") && String(env.SMTP_FROM ?? "").trim()) {
    return {
      ok: missing.filter((m) => m !== "EMAIL_FROM").length === 0,
      missing: missing.filter((m) => m !== "EMAIL_FROM"),
    };
  }
  // OPS_ALERT_TO may fall back inside smtpConfigFromEnv — still require explicit for live coverage
  return { ok: missing.length === 0, missing };
}

async function probe(url: string) {
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: ac.signal,
      headers: { accept: "application/json" },
    });
    const latencyMs = Date.now() - started;
    let body: { ok?: boolean; status?: string; checks?: Record<string, unknown> } | null = null;
    try {
      body = (await res.json()) as typeof body;
    } catch {
      body = null;
    }
    return {
      at: new Date().toISOString(),
      httpStatus: res.status as number | null,
      ok: Boolean(res.ok && body?.ok === true && body?.status === "HEALTHY"),
      latencyMs,
      body,
      error: undefined as string | undefined,
    };
  } catch (err) {
    return {
      at: new Date().toISOString(),
      httpStatus: null as number | null,
      ok: false,
      latencyMs: Date.now() - started,
      body: null,
      error: String((err as Error)?.name || err).slice(0, 120),
    };
  } finally {
    clearTimeout(timer);
  }
}

function readState(): MonitorState {
  if (!existsSync(STATE_PATH)) return emptyMonitorState();
  try {
    return JSON.parse(readFileSync(STATE_PATH, "utf8")) as MonitorState;
  } catch {
    return emptyMonitorState();
  }
}

function writeState(state: MonitorState) {
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

async function main() {
  if (REQUIRE_SMTP && NOTIFY_MODE !== "smtp") {
    console.log(
      JSON.stringify({
        classification: "NYAYAGRID_WP05_CONTINUOUS_MONITOR_CYCLE",
        result: "NOTIFICATION_MISCONFIGURED",
        error:
          "MONITOR_REQUIRE_SMTP=1 but MONITOR_NOTIFY is not smtp — refusing silent notify-off coverage claim",
        notifyMode: NOTIFY_MODE,
        notificationCoverage: false,
      }),
    );
    process.exit(2);
  }

  if (NOTIFY_MODE === "smtp") {
    const check = smtpSecretsPresent();
    if (!check.ok) {
      console.log(
        JSON.stringify({
          classification: "NYAYAGRID_WP05_CONTINUOUS_MONITOR_CYCLE",
          result: "SMTP_SECRETS_MISSING",
          error: `Missing SMTP env (names only): ${check.missing.join(",")}`,
          notificationCoverage: false,
        }),
      );
      process.exit(2);
    }
  }

  const prior = readState();
  const probed = await probe(READY_URL);
  const checks = mapReadyChecks(probed.body);
  const { state, transitions } = evaluateProbe({
    state: prior,
    sample: {
      at: probed.at,
      httpStatus: probed.httpStatus,
      ok: probed.ok,
      latencyMs: probed.latencyMs,
      checks,
      error: probed.error,
    },
    config: {
      host: READY_URL.replace(/\/api\/health\/ready$/, ""),
      ocrEnabled: String(process.env.OCR_PROVIDER || "none") !== "none",
    },
  });
  writeState(state);

  const deliveries: Array<{
    policyId: string;
    status: string;
    delivered: boolean;
    detail: string;
  }> = [];
  let transportName = "off";
  let notificationCoverage = false;

  if (NOTIFY_MODE === "memory") {
    transportName = "memory";
    notificationCoverage = false;
    const transport = new MemoryAlertTransport();
    for (const t of transitions) {
      const r = await deliverAlert(transport, {
        policyId: t.policyId,
        message: t.message,
        host: READY_URL.replace(/\/api\/health\/ready$/, ""),
        status: t.status,
      });
      deliveries.push({
        policyId: t.policyId,
        status: t.status,
        delivered: r.delivered,
        detail: r.detail,
      });
    }
  } else if (NOTIFY_MODE === "smtp") {
    transportName = "smtp";
    notificationCoverage = true;
    const transport = new SmtpAlertTransport(smtpConfigFromEnv(process.env));
    for (const t of transitions) {
      try {
        const r = await deliverAlert(transport, {
          policyId: t.policyId,
          message: t.message,
          host: READY_URL.replace(/\/api\/health\/ready$/, ""),
          status: t.status,
        });
        deliveries.push({
          policyId: t.policyId,
          status: t.status,
          delivered: r.delivered,
          detail: "smtp:accepted",
        });
      } catch (err) {
        deliveries.push({
          policyId: t.policyId,
          status: t.status,
          delivered: false,
          detail: String((err as Error).message || err).slice(0, 160),
        });
      }
    }
  } else {
    transportName = "off";
    notificationCoverage = false;
    for (const t of transitions) {
      deliveries.push({
        policyId: t.policyId,
        status: t.status,
        delivered: false,
        detail: "notify_off",
      });
    }
  }

  const failedSmtp = NOTIFY_MODE === "smtp" && deliveries.some((d) => !d.delivered);

  const report = {
    classification: "NYAYAGRID_WP05_CONTINUOUS_MONITOR_CYCLE",
    at: new Date().toISOString(),
    readyUrlHost: new URL(READY_URL).host,
    probe: {
      ok: probed.ok,
      httpStatus: probed.httpStatus,
      latencyMs: probed.latencyMs,
      error: probed.error ?? null,
      checks,
    },
    transitions: transitions.map((t) => ({
      policyId: t.policyId,
      status: t.status,
      severity: t.severity,
    })),
    deliveries,
    notifyMode: transportName,
    notificationCoverage,
    lastSuccessfulProbeAt: state.lastSuccessfulProbeAt,
    lastWorkerHeartbeatAt: state.lastWorkerHeartbeatAt,
    result: failedSmtp ? "SMTP_DELIVERY_FAILED" : probed.ok ? "PROBE_HEALTHY" : "PROBE_UNHEALTHY",
  };

  console.log(JSON.stringify(report, null, 2));

  if (failedSmtp) process.exit(1);
  // Probe unhealthy is an alert condition, not a monitor-infra failure.
  process.exit(0);
}

main().catch((err) => {
  console.error(
    JSON.stringify({
      classification: "NYAYAGRID_WP05_CONTINUOUS_MONITOR_CYCLE",
      result: "MONITOR_CYCLE_ERROR",
      notificationCoverage: false,
      error: String((err as Error).message || err).slice(0, 300),
    }),
  );
  process.exit(1);
});
