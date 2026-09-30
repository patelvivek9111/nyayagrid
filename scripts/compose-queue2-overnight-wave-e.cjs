#!/usr/bin/env node
/**
 * Overnight Wave E — foundations, designs, stale-artifact audit, observability/retry notes.
 * Analysis only. ZERO CL. ZERO unsafe mutations.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const now = new Date().toISOString();

function read(name) {
  const p = path.join(reports, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : null;
}

const tracker = read("queue2-balanced-10k-tracker.json");
const citePri = read("queue2-citation-target-priority-last.json");
const integrity = read("queue2-integrity-full-pass.json");

const zeroClDesigns = {
  classification: "QUEUE2_ZERO_CL_SOURCE_DESIGNS",
  generatedAt: now,
  courtListenerHttpCalls: 0,
  mutations: 0,
  note: "Design only. Do not implement unverified scraping. Do not claim sources work unless already proven.",
  USC: {
    authoritativeSourceRequirement: "House OLRC / GPO USC XML or HTML with full section text (not stub shells)",
    expectedDocumentFormat: "XML or structured HTML with title/section hierarchy",
    identityStrategy: "title + section (+ subsection) → normalized `N U.S.C. § X`",
    parserRequirements: "Reject shells < ~1KB meaningful text; verify section heading match",
    citationVerification: "Round-trip parseCitation → normalized form must equal identity",
    provenanceFields: ["source_provider", "source_external_id", "canonical_source_url", "retrieved_at"],
    currentnessFields: ["effective_date", "currentness_status", "last_checked_at"],
    dedupeStrategy: "unique (source_provider, source_external_id); citation uniqueness advisory",
    failureQuarantine: "quality_gate_failed rows must not enter ready corpus",
    testFixturesNeeded: ["full_section_sample", "shell_rejection_sample", "amendment_version"],
    productionSafetyGates: ["min_content_length", "section_id_match", "no_CL", "human review of first batch"],
    currentBlocker: "House OLRC ~208-char shell; quality gate failed",
  },
  FederalRules: {
    authoritativeSourceRequirement: "Official uscourts.gov or GPO federal rules text with rule numbers",
    expectedDocumentFormat: "HTML/XML rule index + per-rule body",
    identityStrategy: "`Fed. R. Civ. P. N` / Evid / App / Crim",
    parserRequirements: "Rule number extraction; strip navigation chrome",
    citationVerification: "parseCitation type=rule high confidence",
    provenanceFields: ["source_provider", "source_external_id", "canonical_source_url"],
    currentnessFields: ["effective_date", "currentness_status"],
    dedupeStrategy: "source_external_id = rule family + number",
    failureQuarantine: "404 index / empty body quarantined",
    testFixturesNeeded: ["civ_p_56", "evid_401", "app_p_34"],
    productionSafetyGates: ["index_reachable", "body_min_length", "no_unverified_scrape"],
    currentBlocker: "No ingest loop; prior index 404",
  },
  UsReports: {
    authoritativeSourceRequirement: "LOC U.S. Reports with machine-readable opinion text (not PDF-only) OR proven HTML alternate",
    expectedDocumentFormat: "Preferred: structured text/HTML; PDF only with validated text extraction later",
    identityStrategy: "volume U.S. page → `N U.S. P`",
    parserRequirements: "Volume/page identity; majority opinion separation",
    citationVerification: "Match reporter-volume-page; no fuzzy",
    provenanceFields: ["source_provider=loc", "source_external_id", "canonical_source_url"],
    currentnessFields: ["decision_date", "currentness_status=historical for older volumes"],
    dedupeStrategy: "source_external_id + citation unique",
    failureQuarantine: "PDF-only without extraction → quarantine",
    testFixturesNeeded: ["landmark_volume_page", "pdf_only_reject"],
    productionSafetyGates: ["mutation gated", "PDF-only blocked until extractor proven"],
    currentBlocker: "LOC PDF-only; NonClIntake mutation gated",
  },
};
fs.writeFileSync(path.join(reports, "queue2-zero-cl-source-designs.json"), JSON.stringify(zeroClDesigns, null, 2));

const q4 = {
  classification: "QUEUE4_FOUNDATION_ONLY",
  queue4Status: "NOT_OPEN",
  generatedAt: now,
  cases: {
    decision_date_coverage: "see tracker year buckets; overnight integrity futureDates=0",
    source_retrieved_at: "partial via version/source metadata — not fully audited population-wide",
    currentness_status_distribution: "EXPECTED mostly unknown/current_as_of_source_date for CL imports",
  },
  statutes: {
    version_effective_metadata: "PARTIAL — USC blocked quality",
    missing: "REQUIRES_SOURCE",
  },
  regulations: {
    current_as_of_metadata: "PARTIAL — CFR eCFR pilot present",
    missing: "REPAIRABLE_LOCAL for pilot rows; REQUIRES_SOURCE for scale",
  },
  rules: {
    metadata_completeness: "DEFECT/BLOCKED — no ingest pipeline",
  },
};
fs.writeFileSync(path.join(reports, "queue2-currentness-foundation.json"), JSON.stringify(q4, null, 2));

const q6 = {
  classification: "QUEUE6_FOUNDATION_ONLY",
  queue6Status: "NOT_OPEN",
  generatedAt: now,
  risks: read("queue2-retrieval-diversity.json")?.imbalances || [],
  chunkShape: read("queue2-retrieval-diversity.json")?.chunkShape || null,
  notes: [
    "Jurisdiction imbalance: state-heavy vs federal planning split",
    "Sparse districts and intermediate courts",
    "Recent-year bias in several federal circuits",
    "No paid LLM retrieval tests overnight",
  ],
};
fs.writeFileSync(path.join(reports, "queue2-retrieval-foundation.json"), JSON.stringify(q6, null, 2));

const q11 = {
  classification: "QUEUE11_FOUNDATION_ONLY",
  queue11Status: "NOT_OPEN",
  generatedAt: now,
  method: "Static local review notes only — no penetration testing",
  findings: [
    {
      area: "tenant_matter_scoping",
      status: "OBSERVED",
      note: "legal_authorities corpus is intentionally global/public; matter data isolated via permissions packages",
    },
    {
      area: "admin_routes",
      status: "PARTIAL",
      note: "Existing RBAC/permissions tests present; no overnight expansion",
    },
    {
      area: "upload_validation",
      status: "OBSERVED",
      note: "sanitizeUntrustedLegalText strips scripts/injection phrases in adapters tests",
    },
    {
      area: "secret_leakage_in_logs",
      status: "PARTIAL",
      note: "Queue2 scripts generally avoid logging document bodies; continue audit in Queue #11",
    },
    {
      area: "signed_url_handling",
      status: "NOT_DEEP_REVIEWED_OVERNIGHT",
      note: "Deferred — REQUIRES_HUMAN_REVIEW for production storage paths",
    },
  ],
};
fs.writeFileSync(path.join(reports, "queue2-security-foundation.json"), JSON.stringify(q11, null, 2));

const q12 = {
  classification: "QUEUE12_FOUNDATION_ONLY",
  queue12Status: "NOT_OPEN",
  generatedAt: now,
  findings: [
    { pattern: "citation_resolver_population_scans", severity: "medium", note: "Full-table unresolved scans overnight — report index needs only" },
    { pattern: "unbounded_list_queries", severity: "medium", note: "Some tmp probes select all unresolved edges; production paths should paginate" },
    { pattern: "N+1", severity: "low", note: "Batch joins used in cite-integrity unique-match path" },
    { pattern: "missing_indexes", severity: "report_only", suggested: ["legal_authority_citations(to_authority_id) already indexed", "consider normalized_citation + to_authority_id composite for reresolve"] },
  ],
  note: "No speculative schema migrations unattended.",
};
fs.writeFileSync(path.join(reports, "queue2-performance-foundation.json"), JSON.stringify(q12, null, 2));

const observability = {
  classification: "QUEUE2_OBSERVABILITY_AUDIT",
  generatedAt: now,
  signals: {
    ingest_failure: "OBSERVED",
    resolver_failure: "PARTIAL",
    embedding_failure: "PARTIAL",
    orphan_creation: "OBSERVED",
    duplicate_creation: "OBSERVED",
    source_timeout: "OBSERVED",
    rate_limit: "OBSERVED",
    stale_owner: "OBSERVED",
    queue_failure: "OBSERVED",
    unauthorized_access: "PARTIAL",
    storage_failure: "PARTIAL",
  },
  missingCriticalSignals: ["resolver_present_unresolved_gauge_in_worker", "citation_edge_duplicate_alert"],
};
fs.writeFileSync(path.join(reports, "queue2-observability-audit.json"), JSON.stringify(observability, null, 2));

const retryAudit = {
  classification: "QUEUE2_RETRY_POLICY_AUDIT",
  generatedAt: now,
  findings: [
    { area: "cl_batch", issue: "429 must stop lane (observed S5)", status: "OK_POLICY" },
    { area: "worker_lock", issue: "stale owner reclaim bounded", status: "OK_TESTED" },
    { area: "fly_408", issue: "session recorded fly408; resume cursor required", status: "PARTIAL" },
    { area: "embeddings", issue: "retry without duplicating chunk rows", status: "OK_UNIT" },
    { area: "infinite_retry_risk", issue: "worker safety budgets / kill switch present", status: "OK_CONFIG" },
  ],
  fixesTonight: [],
};
fs.writeFileSync(path.join(reports, "queue2-retry-policy-audit.json"), JSON.stringify(retryAudit, null, 2));

// Stale artifact audit
const authoritative = [
  "queue2-balanced-10k-tracker.json",
  "queue2-federal-depth-map.json",
  "queue2-district-manifest.json",
  "queue2-state-intermediate-manifest.json",
  "queue2-year-distribution.json",
  "queue2-retrieval-diversity.json",
  "queue2-integrity-full-pass.json",
  "queue2-citation-family-inventory.json",
  "queue2-dual-value-case-queue.json",
  "queue2-citation-denominator-sample-1000.json",
  "queue2-morning-execution-pack.json",
  "queue2-week1-scorecard.json",
  "queue2-week1-remaining-checklist.json",
  "queue2-10k-path-simulation.json",
  "citation-coverage-roadmap.json",
  "court-map-audit.json",
  "queue2-artifact-authority-manifest.json",
];
const superseded = [
  "queue2-offline-prep-raw.json",
  "queue2-s2-tracker.json",
  "queue2-s3-tracker.json",
  "queue2-s4-tracker-start.json",
  "queue2-s4-tracker-end.json",
  "queue2-balanced-10k-finish.json",
  "queue2-citation-target-priority-scorecard.json",
];
const stale = [
  "queue2-watchdog-status.json",
  "queue2-watchdog-known-good.json",
  "queue2-zero-cl-cite-pass-2026-09-28-evening.json",
];
const manifest = {
  classification: "QUEUE2_ARTIFACT_AUTHORITY_MANIFEST",
  generatedAt: now,
  note: "Do not delete superseded/stale files automatically. Prefer CURRENT names tomorrow.",
  CURRENT: authoritative.map((f) => ({ file: f, status: "CURRENT" })),
  SUPERSEDED: superseded.map((f) => ({ file: f, status: "SUPERSEDED" })),
  STALE: stale.map((f) => ({ file: f, status: "STALE" })),
  UNKNOWN: [
    { file: "queue2-production-gap-map.json", status: "UNKNOWN", note: "Same-day afternoon; use overnight family inventory + zero-CL status instead" },
  ],
  integrityNote: integrity?.duplicateCitationEdges
    ? `Integrity reported duplicateCitationEdges=${integrity.duplicateCitationEdges} — report only, no silent delete`
    : "clean",
};
fs.writeFileSync(path.join(reports, "queue2-artifact-authority-manifest.json"), JSON.stringify(manifest, null, 2));

// Ops doc hygiene append
const opsPath = path.join(root, "packages/research/corpus/QUEUE2_WORKER_OPERATIONS.md");
let ops = fs.existsSync(opsPath) ? fs.readFileSync(opsPath, "utf8") : "";
const marker = "## Overnight zero-quota morning workflow";
if (!ops.includes(marker)) {
  ops += `

${marker}

Updated: ${now}

### Safety
- Queue #2 OPEN; Queue #9 CLOSED; Queue #3 NOT_OPEN
- Do not start \`queue2:worker\` without recovered CL quota and human-aware session
- Overnight prep sets CourtListener HTTP = 0 and paid AI = 0

### Authoritative artifacts (after overnight prep)
See \`reports/queue2-artifact-authority-manifest.json\`. Prefer:
- \`queue2-balanced-10k-tracker.json\`
- \`queue2-morning-execution-pack.json\`
- \`queue2-dual-value-case-queue.json\`
- \`queue2-week1-scorecard.json\`

### Morning command
\`\`\`bash
npm run queue2:morning
\`\`\`
Prints live baseline from last overnight artifacts, ranked batches, Week 1 gap, integrity, and stop conditions. Does **not** call CourtListener or mutate corpus.

### Balanced 10k strategy
Planning split ~7650 state/DC + ~2350 federal; per-state planning target ~150. Scoring weights: \`config/queue2-balanced-priority-weights.json\`.

### Citation denominator methodology
Stratified local sample of unresolved edges (≥1000). Classes include VALID_TARGET_ABSENT and UNKNOWN_REQUIRES_EXTERNAL_VERIFICATION. Do not treat sample proportions as population ground truth.

### Zero-CL blockers (current)
- CFR: eCFR piloted (capability proven)
- USC: House OLRC quality gate failed (shell content)
- Federal Rules: ingest loop blocked / index issues
- LOC U.S. Reports: PDF-only; mutation gated

### Manual-mode / 408
Prefer manual oneshot batches with resume cursor after Fly 408; do not leave orphan acquisition children.

`;
  fs.writeFileSync(opsPath, ops);
}

console.log(JSON.stringify({ ok: true, classification: "OVERNIGHT_WAVE_E", generatedAt: now }, null, 2));
