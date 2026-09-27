/**
 * Clear false HEARTBEAT_DEADMAN + persist VT DB truth (read-only probe input).
 * Zero CL. Zero corpus mutation. Zero child launch.
 *
 * Usage:
 *   node scripts/tmp-queue2-clear-heartbeat-deadman.cjs [probe.json]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { clearFalsePositiveHeartbeatDeadman } = require("./queue2-watchdog.cjs");

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
  const cleared = clearFalsePositiveHeartbeatDeadman(state.humanReview || {});
  state.humanReview = {
    required: cleared.required,
    reasons: cleared.reasons,
    details: cleared.details,
  };
  if (cleared.cleared) {
    state.falseHeartbeatDeadmanCleared = {
      classification: "FALSE_POSITIVE_INTENTIONAL_IDLE",
      clearedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      mutations: 0,
      aiCalls: 0,
    };
  }
  state.intentionalIdleUntil = null;
  state.intentionalIdleReason = null;
  state.unresolvedUnknown = false;
  state.clSharedSession = null;
  state.laneABatchBudget = null;
  state.sessionBudgetExhausted = false;

  if (probe?.ok && String(probe.court).toLowerCase() === "vt") {
    const q = Number(probe.qualifyingCaseCount);
    if (Number.isFinite(q)) {
      state.laneA = {
        ...state.laneA,
        court: "vt",
        jurisdiction: "VT",
        count: q,
        qualifyingCaseCount: q,
        clCaseCount: Number(probe.clCaseCount) || q,
        totalCaseCount: Number(probe.totalCaseCount) || q,
        authorityCount: Number(probe.authorityCount) || state.laneA?.authorityCount,
        checkpoint: probe.job?.last_successful_external_id || state.laneA?.checkpoint,
        cursor: probe.job?.cursor || state.laneA?.cursor,
        lastSuccessfulExternalId:
          probe.job?.last_successful_external_id || state.laneA?.lastSuccessfulExternalId,
        jobStatus: probe.job?.status || state.laneA?.jobStatus,
        itemsImported: Number(probe.job?.items_imported) || state.laneA?.itemsImported,
        targetStatus: q >= 45 ? "COMPLETE" : "PARTIAL",
        jobLifecycle: "PAUSED_RESUMABLE",
      };
      if (probe.job?.next_page_url) state.laneA.nextPageUrl = probe.job.next_page_url;
      state.vtDbReconciliation = {
        qualifyingCaseCount: q,
        checkpoint: state.laneA.checkpoint,
        jobStatus: state.laneA.jobStatus,
        integrity: probe.integrity || null,
        api_calls: probe.job?.api_calls ?? null,
        items_imported: probe.job?.items_imported ?? null,
        dbEvidenceObservedAt: probe.dbEvidenceObservedAt || probe.generatedAt,
        reconciledAt: new Date().toISOString(),
        courtListenerHttpCalls: 0,
      };
    }
  }

  // Preserve NORMAL canary mode + known-good; do not force re-canary here.
  if (state.canaryMode !== "NORMAL" && knownGood?.codeFingerprint) {
    // leave as-is if worker left it NORMAL already
  }
  state.canaryMode = state.canaryMode || "NORMAL";
  state.canary = {
    ...(state.canary || {}),
    required: state.canaryMode === "CANARY_REQUIRED",
    knownGoodFingerprint: knownGood.codeFingerprint || null,
  };

  if (!state.humanReview.required) {
    state.runtimeState = "STOPPED";
    state.currentLane = "STOPPED";
    state.idleSafe = true;
  }
  state.queue = "#2";
  state.queue9 = "CLOSED";
  state.queue3 = "NOT_OPEN";
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  try {
    const status = JSON.parse(fs.readFileSync(statusPath, "utf8"));
    if (!state.humanReview.required) {
      status.review = { humanReviewRequired: false, reasons: [], details: [] };
      status.runtimeState = "STOPPED";
      status.currentLane = "STOPPED";
      status.freshness = "STOPPED";
      status.currentTask = "NONE";
    }
    status.currentCount = state.laneA?.count ?? status.currentCount;
    status.checkpoint = state.laneA?.checkpoint ?? status.checkpoint;
    status.cursor = state.laneA?.cursor ?? status.cursor;
    status.lastSuccessfulExternalId =
      state.laneA?.lastSuccessfulExternalId ?? status.lastSuccessfulExternalId;
    status.updatedAt = new Date().toISOString();
    fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
  } catch {
    /* ignore */
  }

  console.log(
    JSON.stringify({
      ok: true,
      heartbeatCleared: cleared.cleared,
      reviewRequired: state.humanReview.required,
      reviewReasons: state.humanReview.reasons,
      canaryMode: state.canaryMode,
      knownGoodFingerprint: knownGood.codeFingerprint || null,
      vt: {
        count: state.laneA?.count,
        qualifying: state.laneA?.qualifyingCaseCount,
        checkpoint: state.laneA?.checkpoint,
        jobStatus: state.laneA?.jobStatus,
        integrity: state.vtDbReconciliation?.integrity || null,
      },
      courtListenerHttpCalls: 0,
      childLaunches: 0,
      mutations: 0,
      aiCalls: 0,
    }),
  );
}

main();
