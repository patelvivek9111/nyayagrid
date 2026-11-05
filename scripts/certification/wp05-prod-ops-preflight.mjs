#!/usr/bin/env node
/**
 * WP-05 FIXABLE_NOW production-ops engineering inventory.
 *
 * Verifies required docs/scripts/workflows exist and classifies each gate.
 * Does NOT deploy production, mutate Neon topology, or call CourtListener/paid AI.
 *
 * Usage: npm run ops:prod-ops-preflight
 * Exit 0 = engineering inventory complete (may still have EXTERNAL_BLOCKED items)
 * Exit 1 = missing required FIXABLE_NOW engineering artifacts
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function req(rel) {
  const p = join(root, rel);
  return { path: rel, present: existsSync(p) };
}

function readJson(rel) {
  const p = join(root, rel);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return { parseError: true };
  }
}

const requiredArtifacts = [
  ".github/workflows/deploy-staging.yml",
  ".github/workflows/deploy-production-gate.yml",
  ".github/workflows/staging-continuous-monitor.yml",
  ".github/workflows/ci.yml",
  "scripts/maintenance/deploy-preflight.mjs",
  "scripts/maintenance/rehearse-backup-restore.mjs",
  "scripts/maintenance/verify-backup-freshness.mjs",
  "scripts/certification/wp05-pitr-verify.mjs",
  "scripts/certification/wp05-isolation-preflight.mjs",
  "docs/operations/WP05_OPS_RUNBOOK.md",
  "docs/operations/WP05_INCIDENT_RUNBOOKS.md",
  "docs/operations/WP05_PRODUCTION_RELEASE_CHECKLIST.md",
  "docs/operations/WP05_ALERTING.md",
  "docs/operations/WP05_PRODUCT_CORPUS_ISOLATION.md",
  "docs/operations/WP05_MANAGED_PITR_OPERATOR_ACTION.md",
  "docs/operations/WP05_NEON_RECOVERY_POLICY.md",
  "docs/operations/WP05_STORAGE_REDIS_RECOVERY.md",
  "docs/operations/WP05_GITHUB_RELEASE_PROTECTION.md",
  "docs/operations/WP05_AUDIT_SECRETS_PROVENANCE.md",
  "docs/operations/WP05_CARRY_FORWARD_GATES.md",
  "docs/BACKUP_RESTORE.md",
  "docs/security/OCR_PRODUCTION_GATE.md",
  "docs/operations/CLAMAV_STAGING.md",
];

const historicalEvidence = [
  "packages/research/corpus/reports/wp05-pitr-verification.json",
  "packages/research/corpus/reports/wp05-product-branch-isolation.json",
  "packages/research/corpus/reports/wp05-staging-identity-rollback.json",
  "packages/research/corpus/reports/wp05-monitoring-human-ack-verified.json",
  "packages/research/corpus/reports/wp05-continuous-monitor-last-cycle.json",
  "packages/research/corpus/reports/wp05-production-operations-certification.json",
];

const artifactChecks = requiredArtifacts.map(req);
const evidenceChecks = historicalEvidence.map(req);
const missingRequired = artifactChecks.filter((a) => !a.present);
const missingEvidence = evidenceChecks.filter((a) => !a.present);

const pitr = readJson("packages/research/corpus/reports/wp05-pitr-verification.json");
const isolation = readJson("packages/research/corpus/reports/wp05-product-branch-isolation.json");
const rollback = readJson("packages/research/corpus/reports/wp05-staging-identity-rollback.json");
const monAck = readJson("packages/research/corpus/reports/wp05-monitoring-human-ack-verified.json");

const gates = {
  githubReleaseProtection: {
    status: "ENGINEERING_COMPLETE",
    note: "Staging + production gate workflows shipped; Environment reviewers are a human GitHub settings action",
    evidence: [
      ".github/workflows/deploy-staging.yml",
      ".github/workflows/deploy-production-gate.yml",
      "docs/operations/WP05_GITHUB_RELEASE_PROTECTION.md",
    ],
  },
  flyDeploymentSafety: {
    status: "ENGINEERING_COMPLETE",
    note: "deploy-preflight + ops runbook; staging deploy rehearsed historically; PRODUCTION_DEPLOYED=false",
    evidence: ["scripts/maintenance/deploy-preflight.mjs", "docs/operations/WP05_OPS_RUNBOOK.md"],
  },
  databaseTargetVerification: {
    status: "STAGING_VERIFIED",
    note: "Migration authorization + product/corpus isolation; staging product branch isolated",
    evidence: [
      "packages/database/src/product-corpus-isolation.ts",
      "packages/research/corpus/reports/wp05-product-branch-isolation.json",
    ],
    historicalResult: isolation?.result ?? isolation?.status ?? null,
  },
  neonRecoveryPolicy: {
    status: "DOCUMENTED_STAGING_PITR_HISTORICAL",
    note: "Do not re-run staging PITR unless regression; production restore NOT VERIFIED",
    evidence: [
      "docs/operations/WP05_NEON_RECOVERY_POLICY.md",
      "docs/operations/WP05_MANAGED_PITR_OPERATOR_ACTION.md",
      "packages/research/corpus/reports/wp05-pitr-verification.json",
    ],
    historicalResult: pitr?.result ?? null,
  },
  storageRedisRecovery: {
    status: "ENGINEERING_COMPLETE",
    note: "Recovery docs + staging ready redis/storage historically HEALTHY; production DR NOT VERIFIED",
    evidence: ["docs/operations/WP05_STORAGE_REDIS_RECOVERY.md", "docs/operations/WP05_INCIDENT_RUNBOOKS.md"],
  },
  clamavProduction: {
    status: "CARRY_FORWARD",
    note: "WP-04 ClamAV production certification gap; staging ClamAV docs exist",
    evidence: ["docs/operations/CLAMAV_STAGING.md", "docs/operations/WP05_CARRY_FORWARD_GATES.md"],
  },
  ocrRequirements: {
    status: "CARRY_FORWARD",
    note: "WP-04 OCR managed provider + load gate; OCR_PRODUCTION_GATE.md",
    evidence: ["docs/security/OCR_PRODUCTION_GATE.md", "docs/operations/WP05_CARRY_FORWARD_GATES.md"],
  },
  clerkMfa: {
    status: "CARRY_FORWARD",
    note: "WP-04 Clerk MFA live certification outstanding",
    evidence: ["docs/operations/WP05_CARRY_FORWARD_GATES.md"],
  },
  monitoringEscalation: {
    status: "STAGING_VERIFIED_PRODUCTION_OPEN",
    note: "Staging SMTP ready-probe ack verified; production on-call / automated ack NOT VERIFIED",
    evidence: [
      "docs/operations/WP05_ALERTING.md",
      "packages/research/corpus/reports/wp05-monitoring-human-ack-verified.json",
    ],
    historicalAck: monAck?.result ?? monAck?.status ?? null,
  },
  runbooksAuditSecretsProvenance: {
    status: "ENGINEERING_COMPLETE",
    note: "Incident runbooks, audit retention, secrets rotation, rollback, version provenance documented",
    evidence: [
      "docs/operations/WP05_INCIDENT_RUNBOOKS.md",
      "docs/operations/WP05_AUDIT_SECRETS_PROVENANCE.md",
      "packages/research/corpus/reports/wp05-staging-identity-rollback.json",
    ],
    historicalRollback: rollback?.result ?? rollback?.status ?? null,
  },
};

const carryForward = [
  "WP-03E legal research gates (SELECT-only corpus credential / live research)",
  "WP-04 OCR managed provider + load",
  "WP-04 Clerk MFA live verification",
  "WP-04 ClamAV production verification",
  "Attorney Terms/Privacy approval (SEC-LEGAL-01)",
  "Critical security findings still open from prior audits",
  "Production deploy authorization (no production Fly app)",
];

const report = {
  classification: "NYAYAGRID_WP05_PROD_OPS_PREFLIGHT",
  at: new Date().toISOString(),
  productionDeployed: false,
  neonCorpusWrites: 0,
  courtListenerCalls: 0,
  paidAiCalls: 0,
  stagingDbTopologyChanged: false,
  requiredArtifacts: {
    ok: missingRequired.length === 0,
    missing: missingRequired.map((m) => m.path),
    checked: artifactChecks.length,
  },
  historicalEvidence: {
    ok: missingEvidence.length === 0,
    missing: missingEvidence.map((m) => m.path),
    note: "Preserved; staging PITR not re-executed by this preflight",
  },
  gates,
  categories: {
    ENGINEERING_COMPLETE: Object.entries(gates)
      .filter(([, g]) => g.status === "ENGINEERING_COMPLETE")
      .map(([k]) => k),
    STAGING_VERIFIED: Object.entries(gates)
      .filter(([, g]) => String(g.status).startsWith("STAGING_VERIFIED") || g.status === "DOCUMENTED_STAGING_PITR_HISTORICAL")
      .map(([k]) => k),
    CARRY_FORWARD: Object.entries(gates)
      .filter(([, g]) => g.status === "CARRY_FORWARD")
      .map(([k]) => k),
    PRODUCTION_VERIFIED: [],
  },
  carryForwardUnresolved: carryForward,
  result:
    missingRequired.length === 0
      ? "WP05_FIXABLE_NOW_ENGINEERING_COMPLETE_PRODUCTION_NOT_VERIFIED"
      : "WP05_FIXABLE_NOW_ENGINEERING_INCOMPLETE",
};

const outPath = join(root, "packages/research/corpus/reports/wp05-prod-ops-preflight.json");
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (missingRequired.length > 0) process.exit(1);
process.exit(0);
