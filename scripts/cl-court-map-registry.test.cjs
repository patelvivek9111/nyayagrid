const assert = require("node:assert/strict");
const {
  getCourtEntry,
  shouldSkipIngest,
  classifyCourtVerifyHttp,
  needsLiveVerification,
  applyVerificationResult,
  listWave1IntermediatePlan,
  nationalHighReadiness,
  REGISTRY,
} = require("./cl-court-map-registry.cjs");

function testMappingInvalidSkip() {
  for (const id of ["pacommwlth", "njsuperct", "vacapp"]) {
    const e = getCourtEntry(id);
    assert.ok(e);
    assert.equal(e.verificationStatus, "MAPPING_INVALID");
    assert.equal(e.ingestEnabled, false);
    assert.equal(e.canonicalClId, null);
    const gate = shouldSkipIngest(e);
    assert.equal(gate.skip, true);
    assert.equal(needsLiveVerification(e), false); // never re-hit known-bad id
  }
}

function testTexappTransient() {
  const e = getCourtEntry("texapp");
  assert.ok(e);
  assert.equal(e.verificationStatus, "VERIFIED");
  assert.equal(e.ingestEnabled, true);
  assert.equal(e.transientError, "discover_http_502");
  assert.equal(e.nextAction, "TRANSIENT_RETRY");
  assert.equal(e.checkpoint, "cl-opinion-9944747");
  assert.equal(shouldSkipIngest(e).skip, false);
  assert.equal(needsLiveVerification(e), false);
}

function testVerifiedCacheNoLiveVerify() {
  const e = getCourtEntry("pasuperct");
  assert.equal(e.verificationStatus, "VERIFIED");
  assert.equal(needsLiveVerification(e), false);
}

function testClassifyHttp() {
  assert.equal(classifyCourtVerifyHttp(200, { full_name: "X" }).verificationStatus, "VERIFIED");
  assert.equal(classifyCourtVerifyHttp(404).verificationStatus, "MAPPING_INVALID");
  assert.equal(classifyCourtVerifyHttp(502).verificationStatus, "TRANSIENT_RETRY");
  assert.equal(classifyCourtVerifyHttp(502).transient, true);
  assert.equal(classifyCourtVerifyHttp(429).hardStop, true);
}

function testApplyVerificationMutatesCacheOnly() {
  const cache = {};
  applyVerificationResult(cache, "demo", classifyCourtVerifyHttp(404));
  assert.equal(cache.demo.verificationStatus, "MAPPING_INVALID");
  applyVerificationResult(cache, "demo2", classifyCourtVerifyHttp(200, { full_name: "Demo Court" }));
  assert.equal(cache.demo2.verificationStatus, "VERIFIED");
  assert.equal(cache.demo2.courtName, "Demo Court");
}

function testCheckpointPreservedOnMappingFailure() {
  const plan = listWave1IntermediatePlan();
  const pa = plan.find((p) => p.clCourtId === "pasuperct");
  const bad = plan.find((p) => p.clCourtId === "pacommwlth");
  assert.equal(pa.checkpoint, "cl-opinion-11441953");
  assert.equal(bad.skip, true);
  assert.equal(bad.checkpoint, null);
  // completed court checkpoint not cleared by sibling mapping failure
  assert.notEqual(pa.verificationStatus, "MAPPING_INVALID");
}

function testNationalReadiness() {
  const rows = nationalHighReadiness();
  for (const r of rows) {
    assert.equal(r.status, "VERIFIED", r.clCourtId);
    assert.equal(r.ingestEnabled, true);
  }
}

function testNoFabricatedReplacementIds() {
  for (const id of ["pacommwlth", "njsuperct", "vacapp"]) {
    assert.equal(REGISTRY[id].canonicalClId, null);
  }
}

testMappingInvalidSkip();
testTexappTransient();
testVerifiedCacheNoLiveVerify();
testClassifyHttp();
testApplyVerificationMutatesCacheOnly();
testCheckpointPreservedOnMappingFailure();
testNationalReadiness();
testNoFabricatedReplacementIds();
console.log(JSON.stringify({ ok: true, tests: 8 }));
