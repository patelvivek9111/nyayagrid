/**
 * WP-05 continuous monitoring evaluator — pure state machine.
 * No network I/O. Safe for unit tests and schedulers.
 */

import { DEFAULT_ALERT_POLICIES, type AlertPolicy } from "./ops-health";

export type ProbeSample = {
  at: string;
  httpStatus: number | null;
  ok: boolean;
  latencyMs: number | null;
  checks?: Record<string, string | undefined>;
  error?: string;
};

export type PolicyRuntimeState = {
  policyId: string;
  status: "ok" | "firing";
  consecutiveFailures: number;
  lastTransitionAt: string | null;
  lastNotifiedAt: string | null;
  lastEvaluatedAt: string | null;
};

export type MonitorState = {
  version: 1;
  lastSuccessfulProbeAt: string | null;
  lastProbeAt: string | null;
  lastWorkerHeartbeatAt: string | null;
  policies: Record<string, PolicyRuntimeState>;
};

export type AlertTransition = {
  policyId: string;
  status: "firing" | "resolved";
  severity: AlertPolicy["severity"];
  signal: string;
  message: string;
  at: string;
};

export type MonitorConfig = {
  /** Failures required before firing ready-probe-failing. */
  readyFailureThreshold: number;
  /** Suppress re-notify while still firing (ms). */
  cooldownMs: number;
  /** Max age of lastSuccessfulProbeAt before monitoring-worker-stale fires. */
  workerStaleMs: number;
  /** Latency page threshold (ms); null disables. */
  latencyMsThreshold: number | null;
  /** Whether OCR is enabled in the target env. */
  ocrEnabled: boolean;
  /** Host label for alert payloads (no secrets). */
  host: string;
};

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  readyFailureThreshold: 2,
  cooldownMs: 15 * 60 * 1000,
  workerStaleMs: 10 * 60 * 1000,
  latencyMsThreshold: 8_000,
  ocrEnabled: false,
  host: "https://staging.nyayagrid.com",
};

export function emptyMonitorState(): MonitorState {
  return {
    version: 1,
    lastSuccessfulProbeAt: null,
    lastProbeAt: null,
    lastWorkerHeartbeatAt: null,
    policies: {},
  };
}

function policyOrInit(state: MonitorState, policyId: string): PolicyRuntimeState {
  const existing = state.policies[policyId];
  if (existing) return existing;
  const init: PolicyRuntimeState = {
    policyId,
    status: "ok",
    consecutiveFailures: 0,
    lastTransitionAt: null,
    lastNotifiedAt: null,
    lastEvaluatedAt: null,
  };
  state.policies[policyId] = init;
  return init;
}

function shouldNotify(rt: PolicyRuntimeState, nowMs: number, cooldownMs: number): boolean {
  if (!rt.lastNotifiedAt) return true;
  const last = Date.parse(rt.lastNotifiedAt);
  if (Number.isNaN(last)) return true;
  return nowMs - last >= cooldownMs;
}

function findPolicy(id: string): AlertPolicy | undefined {
  return DEFAULT_ALERT_POLICIES.find((p) => p.id === id);
}

/**
 * Evaluate one probe sample against monitor state.
 * Returns transitions that should be delivered (deduped / cooled down).
 */
export function evaluateProbe(params: {
  state: MonitorState;
  sample: ProbeSample;
  config?: Partial<MonitorConfig>;
  now?: Date;
}): { state: MonitorState; transitions: AlertTransition[] } {
  const config: MonitorConfig = { ...DEFAULT_MONITOR_CONFIG, ...params.config };
  const now = params.now ?? new Date();
  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  const state: MonitorState = structuredClone(params.state);
  const transitions: AlertTransition[] = [];
  const sample = params.sample;

  state.lastProbeAt = sample.at;
  state.lastWorkerHeartbeatAt = nowIso;
  if (sample.ok) state.lastSuccessfulProbeAt = sample.at;

  const checks = sample.checks ?? {};

  type Eval = {
    policyId: string;
    failing: boolean;
    message: string;
  };

  const evals: Eval[] = [
    {
      policyId: "ready-probe-failing",
      failing: !sample.ok || sample.httpStatus !== 200,
      message: sample.ok
        ? `ready probe recovered (http=${sample.httpStatus})`
        : `ready probe failing (http=${sample.httpStatus ?? "null"} err=${sample.error ?? "none"})`,
    },
    {
      policyId: "application-unreachable",
      failing: sample.httpStatus === null || sample.httpStatus === 0,
      message:
        sample.httpStatus === null
          ? `application unreachable (${sample.error ?? "network error"})`
          : "application reachable",
    },
    {
      policyId: "database-unreachable",
      failing: sample.ok === false && checks.database === "fail",
      message:
        checks.database === "fail"
          ? "database dependency UNAVAILABLE on ready probe"
          : "database dependency ok or not observed",
    },
    {
      policyId: "redis-unreachable",
      failing: sample.ok === false && checks.redis === "fail",
      message:
        checks.redis === "fail"
          ? "redis dependency UNAVAILABLE on ready probe"
          : "redis dependency ok or not observed",
    },
    {
      policyId: "storage-degraded",
      failing: checks.storage === "fail" || checks.storage === "degraded",
      message:
        checks.storage === "fail" || checks.storage === "degraded"
          ? `object storage ${checks.storage}`
          : "object storage ok or not observed",
    },
    {
      policyId: "malware-scanner-down",
      failing: checks.clamav === "fail",
      message:
        checks.clamav === "fail"
          ? "ClamAV unavailable while required"
          : "ClamAV ok, disabled, or not observed",
    },
  ];

  if (config.ocrEnabled) {
    evals.push({
      policyId: "ocr-unavailable",
      failing: checks.ocr === "fail",
      message: checks.ocr === "fail" ? "OCR unavailable while enabled" : "OCR ok or not observed",
    });
  }

  if (config.latencyMsThreshold != null && sample.latencyMs != null) {
    evals.push({
      policyId: "ready-latency-elevated",
      failing: sample.latencyMs > config.latencyMsThreshold,
      message:
        sample.latencyMs > config.latencyMsThreshold
          ? `ready latency ${sample.latencyMs}ms exceeds ${config.latencyMsThreshold}ms`
          : `ready latency ${sample.latencyMs}ms within threshold`,
    });
  }

  // monitoring-worker-stale is evaluated against prior heartbeat (before this tick updates it).
  // Use lastSuccessfulProbeAt age as worker liveness proxy for external schedulers.
  const lastOk = state.lastSuccessfulProbeAt ? Date.parse(state.lastSuccessfulProbeAt) : null;
  const stale =
    lastOk == null
      ? false // first ticks: don't fire stale until we have history
      : nowMs - lastOk > config.workerStaleMs && !sample.ok;
  evals.push({
    policyId: "monitoring-worker-stale",
    failing: stale,
    message: stale
      ? "no successful ready probe within worker stale window while currently failing"
      : "monitor worker heartbeat fresh or probe succeeding",
  });

  for (const item of evals) {
    const policy = findPolicy(item.policyId);
    if (!policy) continue;
    const rt = policyOrInit(state, item.policyId);
    rt.lastEvaluatedAt = nowIso;

    if (item.policyId === "ready-probe-failing") {
      if (item.failing) rt.consecutiveFailures += 1;
      else rt.consecutiveFailures = 0;
    }

    const thresholdMet =
      item.policyId === "ready-probe-failing"
        ? rt.consecutiveFailures >= config.readyFailureThreshold
        : item.failing;

    if (thresholdMet && rt.status === "ok") {
      rt.status = "firing";
      rt.lastTransitionAt = nowIso;
      if (shouldNotify(rt, nowMs, config.cooldownMs)) {
        rt.lastNotifiedAt = nowIso;
        transitions.push({
          policyId: item.policyId,
          status: "firing",
          severity: policy.severity,
          signal: policy.signal,
          message: item.message.slice(0, 500),
          at: nowIso,
        });
      }
    } else if (!thresholdMet && rt.status === "firing") {
      // Always emit recovery — cooldown applies to repeat firing only.
      rt.status = "ok";
      rt.lastTransitionAt = nowIso;
      rt.lastNotifiedAt = nowIso;
      transitions.push({
        policyId: item.policyId,
        status: "resolved",
        severity: policy.severity,
        signal: policy.signal,
        message: item.message.slice(0, 500),
        at: nowIso,
      });
    } else if (thresholdMet && rt.status === "firing") {
      // still firing — cooldown suppresses duplicate pages
      if (shouldNotify(rt, nowMs, config.cooldownMs)) {
        rt.lastNotifiedAt = nowIso;
        transitions.push({
          policyId: item.policyId,
          status: "firing",
          severity: policy.severity,
          signal: policy.signal,
          message: `still firing: ${item.message}`.slice(0, 500),
          at: nowIso,
        });
      }
    }
  }

  return { state, transitions };
}

/** Map ready JSON body checks to monitor check map (ok|fail|degraded). */
export function mapReadyChecks(
  body: {
    ok?: boolean;
    status?: string;
    checks?: Record<string, unknown>;
  } | null,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!body?.checks || typeof body.checks !== "object") return out;
  for (const [k, v] of Object.entries(body.checks)) {
    if (typeof v === "string") {
      if (v === "ok" || v === "disabled" || v === "off" || v === "live") out[k] = "ok";
      else if (v === "fail" || v === "error" || v === "unavailable") out[k] = "fail";
      else if (v === "degraded") out[k] = "degraded";
      else out[k] = v;
    }
  }
  return out;
}
