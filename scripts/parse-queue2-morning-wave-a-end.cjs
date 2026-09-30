#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const rawPath = path.join(__dirname, "..", "packages/research/corpus/reports/queue2-morning-wave-a-end-raw.txt");
const reports = path.join(__dirname, "..", "packages/research/corpus/reports");
let t = fs.readFileSync(rawPath, "utf8");
if (t.charCodeAt(0) === 0xfeff) t = t.slice(1);
// strip utf16-ish nulls if present
t = t.replace(/\u0000/g, "");
let j = null;
const marker = '"classification":"OVERNIGHT_ZERO_QUOTA_WAVE_A"';
const idx = t.lastIndexOf(marker);
if (idx >= 0) {
  let start = t.lastIndexOf("{", idx);
  let depth = 0;
  for (let k = start; k < t.length; k++) {
    if (t[k] === "{") depth++;
    else if (t[k] === "}") {
      depth--;
      if (depth === 0) {
        try {
          j = JSON.parse(t.slice(start, k + 1));
        } catch (e) {
          console.error("parse", e.message);
        }
        break;
      }
    }
  }
}
if (!j || !j.ok) {
  // fallback: lastJson
  const lines = t.split(/\n/).map((l) => l.trim()).filter((l) => l.startsWith("{"));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const cand = JSON.parse(lines[i]);
      if (cand.ok && cand.tracker) {
        j = cand;
        break;
      }
    } catch {
      /* */
    }
  }
}
if (!j || !j.ok) {
  console.log(JSON.stringify({ ok: false, reason: "parse_fail", head: t.slice(0, 200) }));
  process.exit(1);
}
fs.writeFileSync(path.join(reports, "queue2-morning-wave-a-end.json"), JSON.stringify(j, null, 2));
fs.writeFileSync(path.join(reports, "queue2-balanced-10k-tracker.json"), JSON.stringify(j.tracker, null, 2));
fs.writeFileSync(
  path.join(reports, "queue2-integrity-full-pass.json"),
  JSON.stringify(
    {
      classification: "QUEUE2_INTEGRITY_FULL_PASS",
      generatedAt: j.generatedAt,
      courtListenerHttpCalls: 0,
      mutations: 0,
      ...j.integrity,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify(
    {
      ok: true,
      cases: j.tracker.progress.casesCurrent,
      state: j.tracker.progress.stateDcCurrent,
      federal: j.tracker.progress.federalCurrent,
      cites: j.tracker.baseline.citations,
      integrity: {
        dupes: j.integrity.duplicateSourceIdentities,
        orphans: j.integrity.orphanChunks,
        missEmb: j.integrity.missingEmbeddings,
        citeDups: j.integrity.duplicateCitationEdges,
      },
    },
    null,
    2,
  ),
);
