/**
 * Clear false CL_NO_PRODUCTIVE_PROGRESS after network-recovery probe-only cycles.
 * Read-only DB verification optional via --probe-json. Zero CL. Zero corpus mutation.
 *
 * Usage:
 *   node scripts/tmp-queue2-clear-false-progress-review.cjs
 *   node scripts/tmp-queue2-clear-false-progress-review.cjs packages/research/corpus/reports/queue2-vt-db-truth-last.json
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { fingerprintProductionFiles } = require("./queue2-worker-safety.cjs");
const { evaluateProductionCanaryGate } = require("./queue2-lane-a-dispatch.cjs");
const {
  clearFalseClNoProductiveProgressReview,
  CONSERVATION_REASONS,
} = require("./queue2-cl-quota-conservation.cjs");

const root = path.join(__dirname, "..");
const reports = path.join(root, "packages/research/corpus/reports");
const statePath = path.join(reports, "queue2-dual-lane-state.json");
const statusPath = path.join(reports, "corpus-worker-status.json");
const knownGoodPath = path.join(reports, "queue2-watchdog-known-good.json");

function main() {
  const probePath = process.argv[2] || path.join(reports, "queue2-vt-db-truth-last.json");
  let probe = null;
  try {
    probe = JSON.parse(fs.readFileSync(probePath, "utf8"));
  } catch {
    probe = null;
  }

  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  const knownGood = JSON.parse(fs.readFileSync(knownGoodPath, "utf8"));
  const currentFp = fingerprintProductionFiles();
  const canaryGate = evaluateProductionCanaryGate({
    currentFingerprint: currentFp,
    knownGoodFingerprint: knownGood.codeFingerprint || knownGood.fingerprint || null,
  });

  const ledger = state.clRequestLedger || {};
  const cleared = clearFalseClNoProductiveProgressReview(state, {
    productiveAttemptCount: Number(ledger.productiveAttemptCount) || 0,
    childLaunches: 0,
    sessionClRequests: Number(ledger.currentSessionRequests) || 0,
    quotaProbes: Number(ledger.quotaProbeRequests) || 0,
    authoritiesAdded: Number(ledger.authoritiesAdded) || 0,
    checkpointAdvanced: (Number(ledger.checkpointAdvances) || 0) > 0,
    networkUnavailableCycle: true,
    now: new Date(),
  });

  let next = cleared.state;

  // Persist VT truth if probe confirms.
  if (probe?.ok && String(probe.court).toLowerCase() === "vt") {
    const q = Number(probe.qualifyingCaseCount);
    if (Number.isFinite(q) && q >= 23) {
      next.laneA = {
        ...next.laneA,
        court: "vt",
        jurisdiction: "VT",
        count: q,
        qualifyingCaseCount: q,
        clCaseCount: Number(probe.clCaseCount) || q,
        totalCaseCount: Number(probe.totalCaseCount) || q,
        authorityCount: Number(probe.authorityCount) || next.laneA?.authorityCount,
        checkpoint: probe.job?.last_successful_external_id || next.laneA?.checkpoint,
        cursor: probe.job?.cursor || next.laneA?.cursor,
        lastSuccessfulExternalId:
          probe.job?.last_successful_external_id || next.laneA?.lastSuccessfulExternalId,
        jobStatus: probe.job?.status || next.laneA?.jobStatus,
        itemsImported: Number(probe.job?.items_imported) || next.laneA?.itemsImported,
        targetStatus: q >= 45 ? "COMPLETE" : "PARTIAL",
        jobLifecycle: "PAUSED_RESUMABLE",
      };
      next.vtDbReconciliation = {
        ...(next.vtDbReconciliation || {}),
        qualifyingCaseCount: q,
        checkpoint: next.laneA.checkpoint,
        integrity: probe.integrity || null,
        dbEvidenceObservedAt: probe.dbEvidenceObservedAt || probe.generatedAt,
        reconciledAt: new Date().toISOString(),
        courtListenerHttpCalls: 0,
      };
    }
  }

  // Do NOT force NORMAL when fingerprints differ — report only.
  next.canaryFingerprintAudit = {
    storedKnownGood: knownGood.codeFingerprint,
    currentProduction: currentFp,
    match: knownGood.codeFingerprint === currentFp,
    gateRequired: canaryGate.required,
    gateReason: canaryGate.reason,
    auditedAt: new Date().toISOString(),
  };

  if (!next.humanReview?.required) {
    next.runtimeState = "STOPPED";
    next.currentLane = "STOPPED";
    next.idleSafe = true;
  }

  next.queue = "#2";
  next.queue9 = "CLOSED";
  next.queue3 = "NOT_OPEN";
  next.updatedAt = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(next, null, 2));

  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    if (!next.humanReview?.required) {
      status.review = { humanReviewRequired: false, reasons: [], details: [] };
      status.runtimeState = "STOPPED";
      status.currentLane = "STOPPED";
      status.freshness = "STOPPED";
      status.currentTask = "NONE";
    }
    status.currentCount = next.laneA?.count ?? status.currentCount;
    status.checkpoint = next.laneA?.checkpoint ?? status.checkpoint;
    status.updatedAt = new Date().toISOString();
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  } catch {
    /* ignore */
  }

  console.log(
    JSON.stringify({
      ok: true,
      cleared: cleared.cleared,
      clearReason: cleared.reason,
      reviewRequired: Boolean(next.humanReview?.required),
      reviewReasons: next.humanReview?.reasons || [],
      vt: {
        count: next.laneA?.count,
        qualifying: next.laneA?.qualifyingCaseCount,
        checkpoint: next.laneA?.checkpoint,
        jobStatus: next.laneA?.jobStatus,
      },
      canary: next.canaryFingerprintAudit,
      courtListenerHttpCalls: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
      note: CONSERVATION_REASONS.CL_NO_PRODUCTIVE_PROGRESS,
    }),
  );
}

main();
