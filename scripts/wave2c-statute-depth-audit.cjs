/**
 * Wave 2C — per-jurisdiction statute depth audit from curated bundles.
 * Excludes synthetic/bench fixtures. Does not query staging DB.
 */
const fs = require("node:fs");
const path = require("node:path");

const bundlesDir = path.join("packages", "research", "corpus", "bundles");
const reportsDir = path.join("packages", "research", "corpus", "reports");
const ALL = [
  "US",
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "DC",
];

const byJur = Object.fromEntries(
  ALL.map((j) => [
    j,
    { statutes: 0, regs: 0, rules: 0, cases: 0, constitutions: 0, authorities: 0, citations: [] },
  ]),
);

let total = 0;
for (const f of fs.readdirSync(bundlesDir).filter((x) => x.endsWith(".json") && x !== "manifest.json")) {
  const arr = JSON.parse(fs.readFileSync(path.join(bundlesDir, f), "utf8"));
  if (!Array.isArray(arr)) continue;
  for (const a of arr) {
    if (a.sourceProvider && /synthetic|bench|fixture/i.test(String(a.sourceProvider))) continue;
    const j = String(a.authorityState || "US").toUpperCase();
    if (!byJur[j]) {
      byJur[j] = {
        statutes: 0,
        regs: 0,
        rules: 0,
        cases: 0,
        constitutions: 0,
        authorities: 0,
        citations: [],
      };
    }
    byJur[j].authorities += 1;
    total += 1;
    const t = a.authorityType;
    if (t === "statute") {
      byJur[j].statutes += 1;
      if (byJur[j].citations.length < 8 && a.citation) byJur[j].citations.push(a.citation);
    } else if (t === "regulation") byJur[j].regs += 1;
    else if (t === "rule") byJur[j].rules += 1;
    else if (t === "case") byJur[j].cases += 1;
    else if (t === "constitution") byJur[j].constitutions += 1;
  }
}

function bucket(n) {
  if (n === 0) return "0";
  if (n <= 3) return "1-3";
  if (n <= 10) return "4-10";
  return "deeper";
}

const jurisdictions = ALL.map((code) => ({
  jurisdiction: code,
  statuteCount: byJur[code]?.statutes || 0,
  regulationCount: byJur[code]?.regs || 0,
  ruleCount: byJur[code]?.rules || 0,
  caseCount: byJur[code]?.cases || 0,
  constitutionCount: byJur[code]?.constitutions || 0,
  authorityCount: byJur[code]?.authorities || 0,
  statuteDepthBucket: bucket(byJur[code]?.statutes || 0),
  sampleStatuteCitations: byJur[code]?.citations || [],
}));

const summary = {
  generatedAt: new Date().toISOString(),
  wave: "2C",
  bundleAuthorityTotal: total,
  statuteDepthBuckets: {
    zero: jurisdictions.filter((j) => j.statuteDepthBucket === "0").map((j) => j.jurisdiction),
    oneToThree: jurisdictions.filter((j) => j.statuteDepthBucket === "1-3").map((j) => j.jurisdiction),
    fourToTen: jurisdictions.filter((j) => j.statuteDepthBucket === "4-10").map((j) => j.jurisdiction),
    deeper: jurisdictions.filter((j) => j.statuteDepthBucket === "deeper").map((j) => j.jurisdiction),
  },
  typeTotals: {
    statutes: jurisdictions.reduce((s, j) => s + j.statuteCount, 0),
    regulations: jurisdictions.reduce((s, j) => s + j.regulationCount, 0),
    rules: jurisdictions.reduce((s, j) => s + j.ruleCount, 0),
    cases: jurisdictions.reduce((s, j) => s + j.caseCount, 0),
  },
  jurisdictions,
};

fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(
  path.join(reportsDir, "wave2c-statute-depth-audit.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);

const md = [
  "# Wave 2C — Statute Depth Audit",
  "",
  `Generated: ${summary.generatedAt}`,
  `Bundle authorities (real curated): ${total}`,
  "",
  "## Statute depth buckets",
  "",
  "| Bucket | Jurisdictions | Count |",
  "|---|---|---:|",
  `| 0 | ${summary.statuteDepthBuckets.zero.join(", ") || "—"} | ${summary.statuteDepthBuckets.zero.length} |`,
  `| 1–3 | ${summary.statuteDepthBuckets.oneToThree.join(", ") || "—"} | ${summary.statuteDepthBuckets.oneToThree.length} |`,
  `| 4–10 | ${summary.statuteDepthBuckets.fourToTen.join(", ") || "—"} | ${summary.statuteDepthBuckets.fourToTen.length} |`,
  `| deeper (>10) | ${summary.statuteDepthBuckets.deeper.join(", ") || "—"} | ${summary.statuteDepthBuckets.deeper.length} |`,
  "",
  "## Per-jurisdiction statute counts",
  "",
  "| Code | Statutes | Regs | Rules | Cases | Total |",
  "|---|---:|---:|---:|---:|---:|",
  ...jurisdictions.map(
    (j) =>
      `| ${j.jurisdiction} | ${j.statuteCount} | ${j.regulationCount} | ${j.ruleCount} | ${j.caseCount} | ${j.authorityCount} |`,
  ),
  "",
  "Synthetic fixtures excluded. Bundle-matrix only (staging live may include CourtListener cases).",
  "",
].join("\n");

fs.writeFileSync(path.join(reportsDir, "wave2c-statute-depth-audit.md"), md);
console.log(
  JSON.stringify(
    {
      total,
      buckets: {
        zero: summary.statuteDepthBuckets.zero.length,
        oneToThree: summary.statuteDepthBuckets.oneToThree.length,
        fourToTen: summary.statuteDepthBuckets.fourToTen.length,
        deeper: summary.statuteDepthBuckets.deeper.length,
      },
      types: summary.typeTotals,
    },
    null,
    2,
  ),
);
