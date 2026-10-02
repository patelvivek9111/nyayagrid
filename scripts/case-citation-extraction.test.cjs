/**
 * Unit tests for shared case citation extraction (no DB, no network).
 */
"use strict";

const assert = require("node:assert/strict");
const {
  extractCaseCitationsFromText,
  looksCitationLike,
  sha256Text,
  normalizeCitation,
  CITATION_EXTRACTION_VERSION,
  buildExtractionMeta,
} = require("./lib/case-citation-extraction.cjs");

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`not ok - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

test("extracts U.S. and F.3d citations from opinion-like text", () => {
  const text = `
    Relying on Brown v. Board, 347 U.S. 483 (1954), and later Circuit precedent
    in Smith, 503 F.3d 284 (5th Cir. 2007), the court also cited Fed. R. Civ. P. 12
    and 28 U.S.C. § 1331. See also 42 C.F.R. § 100.1.
  `;
  const cites = extractCaseCitationsFromText(text);
  const norms = cites.map((c) => c.normalized);
  assert.ok(norms.some((n) => /347 U\.S\. 483/i.test(n)));
  assert.ok(norms.some((n) => /503 F\.3d 284/i.test(n)));
  assert.ok(norms.some((n) => /Fed\. R\. Civ\. P\. 12/i.test(n)));
  assert.ok(norms.some((n) => /28 U\.S\.C\./i.test(n)));
  assert.ok(norms.some((n) => /42 C\.F\.R\./i.test(n)));
});

test("PROCESSED_ZERO: citation-free legal prose yields zero citations", () => {
  const text =
    "This order grants the motion for enlargement of time. The parties shall confer and file a joint status report.";
  const cites = extractCaseCitationsFromText(text);
  assert.equal(cites.length, 0);
  assert.equal(looksCitationLike(text), false);
});

test("idempotent normalize + extract does not duplicate within text", () => {
  const text = "See 347 U.S. 483; again 347 U.S. 483.";
  const cites = extractCaseCitationsFromText(text);
  const us = cites.filter((c) => /347 U\.S\. 483/i.test(c.normalized));
  assert.equal(us.length, 1);
});

test("text hash changes when content changes", () => {
  const a = sha256Text("alpha opinion body with 347 U.S. 483");
  const b = sha256Text("alpha opinion body with 347 U.S. 483 revised");
  assert.notEqual(a, b);
});

test("buildExtractionMeta marks PROCESSED_ZERO", () => {
  const meta = buildExtractionMeta({
    status: "PROCESSED_ZERO",
    textHash: sha256Text("x"),
    occurrenceCount: 0,
  });
  assert.equal(meta.citationExtraction.status, "PROCESSED_ZERO");
  assert.equal(meta.citationExtraction.version, CITATION_EXTRACTION_VERSION);
  assert.equal(meta.citationExtraction.occurrenceCount, 0);
});

test("normalizeCitation collapses U. S. spacing", () => {
  assert.match(normalizeCitation("347 U. S. 483"), /347 U\.S\. 483/);
});

test("extracts regional reporters and state neutral citations", () => {
  const text = `
    See State v. Smith, 149 N.H. 31 (2003); also 843 S.W.2d 412.
    Neutral cites: 2026 ND 26 and 1999 ND 151; cf. 2026 OK 65.
  `;
  const cites = extractCaseCitationsFromText(text);
  const norms = cites.map((c) => c.normalized);
  assert.ok(norms.some((n) => /149 N\.H\. 31/i.test(n)));
  assert.ok(norms.some((n) => /843 S\.W\.?2d 412/i.test(n)));
  assert.ok(norms.some((n) => /2026 ND 26/.test(n)));
  assert.ok(norms.some((n) => /2026 OK 65/.test(n)));
});


console.log(
  JSON.stringify({
    ok: process.exitCode !== 1,
    suite: "case-citation-extraction",
    courtListenerHttpCalls: 0,
  }),
);
