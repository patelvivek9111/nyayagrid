/** Week 6 production hardening taxonomy. */

export const WEEK6_DATASET_ID = "week6-production-hardening";
export const WEEK6_DATASET_VERSION = "week6-2026-10-05";
export const WEEK6_GRADER_VERSION = "week6-grade-2026-10-05";

export const WEEK6_AUDIT = {
  EXISTING: [
    "permissions RBAC/IDOR integration suites",
    "e2e/security.spec.ts",
    "platform rate-limit presets + API enforceRateLimit",
    "documents malware + signed download URLs",
    "jobs InMemoryJobDispatcher idempotency",
    "ops:backup-rehearse + docs/BACKUP_RESTORE.md",
    "platform usage/cost estimateCostCents",
    "observability structured logs + health live/ready",
    "benchmarks/performance harness",
    "bench:week5 deterministic certification",
  ],
  EXTEND: [
    "Guide consultation returns UI packet shape + rate limit",
    "Guide prepare defensive packet normalization",
    "Week 6 large synthetic matter/case fixtures",
    "Week 6 security/reliability/perf certification runner",
  ],
  NEW: [
    "datasets/week6 threat + control matrix",
    "runner/week6 deterministic production-hardening cert",
  ],
  VALIDATE: [
    "npm run bench:week6",
    "npm run bench:week5",
    "e2e/guide.spec.ts prepare packet UI",
    "e2e/security.spec.ts",
    "ops:backup-rehearse (when docker available)",
    "npm audit --omit=dev",
  ],
} as const;

export type ThreatRow = {
  id: string;
  attack: string;
  component: string;
  existingControl: string;
  test: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  remainingRisk: string;
};

export const WEEK6_THREAT_MODEL: ThreatRow[] = [
  {
    id: "T-CROSS-TENANT",
    attack: "Cross-tenant matter/document/case access",
    component: "API + retrieval",
    existingControl: "requireCapability + organization scoping on queries",
    test: "W6-SEC-ISOLATION + permissions phase suites",
    severity: "CRITICAL",
    remainingRisk: "New endpoints must wire authorize checks",
  },
  {
    id: "T-IDOR",
    attack: "IDOR via forged matter/case/document IDs",
    component: "REST routes",
    existingControl: "matter/case ownership asserts; e2e forged IDs",
    test: "e2e/security.spec.ts + W6-SEC-IDOR",
    severity: "CRITICAL",
    remainingRisk: "Export/admin routes need continuous coverage",
  },
  {
    id: "T-ROLE-ESCALATION",
    attack: "Self-promote or invite superior role",
    component: "memberships/invites",
    existingControl: "capability-gated invite + role assignment",
    test: "permissions invite/role tests",
    severity: "CRITICAL",
    remainingRisk: "Owner transfer remains privileged path",
  },
  {
    id: "T-PROMPT-INJECTION",
    attack: "Document instructions override system",
    component: "Ask Nyaya / Guide / retrieval",
    existingControl: "document text treated as data; Week5 W5-SEC-02",
    test: "W6-SEC-INJECTION",
    severity: "HIGH",
    remainingRisk: "Model non-determinism in live mode",
  },
  {
    id: "T-UPLOAD",
    attack: "Malicious/oversized upload",
    component: "documents pipeline",
    existingControl: "malware scan job + size/type validation",
    test: "W6-SEC-UPLOAD policy checks",
    severity: "HIGH",
    remainingRisk: "ClamAV required in production",
  },
  {
    id: "T-SIGNED-URL",
    attack: "Predictable or long-lived object URL",
    component: "MinIO signed downloads",
    existingControl: "short-lived signed URLs after authz",
    test: "documents download authorization path",
    severity: "HIGH",
    remainingRisk: "Clock skew / URL reuse window",
  },
  {
    id: "T-ABUSE",
    attack: "API/Ask/upload flood",
    component: "rate limiter",
    existingControl: "ENDPOINT_CLASSES presets",
    test: "W6-SEC-RATE-LIMIT",
    severity: "HIGH",
    remainingRisk: "memory limiter is single-instance",
  },
  {
    id: "T-JOB-DUPLICATE",
    attack: "Duplicate job delivery",
    component: "background jobs",
    existingControl: "idempotency keys",
    test: "packages/jobs idempotency + W6-REL-DUP",
    severity: "HIGH",
    remainingRisk: "New jobs must declare keys",
  },
  {
    id: "T-PROVIDER-FAIL",
    attack: "AI/storage/DB outage",
    component: "providers + workers",
    existingControl: "bounded retries, explicit failure states",
    test: "W6-REL-PROVIDER + classifyFailure",
    severity: "HIGH",
    remainingRisk: "Staging alerting still external",
  },
  {
    id: "T-SECRET",
    attack: "Secret exposure in repo/logs",
    component: "config/logs",
    existingControl: "observability redaction + env secrets",
    test: "W6-SEC-SECRET-SCAN heuristics",
    severity: "CRITICAL",
    remainingRisk: "Human review of new fixtures",
  },
];
