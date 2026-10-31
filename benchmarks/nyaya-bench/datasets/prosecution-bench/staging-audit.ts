/**
 * Staging readiness + CJIS technical gap inventory + pilot checklist (runtime, not markdown).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LIVE_CANARY_PLAN } from "./taxonomy";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

export type Readiness =
  "READY" | "CONFIG_REQUIRED" | "INFRA_REQUIRED" | "EXTERNAL_VALIDATION_REQUIRED";

export type StagingComponent = {
  id: string;
  readiness: Readiness;
  note: string;
};

function exists(rel: string): boolean {
  return existsSync(join(REPO_ROOT, rel));
}

function read(rel: string): string {
  try {
    return readFileSync(join(REPO_ROOT, rel), "utf8");
  } catch {
    return "";
  }
}

export function auditStagingReadiness(): StagingComponent[] {
  const compose = read("docker-compose.yml") + read("compose.yml");
  const envExample = read(".env.example") + read(".env.local.example");
  return [
    {
      id: "DB_POSTGRES",
      readiness: exists("packages/database/src/migrate.ts") ? "CONFIG_REQUIRED" : "INFRA_REQUIRED",
      note: "Migrations present; staging Postgres URL required",
    },
    {
      id: "BACKUP_PITR",
      readiness: exists("scripts/maintenance/rehearse-backup-restore.mjs")
        ? "EXTERNAL_VALIDATION_REQUIRED"
        : "INFRA_REQUIRED",
      note: "Backup rehearse script exists; PITR must be validated in staging",
    },
    {
      id: "REDIS",
      readiness:
        /redis/i.test(compose) || /REDIS/i.test(envExample) ? "CONFIG_REQUIRED" : "INFRA_REQUIRED",
      note: "Redis config expected via env/compose",
    },
    {
      id: "S3_OBJECT_STORAGE",
      readiness:
        /S3|MINIO|BUCKET/i.test(envExample) || /minio/i.test(compose)
          ? "CONFIG_REQUIRED"
          : "INFRA_REQUIRED",
      note: "S3-compatible storage; staging bucket + credentials required",
    },
    {
      id: "CLAMAV",
      readiness: exists("scripts/maintenance/verify-clamav.mjs")
        ? "CONFIG_REQUIRED"
        : "INFRA_REQUIRED",
      note: "ClamAV verify script present; staging malware path required",
    },
    {
      id: "INNGEST",
      readiness: /INNGEST/i.test(envExample) ? "CONFIG_REQUIRED" : "INFRA_REQUIRED",
      note: "Background jobs require Inngest staging credentials",
    },
    {
      id: "CLERK_AUTH",
      readiness: /CLERK/i.test(envExample) ? "CONFIG_REQUIRED" : "INFRA_REQUIRED",
      note: "Clerk application + redirect URLs required",
    },
    {
      id: "MFA",
      readiness: "EXTERNAL_VALIDATION_REQUIRED",
      note: "MFA path depends on Clerk org policies — validate with design partner",
    },
    {
      id: "SMTP_NOTIFICATIONS",
      readiness: /SMTP|RESEND|POSTMARK|EMAIL/i.test(envExample)
        ? "CONFIG_REQUIRED"
        : "INFRA_REQUIRED",
      note: "No real outbound email in Stage 7; staging mock/provider config required",
    },
    {
      id: "DOMAIN_TLS",
      readiness: "INFRA_REQUIRED",
      note: "Design-partner domain + TLS certificates not provisioned by this stage",
    },
    {
      id: "HOSTING_RUNTIME",
      readiness: "INFRA_REQUIRED",
      note: "Hosting/runtime selection remains operator-owned",
    },
    {
      id: "MONITORING_ALERTS",
      readiness: exists("packages/observability/src") ? "CONFIG_REQUIRED" : "INFRA_REQUIRED",
      note: "Observability package present; staging sinks/alerts required",
    },
    {
      id: "ROLLBACK",
      readiness: exists("packages/database/drizzle") ? "CONFIG_REQUIRED" : "INFRA_REQUIRED",
      note: "Migration down scripts exist for recent stages; staging rollback drill required",
    },
  ];
}

export type CjisGap = {
  id: string;
  area: string;
  gap: string;
  severity: "BLOCKING_FOR_CJIS_CLAIM" | "REQUIRES_PROGRAM" | "TECHNICAL_PARTIAL";
};

/** Technical gaps only — NOT a certification. */
export function auditCjisTechnicalGaps(): CjisGap[] {
  return [
    {
      id: "CJIS-01",
      area: "access control / MFA",
      gap: "MFA and personnel screening policies are IdP/org process, not product-certified here",
      severity: "REQUIRES_PROGRAM",
    },
    {
      id: "CJIS-02",
      area: "encryption at rest",
      gap: "Depends on managed Postgres/S3 encryption settings in staging/production",
      severity: "REQUIRES_PROGRAM",
    },
    {
      id: "CJIS-03",
      area: "encryption in transit",
      gap: "TLS termination and cipher policy are infrastructure-owned",
      severity: "REQUIRES_PROGRAM",
    },
    {
      id: "CJIS-04",
      area: "audit logging",
      gap: "Application audit events exist; retention, immutability, and SIEM export need program controls",
      severity: "TECHNICAL_PARTIAL",
    },
    {
      id: "CJIS-05",
      area: "vendor/provider exposure",
      gap: "Frontier model providers process prompts; CJIS path requires separate contractual/technical controls",
      severity: "BLOCKING_FOR_CJIS_CLAIM",
    },
    {
      id: "CJIS-06",
      area: "media / retention / incident handling",
      gap: "Retention, legal hold, and incident response runbooks are outside this Stage 7 code audit",
      severity: "REQUIRES_PROGRAM",
    },
  ];
}

export function pilotAcceptanceChecklist(): string[] {
  return [
    "office onboarding",
    "role setup (admin/supervisor/prosecutor/investigator/support/read-only)",
    "case creation + assignment",
    "case ingest / documents",
    "evidence + chain of custody review",
    "witnesses + statement comparison",
    "discovery + disclosure human review",
    "research with source grounding",
    "drafts remain DRAFT until human approval",
    "tasks / deadlines with provenance",
    "supervisor review + queues",
    "audit history review",
    "backup/restore drill",
    "support escalation path",
    "rollback plan",
    "AI disclosure shown to users",
    "human-decision boundaries trained",
    "live-model canary authorized separately",
  ];
}

export function liveCanaryPlan() {
  return LIVE_CANARY_PLAN;
}
