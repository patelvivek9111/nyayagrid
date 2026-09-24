"use strict";
/**
 * Rebuild Lane A depth manifest from live corpus snapshot. ZERO mutations to corpus.
 */
const fs = require("fs");
const path = require("path");
const {
  rebuildLaneAManifestFromSnapshot,
  persistLaneAManifest,
  topRankedLaneATargets,
  validateManifestForLaneA,
  MANIFEST_PATH,
  SNAPSHOT_PATH,
  loadVersions,
  WORKER_VERSION,
  fingerprintProductionFiles,
} = require("./queue2-worker-safety.cjs");

const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_PATH, "utf8"));
const statePath = path.join(__dirname, "../packages/research/corpus/reports/queue2-dual-lane-state.json");
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));

const manifest = rebuildLaneAManifestFromSnapshot(snapshot, {
  version: 2,
  arkCheckpoint: state.laneA?.checkpoint || "cl-opinion-9885161",
  checkpoints: { ark: state.laneA?.checkpoint || "cl-opinion-9885161" },
  knownGoodBaseline: { AR: { cases: 33 } },
});

persistLaneAManifest(manifest, MANIFEST_PATH);

const versions = {
  ...loadVersions(),
  workerVersion: WORKER_VERSION,
  laneAManifestVersion: manifest.version,
  laneBRegistryVersion: 1,
  configVersion: 1,
  checkpointSchemaVersion: 1,
  corpusSchemaVersion: 1,
  codeFingerprint: fingerprintProductionFiles(),
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(
  path.join(__dirname, "../packages/research/corpus/reports/queue2-worker-versions.json"),
  JSON.stringify(versions, null, 2),
);

const validation = validateManifestForLaneA(manifest);
const top10 = topRankedLaneATargets(manifest, 10);
console.log(
  JSON.stringify(
    {
      ok: validation.ok,
      validation,
      reconciliation: manifest.reconciliation,
      activePartial: manifest.activePartial,
      unknownCount: manifest.unknownCount,
      falseZeroBlocked: manifest.falseZeroBlocked,
      top10,
      jurisdictions: manifest.reconciliation.jurisdictionsPresent,
      aggregateCases: manifest.reconciliation.aggregateSnapshotCases,
      corpusCases: manifest.reconciliation.corpusCases,
    },
    null,
    2,
  ),
);
process.exit(validation.ok ? 0 : 2);
