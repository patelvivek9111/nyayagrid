#!/usr/bin/env node
/**
 * Queue #2 durable state reconciliation — NO worker start, NO CourtListener, NO corpus mutations.
 *
 * Usage:
 *   npm run queue2:reconcile-state
 *   npm run queue2:reconcile-state -- --dry-run
 */
"use strict";

const path = require("node:path");
const {
  STATE_PATH,
  MANIFEST_PATH,
  STATUS_PATH,
  readJson,
  persistConvergedQueue2State,
  loadNeonHoldArtifact,
} = require("./queue2-durable-state-convergence.cjs");

const dryRun =
  process.argv.includes("--dry-run") ||
  process.env.QUEUE2_RECONCILE_DRY_RUN === "1" ||
  process.env.QUEUE2_RECONCILE_DRY_RUN === "true";
const root = path.join(__dirname, "..");

function main() {
  const state = readJson(STATE_PATH);
  const manifest = readJson(MANIFEST_PATH);
  const neonHold = loadNeonHoldArtifact();
  const result = persistConvergedQueue2State({
    state,
    manifest,
    neonHold,
    forceDatabaseQuotaBlocked: Boolean(neonHold),
    dryRun,
    now: new Date(),
  });

  const summary = {
    ok: result.ok,
    dryRun: Boolean(dryRun),
    persisted: Boolean(result.persisted),
    reason: result.reason || null,
    currentCourt: result.state?.laneA?.court || null,
    currentJurisdiction: result.state?.laneA?.jurisdiction || null,
    qualifyingCaseCount: result.state?.laneA?.qualifyingCaseCount ?? result.state?.laneA?.count ?? null,
    target: result.state?.laneA?.target ?? null,
    jobLifecycle: result.state?.laneA?.jobLifecycle || null,
    checkpoint: result.state?.laneA?.checkpoint ?? null,
    completedCourts: result.state?.completedCourts?.length ?? null,
    completedEvidenceCount: result.completedEvidenceCount ?? null,
    inventedCheckpoints: result.inventedCheckpoints || [],
    databaseBlock: result.state?.databaseBlock?.classification || null,
    quotaExecutionAuthority: result.status?.quota?.executionAuthority ?? null,
    clRequests: 0,
    childLaunches: 0,
    mutations: 0,
    aiCalls: 0,
    queue3: "NOT_OPEN",
    statePath: STATE_PATH,
    statusPath: STATUS_PATH,
    workerStarted: false,
  };

  if (result.ok) {
    console.log(dryRun ? "QUEUE2_STATE_RECONCILE_DRY_RUN" : "QUEUE2_STATE_RECONCILE_PASS");
  } else {
    console.log("QUEUE2_STATE_RECONCILE_FAIL");
  }
  console.log(JSON.stringify(summary, null, 2));
  process.exit(result.ok ? 0 : 2);
}

main();
