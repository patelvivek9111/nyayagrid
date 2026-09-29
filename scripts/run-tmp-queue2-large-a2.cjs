#!/usr/bin/env node
/**
 * Local orchestrator for large Queue #2 A2 verified recovery.
 * Does NOT start queue2:worker. Uploads verified-batch + cite-integrity to staging.
 */
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");
const SESSION_BUDGET = Number(process.env.A2_SESSION_BUDGET || 200);
const HARD_BUDGET = Number(process.env.A2_HARD_BUDGET || 240);
const PRODUCTIVE_FLOOR = 3.0;
const OVERALL_FLOOR = 2.75;
const BATCH_SIZE = 5;
const MAX_BATCHES = Number(process.env.A2_MAX_BATCHES || 40);
const MIN_EXPECTED = Number(process.env.A2_MIN_EXPECTED || 6);
const DENY = new Set(["573 U.S. 373"]);

function runNode(args, env = {}) {
  const r = spawnSync(process.execPath, args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 20_000_000,
    env: { ...process.env, ...env },
  });
  return { status: r.status ?? 1, out: `${r.stdout || ""}${r.stderr || ""}` };
}

function parseLastJson(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* continue */
    }
  }
  // try whole text
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function flyTool(script, args, timeoutSec) {
  const r = runNode(["scripts/run-tmp-fly-node.cjs", script, ...args], {
    FLY_TOOL_TIMEOUT_SEC: String(timeoutSec),
  });
  const json = parseLastJson(r.out);
  return { ...r, json };
}

function loadCandidates() {
  const queuePath = path.join(REPORTS, "queue2-citation-acquisition-queue.json");
  if (!fs.existsSync(queuePath)) return [];
  const j = JSON.parse(fs.readFileSync(queuePath, "utf8"));
  return (j.A2_citationTargetRecovery?.candidates || [])
    .filter((c) => c.family === "us_reports" || /U\.S\./.test(c.citation || ""))
    .filter((c) => Number(c.edgesPotentiallyUnlocked || c.expected || 0) >= MIN_EXPECTED)
    .map((c) => ({
      citation: c.citation,
      expected: c.edgesPotentiallyUnlocked || c.expected || 0,
    }));
}

function writeJson(name, obj) {
  fs.mkdirSync(REPORTS, { recursive: true });
  fs.writeFileSync(path.join(REPORTS, name), JSON.stringify(obj, null, 2));
}

function main() {
  const state = {
    classification: "MANUAL_QUEUE2_LARGE_A2_FEDERAL_RECOVERY",
    startedAt: new Date().toISOString(),
    quotaStart: JSON.parse(process.env.A2_QUOTA_START_JSON || "{}"),
    sessionBudget: SESSION_BUDGET,
    hardBudget: HARD_BUDGET,
    totalCl: 0,
    productiveCl: 0, // CL spent on successfully acquired authorities
    lookupWasteCl: 0,
    acquired: 0,
    attempted: 0,
    skipped: [],
    successes: [],
    microBatches: [],
    deferred: [...DENY].map((c) => ({ citation: c, reason: "prior_no_verified_search_match", clRequests: 0, retry: "defer" })),
    citationsStart: null,
    citationsEnd: null,
    stopReason: null,
  };

  // Initial cite snapshot via integrity (no mutate if nothing to resolve — still OK)
  {
    const cite = flyTool("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 240);
    if (!cite.json?.ok) {
      console.log(JSON.stringify({ ok: false, step: "initial_cite", err: cite.out.slice(0, 400) }));
      process.exit(1);
    }
    state.citationsStart = {
      extracted: cite.json.extracted,
      resolved: cite.json.resolvedAfter,
      unresolved: cite.json.targetAbsent,
      targetAbsent: cite.json.targetAbsent,
      resolutionRatePct: cite.json.extracted
        ? Number(((100 * cite.json.resolvedAfter) / cite.json.extracted).toFixed(2))
        : 0,
    };
  }

  let candidates = loadCandidates().filter((c) => !DENY.has(c.citation));
  let cursor = 0;
  let sinceRefresh = 0;

  for (let batchNo = 1; batchNo <= MAX_BATCHES; batchNo++) {
    if (state.totalCl >= SESSION_BUDGET || state.totalCl >= HARD_BUDGET) {
      state.stopReason = "session_budget";
      break;
    }
    if (state.totalCl >= HARD_BUDGET - 5) {
      state.stopReason = "hard_budget_margin";
      break;
    }

    // refresh candidate ordering every 20 acquisitions
    if (sinceRefresh >= 20) {
      const pri = flyTool("scripts/tmp-queue2-citation-target-priority-bundled.cjs", [], 240);
      if (pri.json?.ok) {
        const tops = (pri.json.top100MissingTargets || pri.json.top20MissingTargets || [])
          .filter((t) => t.family === "us_reports" && t.clObtainable && !t.presentInCorpus)
          .map((t) => ({ citation: t.normalizedCitation, expected: t.estimatedCitationEdgesUnlocked }));
        writeJson("queue2-citation-acquisition-queue.json", {
          classification: "QUEUE2_CITATION_ACQUISITION_QUEUE",
          generatedAt: pri.json.generatedAt || new Date().toISOString(),
          courtListenerHttpCalls: 0,
          source: "large_a2_mid_session_refresh",
          A1_depthCompletion: { status: "COMPLETE", completed: 51, remaining: 0 },
          citationBaseline: pri.json.citationBaseline,
          A2_citationTargetRecovery: {
            candidates: tops.map((t, i) => ({
              rank: i + 1,
              citation: t.citation,
              edgesPotentiallyUnlocked: t.expected,
              family: "us_reports",
              recommendedPath: "cl_a2_verified",
            })),
          },
          reporterGaps: pri.json.reporterGaps,
        });
        candidates = tops.filter((c) => !DENY.has(c.citation) && !state.deferred.some((d) => d.citation === c.citation));
        cursor = 0;
        sinceRefresh = 0;
      }
    }

    // pull a window of candidates larger than batch to allow preverify skips
    const window = [];
    while (window.length < BATCH_SIZE * 4 && cursor < candidates.length) {
      const c = candidates[cursor++];
      if (DENY.has(c.citation)) continue;
      if (state.deferred.some((d) => d.citation === c.citation)) continue;
      if (state.successes.some((s) => s.citation === c.citation)) continue;
      window.push(c);
    }
    if (window.length === 0) {
      state.stopReason = "no_candidates";
      break;
    }

    const citeList = window.map((w) => w.citation).join("|");
    const expectedMap = Object.fromEntries(window.map((w) => [w.citation, w.expected]));
    const remainingBudget = Math.min(SESSION_BUDGET, HARD_BUDGET) - state.totalCl;
    const maxCalls = Math.min(25, Math.max(8, remainingBudget));

    console.error(JSON.stringify({ event: "batch_start", batchNo, cites: window.slice(0, 12).map((w) => w.citation), maxCalls, totalCl: state.totalCl }));

    const batch = flyTool(
      "scripts/tmp-queue2-a2-verified-batch-bundled.cjs",
      [citeList, String(maxCalls), String(BATCH_SIZE)],
      540,
    );
    if (!batch.json?.ok) {
      state.stopReason = "batch_failed";
      state.batchError = (batch.out || "").slice(0, 600);
      writeJson(`queue2-large-a2-batch${batchNo}-err.txt`, { out: batch.out.slice(0, 4000) });
      break;
    }

    fs.writeFileSync(path.join(REPORTS, `queue2-large-a2-batch${batchNo}-raw.json`), JSON.stringify(batch.json, null, 2));

    const clSpent = Number(batch.json.courtListenerHttpCalls || 0);
    state.totalCl += clSpent;
    state.attempted += Number(batch.json.preverified || 0) + (batch.json.deferred || []).filter((d) => d.clRequests > 0).length;

    for (const d of batch.json.deferred || []) {
      DENY.add(d.citation);
      if (!state.deferred.some((x) => x.citation === d.citation)) state.deferred.push(d);
      state.lookupWasteCl += Number(d.clRequests || 0);
      state.skipped.push(d);
    }

    const acquiredRows = (batch.json.results || []).filter((r) => r.status === "imported" || r.status === "new_version");
    for (const r of acquiredRows) {
      state.acquired += 1;
      sinceRefresh += 1;
      state.productiveCl += Number(r.clRequests || 0);
      state.successes.push({
        citation: r.citation,
        title: r.title,
        reporter: r.reporter || "U.S.",
        expected: expectedMap[r.citation] ?? null,
        actual: null,
        cl: r.clRequests,
        authorityId: r.authorityId,
      });
    }

    if (batch.json.rateLimited) {
      state.stopReason = "429";
      // still reresolve what we got
    }

    if ((batch.json.orphans || 0) > 0 || (batch.json.duplicateSourceIds || 0) > 0) {
      state.stopReason = "integrity_regression";
    }

    if ((batch.json.chunks?.missing_embeddings || 0) > 0) {
      state.stopReason = "embedding_failure";
    }

    // citation reresolve zero CL
    const cite = flyTool("scripts/tmp-queue2-manual-cite-integrity-bundled.cjs", [], 300);
    if (!cite.json?.ok) {
      state.stopReason = "cite_reresolve_failed";
      break;
    }
    const newlyResolved = Number(cite.json.newResolved || 0);
    const after = {
      extracted: cite.json.extracted,
      resolved: cite.json.resolvedAfter,
      unresolved: cite.json.targetAbsent,
      targetAbsent: cite.json.targetAbsent,
      resolutionRatePct: cite.json.extracted
        ? Number(((100 * cite.json.resolvedAfter) / cite.json.extracted).toFixed(2))
        : 0,
    };
    state.citationsEnd = after;

    // attribute actuals for this batch authorities
    for (const s of state.successes) {
      if (s.actual != null) continue;
      // will fill via attribution script at end; provisional: leave null
    }

    const overallResPerCl = state.totalCl ? newlyResolved /* only this batch */ : 0;
    // cumulative newly resolved from start
    const cumulativeResolved = after.resolved - state.citationsStart.resolved;
    const overallEff = state.totalCl ? cumulativeResolved / state.totalCl : 0;
    const productiveEff = state.productiveCl ? cumulativeResolved / state.productiveCl : 0;

    const mb = {
      batch: batchNo,
      targetCount: acquiredRows.length,
      clRequests: clSpent,
      newlyResolved,
      cumulativeResolved,
      overallResPerCl: Number(overallEff.toFixed(3)),
      productiveResPerCl: Number(productiveEff.toFixed(3)),
      resolutionRateDelta: Number((after.resolutionRatePct - (state.microBatches.length ? state.microBatches[state.microBatches.length - 1].afterRate : state.citationsStart.resolutionRatePct)).toFixed(3)),
      afterRate: after.resolutionRatePct,
      corpus: batch.json.corpus,
      deferredThisBatch: (batch.json.deferred || []).map((d) => d.citation),
    };
    state.microBatches.push(mb);
    console.error(JSON.stringify({ event: "batch_done", ...mb }));

    writeJson("queue2-large-a2-session-progress.json", state);

    if (state.stopReason) break;

    if (acquiredRows.length === 0) {
      // if we spent lookups but acquired nothing and deferred some, continue if overall still ok
      if ((batch.json.deferred || []).length === 0) {
        state.stopReason = "zero_progress_batch";
        break;
      }
      // continue hunting with more candidates
    }

    if (acquiredRows.length > 0 && newlyResolved === 0) {
      state.stopReason = "zero_resolution_productive_micro_batch";
      break;
    }

    // efficiency gates after at least one productive acquisition
    if (state.acquired > 0 && state.totalCl >= 8) {
      if (productiveEff < PRODUCTIVE_FLOOR && overallEff < OVERALL_FLOOR) {
        state.stopReason = "both_efficiency_floors";
        break;
      }
      if (productiveEff < PRODUCTIVE_FLOOR) {
        // Prefer stopping when density cannot sustain floor (expected/CL < 3).
        state.stopReason = "productive_efficiency_floor";
        break;
      }
      if (overallEff < OVERALL_FLOOR && productiveEff >= PRODUCTIVE_FLOOR) {
        console.error(JSON.stringify({ event: "tighten_preverify", overallEff, productiveEff }));
      }
    }
  }

  // final attribution for successes
  if (state.successes.length) {
    const attrScript = path.join(REPORTS, "..", "..", "..", "scripts", "tmp-queue2-large-a2-attr-once.cjs");
    // write inline attr payload file consumed by a tiny generated script on next step — instead run gap + attr via fly using dynamic list embedded later
  }

  state.finishedAt = new Date().toISOString();
  const cumulativeResolved =
    state.citationsEnd && state.citationsStart ? state.citationsEnd.resolved - state.citationsStart.resolved : 0;
  state.totals = {
    newlyResolved: cumulativeResolved,
    targetAbsentReduction:
      state.citationsEnd && state.citationsStart
        ? state.citationsStart.targetAbsent - state.citationsEnd.targetAbsent
        : 0,
    overallResPerCl: state.totalCl ? Number((cumulativeResolved / state.totalCl).toFixed(3)) : 0,
    productiveResPerCl: state.productiveCl ? Number((cumulativeResolved / state.productiveCl).toFixed(3)) : 0,
    resPerAuthority: state.acquired ? Number((cumulativeResolved / state.acquired).toFixed(3)) : 0,
  };
  writeJson("queue2-large-a2-session-progress.json", state);
  console.log(JSON.stringify({ ok: true, ...state }, null, 2));
}

main();
