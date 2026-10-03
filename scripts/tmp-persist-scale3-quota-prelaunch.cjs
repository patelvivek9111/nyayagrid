"use strict";
const fs = require("fs");
const rawPath = "packages/research/corpus/reports/queue2-cite-demand-scale3-quota-prelaunch-raw.txt";
const b = fs.readFileSync(rawPath);
const t = (b[0] === 0xff && b[1] === 0xfe ? b.toString("utf16le") : b.toString("utf8")).replace(/^\uFEFF/, "");
const marker = '{"ok":true';
const i = t.lastIndexOf(marker);
if (i < 0) throw new Error("no json");
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
const hour = Number(j.limits.hour.remaining);
const day = Number(j.limits.day.remaining);
const safe = Math.min(100, Math.max(0, hour - 25), Math.max(0, day - 50));
const q = {
  ok: true,
  classification: "CITATION_DEMAND_ADAPTIVE_SCALE_3_QUOTA_PRELAUNCH",
  generatedAt: new Date().toISOString(),
  limits: j.limits,
  membership: j.membership,
  hourFloor: 25,
  dayFloor: 50,
  preferred: 100,
  safeBudget: safe,
  pacingMs: 5000,
  courtListenerHttpCalls: 1,
};
fs.writeFileSync(
  "packages/research/corpus/reports/queue2-cite-demand-scale3-quota-prelaunch.json",
  JSON.stringify(q, null, 2),
);
console.log(JSON.stringify(q, null, 2));
