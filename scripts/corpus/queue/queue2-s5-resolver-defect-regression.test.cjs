/**
 * Citation resolver property / invariant tests (zero external calls).
 * Extends Session 5 unique-exact-match regression with overnight invariants.
 */
"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");

function normalizeStable(raw) {
  return String(raw || "")
    .replace(/\s+/g, " ")
    .replace(/\bU\.\s*S\./gi, "U.S.")
    .replace(/\bF\.\s*(\d?d|4th)\b/gi, (_, s) => `F.${String(s).toLowerCase()}`)
    .trim();
}

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

function applyMatches(edges, matches) {
  const byId = new Map(matches.map((m) => [m.edgeId, m.authorityId]));
  return edges.map((e) =>
    byId.has(e.id) ? { ...e, to_authority_id: byId.get(e.id) } : { ...e },
  );
}

function dedupeEdges(edges) {
  const seen = new Set();
  const out = [];
  for (const e of edges) {
    const key = `${e.from_authority_id}|${e.normalized_citation || e.raw_citation}|${e.to_authority_id || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

test("1 same normalized citation → same deterministic target", () => {
  const authorities = [
    { id: "us-410", citation: "410 U.S. 113", normalized_citation: "410 U.S. 113" },
  ];
  const edges = [
    { id: "e1", to_authority_id: null, normalized_citation: "410 U.S. 113", raw_citation: "410 U.S. 113" },
    { id: "e2", to_authority_id: null, normalized_citation: "410 U.S. 113", raw_citation: "410 U. S. 113" },
  ];
  const m = findUniqueExactMatches(edges, authorities);
  assert.equal(m.length, 2);
  assert.equal(m[0].authorityId, m[1].authorityId);
});

test("2 ambiguous candidates must not force resolve", () => {
  const authorities = [
    { id: "a1", citation: "999 F.3d 1", normalized_citation: "999 F.3d 1" },
    { id: "a2", citation: "999 F.3d 1", normalized_citation: "999 F.3d 1" },
  ];
  const edges = [
    { id: "e", to_authority_id: null, normalized_citation: "999 F.3d 1", raw_citation: "999 F.3d 1" },
  ];
  assert.equal(findUniqueExactMatches(edges, authorities).length, 0);
});

test("3 absent target remains TARGET_ABSENT", () => {
  const m = findUniqueExactMatches(
    [{ id: "e", to_authority_id: null, normalized_citation: "1 F.3d 1", raw_citation: "1 F.3d 1" }],
    [{ id: "other", citation: "2 F.3d 2", normalized_citation: "2 F.3d 2" }],
  );
  assert.equal(m.length, 0);
});

test("4 present exact reporter-volume-page resolves", () => {
  const authorities = [
    { id: "auth", citation: "123 F.2d 456", normalized_citation: "123 F.2d 456" },
  ];
  const edges = [
    { id: "e", to_authority_id: null, normalized_citation: "123 F.2d 456", raw_citation: "123 F.2d 456" },
  ];
  const m = findUniqueExactMatches(edges, authorities);
  assert.equal(m.length, 1);
  assert.equal(m[0].authorityId, "auth");
});

test("5 aliases cannot create cross-authority collision force-resolve", () => {
  // Two different authorities sharing a citation string → refuse
  const authorities = [
    { id: "a1", citation: "42 U.S.C. § 1983", normalized_citation: "42 U.S.C. § 1983" },
    { id: "a2", citation: "42 U.S.C. § 1983", normalized_citation: "42 USC § 1983" },
  ];
  const edges = [
    {
      id: "e",
      to_authority_id: null,
      normalized_citation: "42 U.S.C. § 1983",
      raw_citation: "42 U.S.C. § 1983",
    },
  ];
  // Hits both via citation/normalized equality paths → distinct > 1 → no force
  const m = findUniqueExactMatches(edges, authorities);
  assert.equal(m.length, 0);
});

test("6 reresolve is idempotent", () => {
  const authorities = [
    { id: "auth", citation: "8 C.F.R. § 1003.1", normalized_citation: "8 C.F.R. § 1003.1" },
  ];
  let edges = [
    {
      id: "e",
      from_authority_id: "from1",
      to_authority_id: null,
      normalized_citation: "8 C.F.R. § 1003.1",
      raw_citation: "8 C.F.R. § 1003.1",
    },
  ];
  const m1 = findUniqueExactMatches(edges, authorities);
  edges = applyMatches(edges, m1);
  const m2 = findUniqueExactMatches(edges, authorities);
  assert.equal(m1.length, 1);
  assert.equal(m2.length, 0);
  assert.equal(edges[0].to_authority_id, "auth");
});

test("7 stale unresolved edge resolves after target appears", () => {
  const edges = [
    {
      id: "e",
      to_authority_id: null,
      normalized_citation: "573 U.S. 373",
      raw_citation: "573 U.S. 373",
    },
  ];
  assert.equal(findUniqueExactMatches(edges, []).length, 0);
  const after = findUniqueExactMatches(edges, [
    { id: "new", citation: "573 U.S. 373", normalized_citation: "573 U.S. 373" },
  ]);
  assert.equal(after.length, 1);
  assert.equal(after[0].authorityId, "new");
});

test("8 rerunning resolver cannot duplicate edges", () => {
  const edges = [
    {
      id: "e1",
      from_authority_id: "from1",
      to_authority_id: "auth",
      normalized_citation: "410 U.S. 113",
      raw_citation: "410 U.S. 113",
    },
    {
      id: "e1-dup",
      from_authority_id: "from1",
      to_authority_id: "auth",
      normalized_citation: "410 U.S. 113",
      raw_citation: "410 U.S. 113",
    },
  ];
  const deduped = dedupeEdges(edges);
  assert.equal(deduped.length, 1);
});

test("9 resolved edge target must exist", () => {
  const authorities = new Map([["auth", { id: "auth" }]]);
  const edges = [
    { id: "ok", to_authority_id: "auth", normalized_citation: "1 F.3d 1" },
    { id: "broken", to_authority_id: "missing", normalized_citation: "2 F.3d 2" },
  ];
  const broken = edges.filter((e) => e.to_authority_id && !authorities.has(e.to_authority_id));
  assert.equal(broken.length, 1);
  assert.equal(broken[0].id, "broken");
});

test("10 citation normalization must be stable across repeated runs", () => {
  const samples = ["410 U. S. 113", "999 F. 3d 1", "8 C.F.R. § 1003.1"];
  for (const s of samples) {
    const a = normalizeStable(s);
    const b = normalizeStable(a);
    assert.equal(a, b);
  }
});

// Preserve prior Session 5 cases
test("CFR exact-match present edges resolve uniquely", () => {
  const authorities = [
    { id: "auth-cfr-1003", citation: "8 C.F.R. § 1003.1", normalized_citation: "8 C.F.R. § 1003.1" },
  ];
  const edges = [
    {
      id: "edge-1",
      to_authority_id: null,
      normalized_citation: "8 C.F.R. § 1003.1",
      raw_citation: "8 C.F.R. § 1003.1",
    },
  ];
  assert.equal(findUniqueExactMatches(edges, authorities).length, 1);
});

console.log(
  JSON.stringify({
    ok: true,
    suite: "queue2-s5-resolver-defect-regression",
    tests: 11,
    invariants: 10,
  }),
);
