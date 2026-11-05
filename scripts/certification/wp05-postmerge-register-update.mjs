/**
 * WP-05 post-merge register update (evidence-backed; no production claims).
 * Run: node scripts/certification/wp05-postmerge-register-update.mjs
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const registerPath = path.join(root, "docs/audits/NYAYAGRID_MASTER_COMPLETION_REGISTER.json");
const closurePath = path.join(root, "docs/audits/WP05_FINAL_CLOSURE.md");

const MAIN_HEAD = "a499780a3780d4a6a9c176bcd65a7c1ab02c5c2d";
const PR3_MERGE = "af376941dd90ddd1eb9969d10815eb9e9811dd9d";
const PR3_APPROVED = "81acba9698e4ea312c345be532461b294c3a6359";
const PR1_SOURCE = "7a8ea91be8392f8c7d770e3699a403151e01f0ed";
const PR2_HEAD = "d8868dfbf5a214f013e923b6d4804cd24ed7e96e";
const STAGING_GIT_SHA = "add3af38a4c00c6cec631b70981a1c855b660f38";
const MONITOR_DISPATCH_RUN = "42046460657";
const GENERATED_AT = new Date().toISOString();

const raw = fs.readFileSync(registerPath, "utf8");
const j = JSON.parse(raw);

function req(id) {
  const r = j.requirements.find((x) => x.id === id);
  if (!r) throw new Error(`missing requirement ${id}`);
  return r;
}

function ensurePriority(id, priority) {
  const r = req(id);
  if (!r.priority) r.priority = priority;
}

// Repair dropped priority fields (duplicate-key parse survivors / prior edits).
for (const [id, p] of [
  ["PROF-CLIENT-01", "P2"],
  ["PROF-MATTER-01", "P2"],
  ["PROF-DOC-01", "P1"],
  ["PROF-DOC-02", "P0"],
  ["PROF-TL-01", "P2"],
  ["PROF-MEM-01", "P2"],
  ["PROF-GRAPH-01", "P2"],
  ["PROF-RES-01", "P0"],
  ["PROF-DRAFT-01", "P1"],
  ["PROF-BILL-01", "P2"],
  ["PROF-ROLE-01", "P1"],
  ["PROF-CONTACT-01", "P3"],
  ["PROF-FOLDER-01", "P3"],
  ["PROS-RBAC-01", "P0"],
  ["PROS-CASE-01", "P0"],
  ["PROS-EV-01", "P2"],
  ["PROS-DIS-01", "P0"],
  ["PROS-SAFE-01", "P0"],
  ["PROS-ISO-01", "P0"],
  ["PROS-WF-01", "P1"],
  ["PROS-MEM-01", "P2"],
  ["PROS-GRAPH-01", "P2"],
  ["PROS-AUD-01", "P2"],
  ["PROS-BENCH-01", "P0"],
  ["PROS-EXT-01", "P0"],
  ["AI-ROUTE-01", "P0"],
  ["AI-GROUND-01", "P0"],
  ["AI-EXT-SCORER-01", "P0"],
  ["CORPUS-01", "P0"],
  ["CORPUS-02", "P1"],
  ["SEC-AUTH-01", "P0"],
  ["SEC-ISO-01", "P0"],
  ["SEC-MAL-01", "P0"],
  ["SEC-LEGAL-01", "P0"],
  ["OPS-BACKUP-01", "P0"],
  ["OPS-MON-01", "P1"],
  ["OPS-DEP-01", "P0"],
  ["RM-PG-01", "P1"],
  ["CJIS-01", "P0"],
  ["TEST-E2E-01", "P1"],
  ["TEST-UNIT-01", "P1"],
  ["CORPUS-03", "P0"],
  ["CORPUS-04", "P0"],
  ["CORPUS-05", "P1"],
  ["CORPUS-06", "P0"],
  ["CORPUS-07", "P0"],
  ["CORPUS-08", "P0"],
  ["CORPUS-09", "P0"],
  ["CORPUS-10", "P1"],
  ["CORPUS-11", "P0"],
  ["CORPUS-12", "P1"],
  ["CORPUS-13", "P0"],
  ["CORPUS-14", "P0"],
  ["CORPUS-15", "P0"],
]) {
  ensurePriority(id, p);
}

// --- Header / merge facts ---
j.generatedAt = GENERATED_AT;
j.head = MAIN_HEAD;
j.branch = "wp05/prod-ops-preflight";
j.mainMerge = {
  pr: 1,
  mergeCommit: MAIN_HEAD,
  sourceHead: PR1_SOURCE,
  includesPr3: {
    pr: 3,
    mergeCommit: PR3_MERGE,
    approvedHead: PR3_APPROVED,
    remoteCi: { run: "42015520866", conclusion: "SUCCESS" },
  },
  scope:
    "PR #1 merged continuous staging monitor onto main (source 7a8ea91). PR #3 CI baseline already on main ancestry. PRODUCTION_DEPLOYED=NO.",
};
j.remoteCi = {
  note: "Post-merge monitor workflow_dispatch observed; default-branch CI for PR #3 historical SUCCESS",
  pr3: { run: "42015520866", conclusion: "SUCCESS", head: PR3_APPROVED },
  monitorDispatch: {
    run: MONITOR_DISPATCH_RUN,
    conclusion: "SUCCESS",
    event: "workflow_dispatch",
    head: MAIN_HEAD,
    url: `https://github.com/patelvivek9111/nyayagrid/actions/runs/${MONITOR_DISPATCH_RUN}`,
  },
};

const stagingProbeEvidence = [
  `CURRENT_VERIFIED 2026-11-05 staging GET /api/health/ready → ok=true status=HEALTHY gitSha=${STAGING_GIT_SHA} appEnv=staging database/storage/redis/clamav=ok clamavMode=live ocr=disabled neonCorpusResearch=off`,
  `CURRENT_VERIFIED staging GET /api/v1/health → status=ok appEnv=staging malwareScanner=clamav ocrProvider=none`,
  "PRODUCTION_DEPLOYED=NO — staging evidence is not production certification",
];

// OPS-MON-01 post-merge
{
  const r = req("OPS-MON-01");
  r.status = "PARTIAL";
  r.priority = "P1";
  r.releaseBlocker = true;
  r.lastVerifiedSha = MAIN_HEAD;
  r.MONITOR_PR_MERGED = true;
  r.MONITOR_PR_SAFE_TO_MERGE = "MERGED";
  r.MONITOR_WORKFLOW_ON_MAIN = true;
  r.MONITOR_WORKFLOW_BRANCH = "main";
  r.MONITOR_WORKFLOW_HEAD = MAIN_HEAD;
  r.DEFAULT_BRANCH_SCHEDULER_ACTIVE = true;
  r.REAL_SCHEDULED_EXECUTIONS_OBSERVED = false;
  r.MONITORING_ACCEPTANCE_CLAIMABLE = false;
  r.PR2_GITHUB_STATE = "MERGED_ALREADY_REACHABLE";
  r.PR2_MUST_NOT_MERGE = false;
  r.PR2_DO_NOT_REVERT = true;
  r.MONITOR_DISPATCH_RUN = MONITOR_DISPATCH_RUN;
  r.MONITOR_DISPATCH_CONCLUSION = "SUCCESS";
  r.BLOCKERS = [
    "Production on-call escalation NOT VERIFIED",
    "Automated acknowledgment integration not tested",
    "Request-metric policies (5xx/AI/worker heartbeat/TLS) lack telemetry — not fabricated",
    "REAL_SCHEDULED_EXECUTIONS_OBSERVED=false — only workflow_dispatch SUCCESS observed post-merge; need >=2 genuine schedule events + SMTP firing/dedupe/recovery before claiming monitoring acceptance",
  ];
  r.HUMAN_APPROVAL =
    "Staging ready-probe Gmail ack HISTORICAL only; production on-call gated; observe genuine cron runs before claiming continuous scheduler acceptance";
  r.NEXT_ACTION =
    "Keep monitor workflow on main; observe >=2 genuine scheduled (event=schedule) monitor runs + SMTP firing/dedupe/recovery; do not claim monitoring acceptance from workflow_dispatch alone; do not revert PR #2 GitHub state";
  r.evidence = [
    `PR #1 MERGED to main @ ${MAIN_HEAD} (source HEAD ${PR1_SOURCE}) at 2026-11-05T14:30:10Z — staging-continuous-monitor.yml NOW on default branch`,
    `Post-merge workflow_dispatch run ${MONITOR_DISPATCH_RUN} SUCCESS on main @ ${MAIN_HEAD} (Probe staging ready all steps SUCCESS) — NOT a schedule event`,
    "REAL_SCHEDULED_EXECUTIONS_OBSERVED=false (API: only workflow_dispatch=1 for staging-continuous-monitor.yml as of audit)",
    `PR #2 GitHub state MERGED=true at 2026-11-05T14:30:12Z merge_commit_sha=${PR2_HEAD} (=head; already-reachable close). All PR #2 commits are ancestors of ${MAIN_HEAD}. Tip tree deltas vs main: hardcoded OPS_ALERT_TO gmail fallback (correctly ABSENT on main) + exact-citation search path intentionally dropped in cfca05b baseline slim. DO NOT REVERT. No separate merge commit added unique product content beyond ancestry.`,
    "WP-05 DEFAULT_ALERT_POLICIES + continuous-monitor evaluator (firing/resolved/dedupe/cooldown)",
    "packages/observability WP-05 monitoring unit tests 18/18 PASS (continuous-monitor, ops-health, alert-delivery, release-identity, alert-transport)",
    "Staging SMTP synthetic ready-probe-failing HISTORICAL: firing 2026-11-04T16:37:32.025Z + resolved 2026-11-04T16:37:32.597Z; Gmail human ack verified",
    "packages/research/corpus/reports/wp05-monitoring-human-ack-verified.json",
    "docs/operations/WP05_ALERTING.md + WP05_INCIDENT_RUNBOOKS.md escalation matrix",
    ...stagingProbeEvidence,
  ];
  r.acceptance = {
    ...(r.acceptance || {}),
    ENGINEERING_IMPLEMENTED: true,
    MONITORING_IMPLEMENTED: true,
    CONTINUOUS_SCHEDULER_IMPLEMENTED: true,
    MONITOR_WORKFLOW_ON_MAIN: true,
    WORKFLOW_DISPATCH_POST_MERGE_OBSERVED: true,
    REAL_SCHEDULED_EXECUTIONS_OBSERVED: false,
    MONITORING_ACCEPTANCE_CLAIMABLE: false,
    PRODUCTION_ONCALL_ESCALATION_TESTED: false,
    PRODUCTION_VERIFIED: false,
  };
}

// OPS-DEP-01
{
  const r = req("OPS-DEP-01");
  r.status = "PARTIAL";
  r.priority = "P0";
  r.PRODUCTION_VERIFIED = false;
  r.lastVerifiedSha = MAIN_HEAD;
  r.evidence = [
    ...stagingProbeEvidence,
    `Staging deploy identity HISTORICAL + CURRENT ready gitSha=${STAGING_GIT_SHA}; db/redis/storage/clamav HEALTHY; ocr disabled; neon corpus research flag off`,
    "Staging identity rollback HISTORICAL PASS: v87→v88 previous image gitSha=null → v89 restore baked image gitSha restored (wp05-staging-identity-rollback.json)",
    "PRODUCTION Fly app NOT created; PRODUCTION_DEPLOYED=NO",
    "GitHub release protection workflows: deploy-staging.yml + deploy-production-gate.yml (approval-only; never deploys)",
    `PR #3 merged ${PR3_MERGE}; PR #1 merged ${MAIN_HEAD} (monitor on main); prod-ops preflight register on wp05/prod-ops-preflight`,
    "Session gates: PRODUCTION_DEPLOYED=NO; NEON_CORPUS_WRITES=0; PAID_AI_CALLS=0; COURTLISTENER_CALLS=0; WP06_STARTED=NO",
  ];
  r.BLOCKERS = [
    "PRODUCTION_DEPLOYED=NO — no production Fly app",
    "Carry-forward: WP-03E corpus credential/live cert; WP-04 OCR/ClamAV/Clerk MFA staging+prod; attorney Terms/Privacy; critical security findings; production deploy authorization",
    "Clerk-authenticated Professional/Prosecution E2E blocked on staging test identities (security negatives PASS)",
    "GitHub Environment required reviewers must be configured in GitHub UI (human)",
  ];
  r.acceptance = {
    ...(r.acceptance || {}),
    ENGINEERING_IMPLEMENTED: true,
    STAGING_HOST_REACHABLE: true,
    STAGING_DEPLOYED: true,
    STAGING_READY_CURRENT_VERIFIED: true,
    PRODUCTION_DEPLOYED: false,
    PRODUCTION_RELEASE_APPROVED: false,
  };
}

// OPS-BACKUP-01 — preserve historical staging PITR; still not production
{
  const r = req("OPS-BACKUP-01");
  r.status = "PARTIAL";
  r.priority = "P0";
  r.PRODUCTION_VERIFIED = false;
  r.evidence = [
    ...(Array.isArray(r.evidence) ? r.evidence.filter((e) => !String(e).includes("CURRENT_VERIFIED 2026-11-05 staging")) : []),
    ...stagingProbeEvidence,
  ];
}

// SEC-MAL-01 — note staging ready reports clamav live connectivity; upload rehearsal still open
{
  const r = req("SEC-MAL-01");
  r.priority = "P0";
  r.status = "PARTIAL";
  r.evidence = [
    ...(Array.isArray(r.evidence) ? r.evidence : []),
    `CURRENT_VERIFIED staging ready clamav=ok clamavMode=live @ gitSha=${STAGING_GIT_SHA} — scanner connectivity only; upload EICAR quarantine rehearsal still STAGING_LIVE_VERIFIED=false`,
  ];
  if (r.acceptance) {
    r.acceptance.STAGING_SCANNER_CONNECTIVITY_OBSERVED = true;
    r.acceptance.STAGING_LIVE_VERIFIED = false;
    r.acceptance.PRODUCTION_VERIFIED = false;
  }
}

// SEC-AUTH / SEC-LEGAL / PROF-DOC-02 — confirm staging OCR still disabled
{
  const r = req("PROF-DOC-02");
  r.priority = "P0";
  r.evidence = [
    ...(Array.isArray(r.evidence) ? r.evidence.filter((e) => !String(e).includes("ocr=disabled")) : []),
    `CURRENT_VERIFIED staging ready ocr=disabled / ocrProvider=none @ ${STAGING_GIT_SHA} — STAGING_LIVE_VERIFIED remains false`,
  ];
}

// Product inventory recount
function byStatus(product) {
  const items = j.requirements.filter((r) => r.product === product);
  const out = {
    VERIFIED_COMPLETE: 0,
    IMPLEMENTED_UNVERIFIED: 0,
    PARTIAL: 0,
    MISSING: 0,
    BLOCKED: 0,
    OUT_OF_SCOPE: 0,
    BROKEN: 0,
  };
  for (const r of items) {
    if (out[r.status] === undefined) out[r.status] = 0;
    out[r.status] += 1;
  }
  return { total: items.length, byStatus: out, items };
}

const professional = byStatus("Professional");
const prosecution = byStatus("Prosecution");

const openP0 = j.requirements
  .filter((r) => r.priority === "P0" && !["VERIFIED_COMPLETE", "OUT_OF_SCOPE"].includes(r.status))
  .map((r) => `${r.id}:${r.status}`);
const openP1 = j.requirements
  .filter((r) => r.priority === "P1" && !["VERIFIED_COMPLETE", "OUT_OF_SCOPE"].includes(r.status))
  .map((r) => `${r.id}:${r.status}`);

j.productCompletionInventory = {
  methodology:
    "Requirement rows where product is Professional or Prosecution (includes corpus integration rows); honest status from requirements[] — no production claims from staging-only or CI-only evidence",
  productionVerifiedAny: false,
  stagingAuthenticatedE2EVerified: false,
  verificationLanes: {
    localOrCi: "Unit/integration/Playwright CI or local harness",
    authenticatedStaging:
      "Clerk-authenticated staging E2E — currently BLOCKED on synthetic identities / interactive MFA",
    production: "PRODUCTION_DEPLOYED=NO — none production-verified",
  },
  Professional: {
    requirementsInventoried: professional.total,
    byStatus: professional.byStatus,
    releaseBlockersOpen: ["PROF-DOC-02", "PROF-RES-01", "CORPUS-13"],
    note: "Matters/doc ingest/timeline/memory/graph CI-verified (5 VERIFIED_COMPLETE); OCR/research/corpus Neon integration partial or blocked; Clerk-authenticated staging E2E not closed; folders/contacts MISSING",
  },
  Prosecution: {
    requirementsInventoried: prosecution.total,
    byStatus: prosecution.byStatus,
    releaseBlockersOpen: ["PROS-EXT-01", "CORPUS-07", "CORPUS-14"],
    cjisNote: "CJIS-01 remains OUT_OF_SCOPE release blocker only if marketed as certified",
    note: "Core case/RBAC/disclosure/safety/isolation/warrant tracking verified; Memory UI missing; graph/audit/CoC partial; live corpus blocked; CJIS out of scope unless marketed",
  },
  p0RemainingOpen: openP0,
  p1RemainingOpen: openP1,
  p0RemainingCount: openP0.length,
  p1RemainingCount: openP1.length,
};

// Feature inventory areas — refresh research/monitoring notes only
if (j.featureInventoryAudit?.areas?.research) {
  j.featureInventoryAudit.areas.research.status = "BLOCKED";
  j.featureInventoryAudit.areas.research.note =
    "WP-03E corpus SELECT-only credential provisioning required; staging neonCorpusResearch=off";
}
j.featureInventoryAudit = {
  ...(j.featureInventoryAudit || {}),
  methodology:
    "Map tracked Professional/Prosecution/Shared requirements to product feature areas; statuses are requirement-row honesty (CI/local vs authenticated staging vs production). Staging SMTP/PITR/rollback remain HISTORICAL_VERIFIED. Monitor workflow NOW on main; scheduled acceptance pending. No production certification from staging alone.",
  postMergeOps: {
    monitorWorkflowOnMain: true,
    realScheduledExecutionsObserved: false,
    stagingReadyCurrentVerified: true,
    stagingGitSha: STAGING_GIT_SHA,
    productionDeployed: false,
  },
};

// Totals
const allBy = {};
for (const r of j.requirements) {
  allBy[r.status] = (allBy[r.status] || 0) + 1;
}
j.totals = {
  requirementsInventoried: j.requirements.length,
  note: `WP-05 POST-MERGE audit ${GENERATED_AT}: main @ ${MAIN_HEAD} (PR #1 merge; source ${PR1_SOURCE}). PR #3 @ ${PR3_MERGE}. Monitor workflow ON main; workflow_dispatch ${MONITOR_DISPATCH_RUN} SUCCESS; REAL_SCHEDULED_EXECUTIONS_OBSERVED=false. PR #2 GitHub MERGED via already-reachable close @ ${PR2_HEAD} — do not revert. Staging ready CURRENT_VERIFIED gitSha=${STAGING_GIT_SHA}. PRODUCTION_DEPLOYED=NO; NEON_CORPUS_WRITES=0; PAID_AI_CALLS=0; COURTLISTENER_CALLS=0; WP06_STARTED=NO. Staging ≠ production certification.`,
  verifiedComplete: allBy.VERIFIED_COMPLETE || 0,
  implementedUnverified: allBy.IMPLEMENTED_UNVERIFIED || 0,
  partial: allBy.PARTIAL || 0,
  missing: allBy.MISSING || 0,
  broken: allBy.BROKEN || 0,
  blocked: allBy.BLOCKED || 0,
  outOfScope: allBy.OUT_OF_SCOPE || 0,
  p0: j.requirements.filter((r) => r.priority === "P0").length,
  p1: j.requirements.filter((r) => r.priority === "P1").length,
  p2: j.requirements.filter((r) => r.priority === "P2").length,
  p3: j.requirements.filter((r) => r.priority === "P3").length,
  p0RemainingOpen: openP0.length,
  p1RemainingOpen: openP1.length,
};

j.topReleaseBlockers = [
  "PROF-RES-01 / CORPUS-13: Neon text-backed corpus not product-default; WP-03E SELECT-only credential absent; staging neonCorpusResearch=off",
  "PROF-DOC-02 OCR: staging ocr=disabled; production NOT VERIFIED",
  "SEC-AUTH-01 Clerk MFA staging/production live verification open",
  "SEC-MAL-01 ClamAV: staging scanner connectivity observed; upload quarantine rehearsal + production NOT VERIFIED",
  "SEC-LEGAL-01 Attorney Terms/Privacy sign-off open",
  "OPS-BACKUP-01 staging PITR HISTORICAL; production restore NOT VERIFIED",
  "OPS-MON-01 monitor workflow ON main; REAL_SCHEDULED_EXECUTIONS_OBSERVED=false; monitoring acceptance NOT claimable; production on-call NOT VERIFIED",
  "OPS-DEP-01 PRODUCTION_DEPLOYED=NO",
  "PROS-EXT-01 External Cite validation incomplete (71 unexecuted; NEW auth required)",
];

// WP-05 plan + session
const wp05 = j.dependencyOrderedPlan.find((x) => x.id === "WP-05");
if (wp05) {
  wp05.status = "PARTIAL";
  wp05.result = "WP05_POST_MERGE_MONITOR_ON_MAIN_SCHEDULED_ACCEPTANCE_PENDING";
  wp05.verificationClasses = {
    ...(wp05.verificationClasses || {}),
    MONITOR_WORKFLOW_ON_MAIN: true,
    REAL_SCHEDULED_MONITOR_RUNS: false,
    WORKFLOW_DISPATCH_POST_MERGE_SUCCESS: true,
    MONITORING_ACCEPTANCE_CLAIMABLE: false,
    STAGING_READY_PASS: true,
    STAGING_READY_CURRENT_VERIFIED: true,
    PRODUCTION_DEPLOYED: false,
    PR1_MERGED: true,
    PR1_MERGE_COMMIT: MAIN_HEAD,
    PR1_SOURCE_HEAD: PR1_SOURCE,
    PR2_GITHUB_MERGED_ALREADY_REACHABLE: true,
    PR2_DO_NOT_REVERT: true,
    SAME_DOCUMENT_CONTRADICTION_RESTORED: true,
  };
  wp05.note = `WP-05 NOT fully closed. PR #3 MERGED ${PR3_MERGE}. PR #1 MERGED ${MAIN_HEAD} (source ${PR1_SOURCE}) — monitor workflow on main. Post-merge workflow_dispatch ${MONITOR_DISPATCH_RUN} SUCCESS; scheduled acceptance still pending. PR #2 unexpectedly GitHub-MERGED via already-reachable close (${PR2_HEAD}); do not revert. Staging ready CURRENT_VERIFIED @ ${STAGING_GIT_SHA}. PRODUCTION_DEPLOYED=NO; NEON_CORPUS_WRITES=0; PAID_AI_CALLS=0; COURTLISTENER_CALLS=0; WP06_STARTED=NO. Carry forward WP-03E, WP-04 OCR/ClamAV/MFA, attorney Terms/Privacy, critical security, production deploy auth. Do not mark production certification from staging alone.`;
  wp05.pr1Monitor = {
    merged: true,
    mergeCommit: MAIN_HEAD,
    sourceHead: PR1_SOURCE,
    monitorWorkflowOnMain: true,
    realScheduledExecutionsObserved: false,
    monitoringAcceptanceClaimable: false,
    workflowDispatchRun: MONITOR_DISPATCH_RUN,
    workflowDispatchConclusion: "SUCCESS",
  };
  wp05.pr2 = {
    githubMerged: true,
    mergeCommitShaEqualsHead: PR2_HEAD,
    semantics: "ALREADY_REACHABLE_AUTO_CLOSE",
    doNotRevert: true,
    uniqueTipDeltasSuperseded:
      "hardcoded SMTP fallback correctly absent on main; exact-citation search intentionally dropped in cfca05b",
  };
  wp05.gates = {
    PRODUCTION_DEPLOYED: "NO",
    NEON_CORPUS_WRITES: 0,
    PAID_AI_CALLS: 0,
    COURTLISTENER_CALLS: 0,
    WP06_STARTED: "NO",
  };
  wp05.completedVsOpen = {
    completed: [
      "PR #3 CI/E2E baseline merged to main (same-document contradiction restored)",
      "PR #1 continuous staging monitor merged to main",
      "Monitor workflow present on default branch; post-merge workflow_dispatch SUCCESS",
      "Staging /api/health/ready CURRENT_VERIFIED HEALTHY",
      "FIXABLE_NOW prod-ops engineering on wp05/prod-ops-preflight",
      "Historical staging PITR / SMTP ready-probe ack / identity rollback evidence preserved",
    ],
    open: [
      ">=2 genuine scheduled monitor runs + SMTP firing/recovery acceptance",
      "OPS-BACKUP/MON/DEP PRODUCTION_VERIFIED",
      "Clerk-authenticated Professional/Prosecution staging E2E",
      "GitHub Environment required reviewers",
      "Carry-forward WP-03E / WP-04 OCR·ClamAV·MFA / attorney Terms / critical security / production deploy auth",
    ],
  };
}

j.wp05Session = {
  classification: "NYAYAGRID_WP05_POST_MERGE_PRODUCT_COMPLETION_AUDIT",
  result: "WP05_MONITOR_ON_MAIN_EXTERNAL_GATES_PENDING",
  status: "PARTIAL",
  finalClosureDecision: "WP05_NOT_FULLY_CLOSED",
  generatedAt: GENERATED_AT,
  wp06Started: false,
  productionDeployed: false,
  neonCorpusWrites: 0,
  paidAiCalls: 0,
  courtlistenerCalls: 0,
  mainHead: MAIN_HEAD,
  registerBranch: "wp05/prod-ops-preflight",
  stagingVsProduction: {
    stagingReady: "CURRENT_VERIFIED_HEALTHY",
    stagingGitSha: STAGING_GIT_SHA,
    stagingPitr: "HISTORICAL_VERIFIED",
    stagingSmtpAck: "HISTORICAL_VERIFIED",
    stagingIdentityRollback: "HISTORICAL_VERIFIED",
    productionCertified: false,
    productionDeployed: false,
    distinction:
      "Staging health/PITR/SMTP/rollback evidence must not be treated as production certification",
  },
  pr3: {
    merged: true,
    url: "https://github.com/patelvivek9111/nyayagrid/pull/3",
    mergeCommitMain: PR3_MERGE,
    approvedHead: PR3_APPROVED,
    includesSameDocumentContradictionDetection: true,
    remoteCi: { run: "42015520866", conclusion: "SUCCESS" },
  },
  pr1: {
    merged: true,
    url: "https://github.com/patelvivek9111/nyayagrid/pull/1",
    sourceHead: PR1_SOURCE,
    mergeCommitMain: MAIN_HEAD,
    mergedAt: "2026-11-05T14:30:10Z",
    monitorWorkflowOnMain: true,
    realScheduledExecutionsObserved: false,
    monitoringAcceptanceClaimable: false,
    postMergeWorkflowDispatch: {
      run: MONITOR_DISPATCH_RUN,
      conclusion: "SUCCESS",
      event: "workflow_dispatch",
      head: MAIN_HEAD,
      url: `https://github.com/patelvivek9111/nyayagrid/actions/runs/${MONITOR_DISPATCH_RUN}`,
    },
    nextAction:
      "Observe >=2 genuine scheduled (event=schedule) monitor runs + SMTP firing/recovery/dedupe before claiming monitoring acceptance",
  },
  pr2: {
    url: "https://github.com/patelvivek9111/nyayagrid/pull/2",
    githubState: "MERGED",
    mergedAt: "2026-11-05T14:30:12Z",
    mergeCommitSha: PR2_HEAD,
    semantics: "ALREADY_REACHABLE_AUTO_CLOSE_WHEN_COMMITS_BECAME_ANCESTORS_VIA_PR1",
    allCommitsAncestorOfMain: true,
    doNotRevert: true,
    tipTreeDeltasVsMain: [
      "smtp-alert-transport hardcoded OPS_ALERT_TO gmail fallback — correctly ABSENT on main (do not restore)",
      "search.ts exact-citation lookup — intentionally dropped in cfca05b baseline slim; not restored in this audit",
    ],
  },
  opsProductionVerified: {
    "OPS-BACKUP-01": false,
    "OPS-MON-01": false,
    "OPS-DEP-01": false,
  },
  opsStagingCurrent: {
    readyHealthy: true,
    gitSha: STAGING_GIT_SHA,
    clamavModeLive: true,
    ocrDisabled: true,
    neonCorpusResearchOff: true,
  },
  wp03eStatus: "ROLE_PROVISIONING_REQUIRED / SECURITY_PLAN_READY_FOR_HUMAN_APPROVAL",
  wp04Status: "ENGINEERING_COMPLETE_EXTERNAL_GATES_PENDING",
  legalStatus: "ATTORNEY_APPROVED=false — Terms/Privacy drafts exist; attorney sign-off open",
  newlyRepairedFeatures: [],
  clerkE2E: j.wp05Session?.clerkE2E || {
    branch: "wp05/clerk-e2e-auth",
    statusArtifact: "packages/research/corpus/reports/wp05-clerk-e2e-status.json",
    nonInteractive: "7 passed / 0 failed / 15 skipped",
    authenticatedStagingVerified: false,
    blocker: "Synthetic staging Clerk identities + interactive MFA login required",
  },
  carryForward: [
    "WP-03E legal research gates (SELECT-only CORPUS_DATABASE_URL + live Phases 4–7)",
    "WP-04 OCR managed provider + load (staging ocr currently disabled)",
    "WP-04 Clerk MFA live verification",
    "WP-04 ClamAV upload quarantine staging rehearsal + production verification",
    "Attorney Terms/Privacy",
    "Critical security findings",
    "Production deploy auth",
    "Genuine scheduled monitor runs + SMTP firing/recovery acceptance",
    "Clerk-authenticated Professional/Prosecution staging E2E",
    "GitHub Environment required reviewers",
  ],
  externalApprovalsStillNeeded: [
    "Observe >=2 genuine scheduled monitor runs + SMTP firing/dedupe/recovery (do not claim from workflow_dispatch alone)",
    "GitHub Environment required reviewers (UI)",
    "Clerk staging synthetic identities + interactive MFA demo",
    "Neon corpus SELECT-only role provisioning (WP-03E)",
    "Attorney Terms/Privacy sign-off",
    "Production deploy authorization (explicit; staging ≠ production certification)",
    "Managed OCR / ClamAV upload rehearsal / Clerk MFA staging+production live verification",
  ],
  gates: {
    PRODUCTION_DEPLOYED: "NO",
    NEON_CORPUS_WRITES: 0,
    PAID_AI_CALLS: 0,
    COURTLISTENER_CALLS: 0,
    WP06_STARTED: "NO",
  },
};

// Keep prior WP-03E / WP-04 session blocks; refresh WP-04 note only
const wp04 = j.dependencyOrderedPlan.find((x) => x.id === "WP-04");
if (wp04) {
  wp04.note =
    "Engineering complete for OCR/ClamAV/MFA/Terms locally. Staging ready currently reports ocr=disabled and clamavMode=live (connectivity only). Staging/production OCR+ClamAV upload rehearsal+Clerk MFA and attorney sign-off remain external. WP-03E still ROLE_PROVISIONING_REQUIRED.";
}
const wp03 = j.dependencyOrderedPlan.find((x) => x.id === "WP-03");
if (wp03) {
  wp03.status = "ROLE_PROVISIONING_REQUIRED";
  wp03.result = "WP03E_SECURITY_PLAN_READY_FOR_HUMAN_APPROVAL";
}

fs.writeFileSync(registerPath, `${JSON.stringify(j, null, 2)}\n`, "utf8");

const closure = `# WP-05 Final Operational Certification — Closure Note

**Classification:** \`NYAYAGRID_WP05_POST_MERGE_PRODUCT_COMPLETION_AUDIT\`  
**Date:** 2026-11-05 (post-merge register update)  
**Branch:** \`wp05/prod-ops-preflight\` (register)  
**main:** \`${MAIN_HEAD}\` (PR #1 merge; source \`${PR1_SOURCE}\`)  
**Prior PR #3 on ancestry:** \`${PR3_MERGE}\` (approved \`${PR3_APPROVED}\`, CI \`42015520866\`)  
**Staging ready gitSha (CURRENT_VERIFIED):** \`${STAGING_GIT_SHA}\`

## Merge facts (verified)

| PR | State | Evidence |
| -- | ----- | -------- |
| #3 | MERGED | merge \`${PR3_MERGE}\` — CI/E2E baseline + same-document contradiction restored |
| #1 | MERGED | merge \`${MAIN_HEAD}\` ← source \`${PR1_SOURCE}\` at 2026-11-05T14:30:10Z — \`staging-continuous-monitor.yml\` **on main** |
| #2 | GitHub MERGED (already-reachable) | \`merged_at\` 2026-11-05T14:30:12Z; \`merge_commit_sha=${PR2_HEAD}\` (=head). All commits ancestors of main via PR #1. **Do not revert.** Tip deltas vs main: hardcoded SMTP fallback (correctly absent on main) + exact-citation search (intentionally dropped in \`cfca05b\`). |

Gates observed this audit: \`PRODUCTION_DEPLOYED=NO\`; \`NEON_CORPUS_WRITES=0\`; \`PAID_AI_CALLS=0\`; \`COURTLISTENER_CALLS=0\`; \`WP06_STARTED=NO\`.

## Verdict

**MONITOR ON MAIN / SCHEDULED ACCEPTANCE PENDING / STAGING CURRENTLY HEALTHY / PRODUCTION NOT VERIFIED**

- Continuous monitor workflow is on the default branch after PR #1.
- Post-merge \`workflow_dispatch\` run [\`${MONITOR_DISPATCH_RUN}\`](https://github.com/patelvivek9111/nyayagrid/actions/runs/${MONITOR_DISPATCH_RUN}) **SUCCESS** — **not** a \`schedule\` event.
- \`REAL_SCHEDULED_EXECUTIONS_OBSERVED=false\` → monitoring acceptance **not** claimable yet.
- Staging \`GET /api/health/ready\` CURRENT_VERIFIED: \`HEALTHY\` @ \`${STAGING_GIT_SHA}\` (clamav live connectivity; ocr disabled; neonCorpusResearch off).
- **Staging ≠ production certification.**

| Requirement | ENGINEERING | LOCAL | STAGING | PRODUCTION |
| ----------- | ----------- | ----- | ------- | ---------- |
| OPS-BACKUP-01 | YES | YES | YES (PITR historical) | NO |
| OPS-MON-01 | YES | YES | YES (SMTP historical + ready CURRENT; scheduler acceptance pending) | NO |
| OPS-DEP-01 | YES | YES | YES (identity durable; ready CURRENT) | NO |

## Product completion counts (this register)

**Professional** (14): VERIFIED_COMPLETE **5** · IMPLEMENTED_UNVERIFIED **2** · PARTIAL **4** · MISSING **2** · BLOCKED **1** · OUT_OF_SCOPE **0**

**Prosecution** (15): VERIFIED_COMPLETE **7** · IMPLEMENTED_UNVERIFIED **0** · PARTIAL **5** · MISSING **1** · BLOCKED **1** · OUT_OF_SCOPE **1** (CJIS)

Newly repaired features this pass: **none** (audit/register only; no prod deploy / corpus writes / MFA changes).

## Carry forward (unresolved)

1. Observe ≥2 genuine **scheduled** monitor runs + SMTP firing/recovery/dedupe
2. WP-03E Neon SELECT-only credential + live research cert
3. WP-04 OCR managed provider + load (staging currently \`ocr=disabled\`)
4. WP-04 Clerk MFA live verification
5. WP-04 ClamAV upload quarantine staging rehearsal + production verification
6. Attorney Terms/Privacy approval
7. Critical security findings from prior audits
8. Production deploy authorization (no production Fly app)
9. GitHub Environment required reviewers (human UI)
10. Clerk-authenticated staging E2E identities

## External approvals still needed

- Scheduled-monitor acceptance evidence (≥2 \`schedule\` runs + SMTP path)
- GitHub Environment required reviewers (UI)
- Clerk staging synthetic identities + interactive MFA demo
- Neon corpus SELECT-only role provisioning (WP-03E)
- Attorney Terms/Privacy sign-off
- Explicit production deploy authorization (staging ≠ production certification)

## Do not claim

- Production on-call escalation
- Continuous monitor **scheduled-run** acceptance (dispatch ≠ schedule)
- Full Clerk-authenticated E2E
- Production deployment / production PITR / production certification from staging alone
- WP-06 started
- Neon corpus writes or paid AI / CourtListener calls in this verification pass
- That PR #2 introduced a separate unique merge that must be reverted
`;

fs.writeFileSync(closurePath, closure, "utf8");

console.log(
  JSON.stringify(
    {
      registerPath,
      professional: j.productCompletionInventory.Professional.byStatus,
      prosecution: j.productCompletionInventory.Prosecution.byStatus,
      p0Remaining: openP0.length,
      p1Remaining: openP1.length,
      p0: openP0,
      p1: openP1,
      mainHead: MAIN_HEAD,
    },
    null,
    2,
  ),
);
