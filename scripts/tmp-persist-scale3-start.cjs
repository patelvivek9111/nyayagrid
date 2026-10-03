"use strict";
const fs = require("fs");
const path = "packages/research/corpus/reports/queue2-cite-demand-scale3-start-raw.txt";
const t = fs.readFileSync(path, "utf8");
const marker = '{"ok":true';
const i = t.lastIndexOf(marker);
if (i < 0) {
  console.error("no json");
  process.exit(2);
}
let d = 0;
let j = null;
for (let k = i; k < t.length; k++) {
  if (t[k] === "{") d++;
  else if (t[k] === "}") {
    d--;
    if (d === 0) {
      j = JSON.parse(t.slice(i, k + 1));
      break;
    }
  }
}
if (!j) {
  console.error("parse fail");
  process.exit(2);
}
fs.writeFileSync(
  "packages/research/corpus/reports/queue2-cite-demand-scale3-start.json",
  JSON.stringify(j, null, 2),
);
console.log(JSON.stringify({
  cases: j.corpus?.cases,
  extracted: j.extracted,
  resolved: j.resolvedAfter,
  unresolved: j.targetAbsent,
  resolutionPct: +((j.resolvedAfter / j.extracted) * 100).toFixed(2),
  remainingTo10: Math.ceil(0.1 * j.extracted) - j.resolvedAfter,
  dups: j.duplicateSourceIds,
  orphans: j.orphans,
  missing: j.chunks?.missing_embeddings,
}, null, 2));
