#!/usr/bin/env node
"use strict";

/**
 * Deterministic pre-enablement gates for US_REPORTS_NON_CL_INTAKE.
 * Zero CourtListener HTTP. Does not mutate corpus.
 */

const assert = require("node:assert/strict");
const {
  assertLaneBUrlAllowed,
  installLaneBFetchGuard,
  uninstallLaneBFetchGuard,
  isCourtListenerUrl,
  parseUsReportsCitation,
  rankMissingUsReports,
} = require("./queue2-dual-lane-controller.cjs");
const { nonClIntake } = require("./queue2-lane-b-runners.cjs");

function locId(volume, page) {
  return `usrep${volume}${String(page).padStart(3, "0")}`;
}

function locUrl(volume, page) {
  return `https://www.loc.gov/item/${locId(volume, page)}/?fo=json`;
}

(async () => {
  let passed = 0;

  // source allowlist
  {
    const url = locUrl(367, 643);
    assert.equal(url, "https://www.loc.gov/item/usrep367643/?fo=json");
    assert.equal(isCourtListenerUrl(url), false);
    assert.equal(assertLaneBUrlAllowed(url), true);
    assert.equal(locId(300, 1), "usrep300001");
    assert.notEqual(locId(367, 643), "usrep3670643");
    passed += 1;
  }

  // CL-domain rejection
  {
    assert.throws(
      () => assertLaneBUrlAllowed("https://www.courtlistener.com/api/rest/v4/opinions/"),
      /LANE_B_CL_BLOCKED/,
    );
    assert.throws(
      () => assertLaneBUrlAllowed("https://www.courtlistener.com/opinion/123/foo/"),
      /LANE_B_CL_BLOCKED/,
    );
    passed += 1;
  }

  // fetch guard
  {
    const g = {
      fetch: async (url) => ({ ok: true, status: 200, url: String(url) }),
    };
    installLaneBFetchGuard(g);
    await assert.rejects(
      () => g.fetch("https://www.courtlistener.com/api/rest/v4/opinions/"),
      /LANE_B_CL_BLOCKED/,
    );
    const ok = await g.fetch(locUrl(411, 792));
    assert.equal(ok.status, 200);
    uninstallLaneBFetchGuard(g);
    passed += 1;
  }

  // citation identity
  {
    const parsed = parseUsReportsCitation("367 U.S. 643");
    assert.equal(parsed.volume, 367);
    assert.equal(parsed.page, 643);
    assert.equal(parsed.citation, "367 U.S. 643");
    assert.equal(parseUsReportsCitation("not a cite"), null);
    assert.equal(parseUsReportsCitation("42 F.3d 100"), null);
    passed += 1;
  }

  // dedupe / already-present
  {
    const ranked = rankMissingUsReports(
      [
        { normalizedCitation: "367 U.S. 643", inbound: 7 },
        { normalizedCitation: "555 U.S. 135", inbound: 7 },
        { normalizedCitation: "367 U.S. 643", inbound: 3 },
      ],
      ["367 U.S. 643"],
    );
    assert.ok(ranked.some((r) => r.citation === "367 U.S. 643" && r.alreadyPresentUnderAlias));
    assert.ok(ranked.some((r) => r.citation === "555 U.S. 135" && !r.alreadyPresentUnderAlias));
    passed += 1;
  }

  // mutation gate default OFF
  {
    delete process.env.QUEUE2_LANE_B_ALLOW_MUTATION;
    const gated = nonClIntake({ allowMutation: false });
    assert.equal(gated.ok, true);
    assert.equal(gated.courtListenerHttpCalls, 0);
    assert.equal(gated.noDelta, true);
    assert.match(String(gated.note), /mutation not enabled/i);
    assert.equal(gated.imported ?? 0, 0);
    passed += 1;
  }

  // allowMutation true still zero CL / no silent ingest in runner stub
  {
    const allowed = nonClIntake({ allowMutation: true });
    assert.equal(allowed.courtListenerHttpCalls, 0);
    assert.equal(allowed.imported ?? 0, 0);
    assert.match(String(allowed.note), /reserved|mutation/i);
    passed += 1;
  }

  console.log(
    JSON.stringify({
      ok: true,
      passed,
      courtListenerHttpCalls: 0,
      mutationEnv: process.env.QUEUE2_LANE_B_ALLOW_MUTATION || null,
      classification: "QUEUE2_US_REPORTS_NON_CL_PREENABLE_TESTS",
    }),
  );
})().catch((e) => {
  console.error(String(e && e.stack ? e.stack : e));
  process.exit(1);
});
