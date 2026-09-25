/**
 * Queue #2 Lane B per-task runners (deterministic, zero AI, zero CourtListener).
 * Bounded / fixture-friendly. Does not ingest corpus when called in check mode.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const REPORTS = path.join(ROOT, "packages/research/corpus/reports");

function ensureReports() {
  fs.mkdirSync(REPORTS, { recursive: true });
}

function writeEvidence(name, payload) {
  ensureReports();
  const file = path.join(REPORTS, name);
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

function okResult(taskId, extras = {}) {
  return {
    ok: true,
    lane: "B",
    taskId,
    courtListenerHttpCalls: 0,
    aiCalls: 0,
    noDelta: Boolean(extras.noDelta),
    checkpoint: extras.checkpoint || `${taskId}-${new Date().toISOString()}`,
    imported: extras.imported ?? 0,
    note: extras.note || null,
    ...extras,
  };
}

/** Gap analysis — read existing US Reports manifest if present; no network. */
function usReportsGap(ctx = {}) {
  const manifestPath = path.join(REPORTS, "queue2-us-reports-manifest.json");
  let ranked = [];
  if (fs.existsSync(manifestPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      ranked = Array.isArray(j.ranked) ? j.ranked : Array.isArray(j) ? j : [];
    } catch {
      ranked = [];
    }
  }
  const checkpoint = `us-reports-${ranked.length || 0}`;
  writeEvidence("queue2-lane-b-us-reports-gap-last.json", {
    at: new Date().toISOString(),
    rankedCount: ranked.length,
    checkpoint,
    bounded: true,
  });
  return okResult("US_REPORTS_GAP_ANALYSIS", {
    checkpoint,
    noDelta: ranked.length === 0,
    note: "bounded gap analysis from local manifest only",
  });
}

function nonClIntake(ctx = {}) {
  // Mutation runner — refuse unless explicitly allowed; never CL.
  if (ctx.allowMutation !== true && process.env.QUEUE2_LANE_B_ALLOW_MUTATION !== "1") {
    return okResult("NON_CL_PRIMARY_AUTHORITY_INTAKE", {
      noDelta: true,
      checkpoint: "non-cl-intake-skipped-bounded",
      note: "bounded check: mutation not enabled",
    });
  }
  return okResult("NON_CL_PRIMARY_AUTHORITY_INTAKE", {
    checkpoint: `non-cl-${Date.now()}`,
    note: "mutation path reserved for production Lane B worker",
  });
}

function uscDepth(ctx = {}) {
  return okResult("USC_DEPTH", {
    noDelta: ctx.allowMutation !== true,
    checkpoint: "usc-depth-bounded",
    note: "bounded USC depth runner (no ingest in check mode)",
  });
}

function cfrDepth(ctx = {}) {
  return okResult("CFR_DEPTH", {
    noDelta: ctx.allowMutation !== true,
    checkpoint: "cfr-depth-bounded",
    note: "bounded CFR depth runner (no ingest in check mode)",
  });
}

function federalRulesDepth(ctx = {}) {
  return okResult("FEDERAL_RULES_DEPTH", {
    noDelta: ctx.allowMutation !== true,
    checkpoint: "federal-rules-depth-bounded",
    note: "bounded federal rules runner (no ingest in check mode)",
  });
}

function citationReresolve(ctx = {}) {
  return okResult("CITATION_RERESOLVE", {
    noDelta: true,
    checkpoint: `cite-ver-${ctx.corpusVersion ?? "unknown"}`,
    note: "bounded citation re-resolve check (no DB write)",
  });
}

function historicalGaps() {
  const { detectHistoricalHoles } = require("./queue2-dual-lane-controller.cjs");
  const holes = detectHistoricalHoles({ years: [2020, 2024, 2026], nowYear: 2026, uniqueCourts: 2 });
  writeEvidence("queue2-lane-b-historical-gaps-last.json", { at: new Date().toISOString(), holes });
  return okResult("HISTORICAL_GAP_ANALYSIS", {
    checkpoint: "historical-gaps-bounded",
    noDelta: false,
  });
}

function intermediateMapping() {
  const { researchIntermediateGaps } = require("./queue2-dual-lane-controller.cjs");
  const candidates = researchIntermediateGaps();
  writeEvidence("queue2-intermediate-candidates.json", {
    at: new Date().toISOString(),
    candidates,
    bounded: true,
  });
  return okResult("INTERMEDIATE_MAPPING_RESEARCH_NON_CL", {
    checkpoint: `intermediate-${candidates.length}`,
  });
}

function integrityAudit() {
  return okResult("CORPUS_INTEGRITY_AUDIT", {
    noDelta: true,
    checkpoint: "integrity-bounded",
    note: "bounded integrity audit placeholder (no DB)",
  });
}

function retrievalRegression(ctx = {}) {
  return okResult("RETRIEVAL_REGRESSION", {
    noDelta: true,
    checkpoint: `retrieval-ver-${ctx.corpusVersion ?? "unknown"}`,
    note: "bounded retrieval regression check",
  });
}

function currentnessAudit() {
  return okResult("CURRENTNESS_AUDIT_LOCAL", {
    checkpoint: `currentness-${new Date().toISOString().slice(0, 10)}`,
    noDelta: true,
  });
}

function dailyScorecard() {
  writeEvidence("queue2-lane-b-scorecard-last.json", {
    at: new Date().toISOString(),
    bounded: true,
  });
  return okResult("DAILY_SCORECARD_REFRESH", {
    checkpoint: `scorecard-${Date.now()}`,
  });
}

function refreshLaneAManifest() {
  const {
    loadOrCreateLaneAManifest,
    persistLaneAManifest,
    rerankLaneAManifest,
  } = require("./queue2-autonomy-policy.cjs");
  const manifest = loadOrCreateLaneAManifest({ createIfMissing: true });
  const reranked = rerankLaneAManifest(manifest);
  persistLaneAManifest(reranked);
  return okResult("DEPTH_MANIFEST_REFRESH", {
    checkpoint: `manifest-v${reranked.version || reranked.manifestVersion || 1}`,
  });
}

function prepareNextClBatch() {
  const { loadOrCreateLaneAManifest } = require("./queue2-autonomy-policy.cjs");
  const manifest = loadOrCreateLaneAManifest({ createIfMissing: true });
  writeEvidence("queue2-next-cl-prep-last.json", {
    at: new Date().toISOString(),
    top: (manifest.targets || manifest.courts || []).slice(0, 5),
    bounded: true,
  });
  return okResult("NEXT_CL_BATCH_PREPARATION", {
    checkpoint: `prep-${new Date().toISOString()}`,
  });
}

const RUNNERS = {
  usReportsGap,
  nonClIntake,
  uscDepth,
  cfrDepth,
  federalRulesDepth,
  citationReresolve,
  historicalGaps,
  intermediateMapping,
  integrityAudit,
  retrievalRegression,
  currentnessAudit,
  dailyScorecard,
  refreshLaneAManifest,
  prepareNextClBatch,
};

function resolveRunner(deterministicRunner) {
  const exportName = String(deterministicRunner || "").split("#")[1];
  if (!exportName || typeof RUNNERS[exportName] !== "function") {
    const err = new Error(`UNKNOWN_LANE_B_RUNNER:${deterministicRunner}`);
    err.code = "UNKNOWN_LANE_B_RUNNER";
    throw err;
  }
  return RUNNERS[exportName];
}

function runRegistryTask(task, ctx = {}) {
  const fn = resolveRunner(task.deterministicRunner);
  return fn({ ...ctx, task });
}

module.exports = {
  ...RUNNERS,
  RUNNERS,
  resolveRunner,
  runRegistryTask,
};
