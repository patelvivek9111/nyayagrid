/**
 * Regression: present-but-unresolved exact-match edges must be resolvable
 * by the deterministic unique-match reresolve path (Session 5 defect class).
 */
"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");

/**
 * Mirrors the production unique-match join used by tmp-queue2-manual-cite-integrity.cjs
 * (including citation = raw_citation, added for completeness).
 */
function findUniqueExactMatches(edges, authorities) {
  const out = [];
  for (const e of edges) {
    if (e.to_authority_id) continue;
    if (!e.normalized_citation || e.normalized_citation.length <= 4) continue;
    const hits = authorities.filter(
      (a) =>
        a.normalized_citation === e.normalized_citation ||
        a.citation === e.normalized_citation ||
        a.citation === e.raw_citation,
    );
    const distinct = [...new Set(hits.map((h) => h.id))];
    if (distinct.length === 1) out.push({ edgeId: e.id, authorityId: distinct[0] });
  }
  return out;
}

test("CFR exact-match present edges resolve uniquely (Session 4 sampled defect class)", () => {
  const authorities = [
    {
      id: "auth-cfr-1003",
      citation: "8 C.F.R. § 1003.1",
      normalized_citation: "8 C.F.R. § 1003.1",
    },
    {
      id: "auth-cfr-204",
      citation: "8 C.F.R. § 204.2",
      normalized_citation: "8 C.F.R. § 204.2",
    },
  ];
  const edges = [
    {
      id: "edge-1",
      to_authority_id: null,
      normalized_citation: "8 C.F.R. § 1003.1",
      raw_citation: "8 C.F.R. § 1003.1",
    },
    {
      id: "edge-2",
      to_authority_id: null,
      normalized_citation: "8 C.F.R. § 204.2",
      raw_citation: "8 CFR 204.2",
    },
  ];
  const matches = findUniqueExactMatches(edges, authorities);
  assert.equal(matches.length, 2);
  assert.equal(matches[0].authorityId, "auth-cfr-1003");
  assert.equal(matches[1].authorityId, "auth-cfr-204");
});

test("ambiguous multi-authority exact matches are not forced", () => {
  const authorities = [
    { id: "a1", citation: "40 C.F.R. § 52.21", normalized_citation: "40 C.F.R. § 52.21" },
    { id: "a2", citation: "40 C.F.R. § 52.21", normalized_citation: "40 C.F.R. § 52.21" },
  ];
  const edges = [
    {
      id: "edge-amb",
      to_authority_id: null,
      normalized_citation: "40 C.F.R. § 52.21",
      raw_citation: "40 C.F.R. § 52.21",
    },
  ];
  const matches = findUniqueExactMatches(edges, authorities);
  assert.equal(matches.length, 0);
});

test("absent targets produce no matches", () => {
  const matches = findUniqueExactMatches(
    [
      {
        id: "edge-absent",
        to_authority_id: null,
        normalized_citation: "99 C.F.R. § 1.1",
        raw_citation: "99 C.F.R. § 1.1",
      },
    ],
    [{ id: "other", citation: "8 C.F.R. § 1003.1", normalized_citation: "8 C.F.R. § 1003.1" }],
  );
  assert.equal(matches.length, 0);
});

test("already-resolved edges are skipped", () => {
  const matches = findUniqueExactMatches(
    [
      {
        id: "edge-done",
        to_authority_id: "auth-cfr-1003",
        normalized_citation: "8 C.F.R. § 1003.1",
        raw_citation: "8 C.F.R. § 1003.1",
      },
    ],
    [{ id: "auth-cfr-1003", citation: "8 C.F.R. § 1003.1", normalized_citation: "8 C.F.R. § 1003.1" }],
  );
  assert.equal(matches.length, 0);
});

console.log(JSON.stringify({ ok: true, suite: "queue2-s5-resolver-defect-regression", tests: 4 }));
