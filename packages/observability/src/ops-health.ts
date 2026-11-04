/**
 * WP-05 — operational health classification and alert policy definitions.
 * Pure functions; no network I/O. Safe for unit tests and deploy preflight.
 */

export type OpsHealthStatus = "HEALTHY" | "DEGRADED" | "UNAVAILABLE";

export type DependencyCheck = {
  name: string;
  status: OpsHealthStatus;
  /** Operator-facing detail; must not contain secrets. */
  detail?: string;
  /** When true, UNAVAILABLE forces overall readiness failure. */
  requiredForReady?: boolean;
};

export type AlertSeverity = "page" | "ticket" | "info";

export type AlertPolicy = {
  id: string;
  description: string;
  severity: AlertSeverity;
  /** Human-readable threshold; routing destination is external until configured. */
  threshold: string;
  /** Suggested metric / signal name. */
  signal: string;
};

/** Build / deploy identity for live probes (never invents a SHA). */
export function resolveBuildIdentity(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { gitSha: string | null; buildId: string | null; appEnv: string } {
  const gitSha =
    String(env.GIT_SHA ?? env.GITHUB_SHA ?? env.VERCEL_GIT_COMMIT_SHA ?? "").trim() || null;
  const buildId = String(env.BUILD_ID ?? env.GITHUB_RUN_ID ?? "").trim() || null;
  const appEnv = String(env.APP_ENV ?? env.NODE_ENV ?? "development").trim() || "development";
  return { gitSha, buildId, appEnv };
}

export function classifyDependency(params: { ok: boolean; degraded?: boolean }): OpsHealthStatus {
  if (!params.ok) return "UNAVAILABLE";
  if (params.degraded) return "DEGRADED";
  return "HEALTHY";
}

/**
 * Aggregate dependency checks into overall readiness.
 * UNAVAILABLE required deps → UNAVAILABLE.
 * Any DEGRADED (or optional UNAVAILABLE) → DEGRADED.
 */
export function aggregateOpsHealth(checks: DependencyCheck[]): {
  status: OpsHealthStatus;
  ready: boolean;
  checks: DependencyCheck[];
} {
  let status: OpsHealthStatus = "HEALTHY";
  let ready = true;
  for (const check of checks) {
    if (check.status === "UNAVAILABLE" && check.requiredForReady !== false) {
      status = "UNAVAILABLE";
      ready = false;
    } else if (check.status === "UNAVAILABLE" || check.status === "DEGRADED") {
      if (status === "HEALTHY") status = "DEGRADED";
    }
  }
  return { status, ready, checks };
}

/**
 * Default NyayaGrid alert policies. Destination (PagerDuty/Opsgenie/email) is EXTERNAL —
 * these definitions are the engineering contract until an on-call vendor is wired.
 */
export const DEFAULT_ALERT_POLICIES: readonly AlertPolicy[] = [
  {
    id: "ready-probe-failing",
    description: "GET /api/health/ready returns non-200",
    severity: "page",
    threshold: "2 consecutive failures within 2 minutes",
    signal: "http.health.ready",
  },
  {
    id: "api-5xx-elevated",
    description: "Elevated 5xx rate on application routes",
    severity: "page",
    threshold: ">2% of requests over 5 minutes",
    signal: "http.server.5xx_rate",
  },
  {
    id: "malware-scanner-down",
    description: "ClamAV / malware scanner unreachable while MALWARE_SCANNER=clamav",
    severity: "page",
    threshold: "probe failure for 3 minutes",
    signal: "deps.clamav.available",
  },
  {
    id: "database-unreachable",
    description: "Product DATABASE_URL connectivity failure",
    severity: "page",
    threshold: "any ready-check failure",
    signal: "deps.database.available",
  },
  {
    id: "redis-unreachable",
    description: "Redis unavailable while RATE_LIMIT_PROVIDER=redis",
    severity: "page",
    threshold: "any ready-check failure",
    signal: "deps.redis.available",
  },
  {
    id: "storage-degraded",
    description: "Object storage ensureBucket / health degraded",
    severity: "ticket",
    threshold: "degraded for 10 minutes",
    signal: "deps.storage.status",
  },
  {
    id: "ocr-unavailable",
    description: "OCR endpoint failing while FEATURE_OCR=1",
    severity: "ticket",
    threshold: "error rate >50% over 15 minutes",
    signal: "deps.ocr.available",
  },
  {
    id: "ai-provider-errors",
    description: "AI provider error / timeout spike",
    severity: "ticket",
    threshold: ">10 errors in 5 minutes",
    signal: "ai.provider.error_count",
  },
  {
    id: "research-corpus-unavailable",
    description: "Neon corpus research path unavailable while flag ON",
    severity: "ticket",
    threshold: "any fail-closed RESEARCH_CORPUS_UNAVAILABLE",
    signal: "research.corpus.available",
  },
  {
    id: "deploy-failed",
    description: "CI/CD deploy or migration job failed",
    severity: "page",
    threshold: "any failure on protected environment",
    signal: "ci.deploy.conclusion",
  },
  {
    id: "backup-stale",
    description: "Local/managed backup freshness exceeded RPO interim window",
    severity: "ticket",
    threshold: "no successful rehearsal/report newer than 24h (interim RPO)",
    signal: "ops.backup.freshness",
  },
] as const;

export function listPageSeverityAlerts(): AlertPolicy[] {
  return DEFAULT_ALERT_POLICIES.filter((p) => p.severity === "page");
}

/** Backup freshness vs interim RPO (24h for local dumps; managed PITR is separate). */
export function evaluateBackupFreshness(params: {
  lastSuccessAt: string | Date | null | undefined;
  now?: Date;
  maxAgeMs?: number;
}): { fresh: boolean; ageMs: number | null; maxAgeMs: number } {
  const maxAgeMs = params.maxAgeMs ?? 24 * 60 * 60 * 1000;
  if (!params.lastSuccessAt) return { fresh: false, ageMs: null, maxAgeMs };
  const at = new Date(params.lastSuccessAt).getTime();
  if (Number.isNaN(at)) return { fresh: false, ageMs: null, maxAgeMs };
  const now = (params.now ?? new Date()).getTime();
  const ageMs = Math.max(0, now - at);
  return { fresh: ageMs <= maxAgeMs, ageMs, maxAgeMs };
}
