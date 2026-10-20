/**
 * Local currentness audit from curated bundles + optional staging snapshot input.
 * Does not mutate statuses. No CourtListener.
 */
const fs = require("node:fs");
const path = require("node:path");

const bundlesDir = path.join("packages", "research", "corpus", "bundles");
const reportsDir = path.join("packages", "research", "corpus", "reports");

const byType = {};
const byStatus = {};
const byState = {};
let total = 0;
let withUrl = 0;
let withRetrievedAt = 0;
let withCurrentness = 0;

for (const f of fs.readdirSync(bundlesDir).filter((x) => x.endsWith(".json") && x !== "manifest.json")) {
  const arr = JSON.parse(fs.readFileSync(path.join(bundlesDir, f), "utf8"));
  if (!Array.isArray(arr)) continue;
  for (const a of arr) {
    total += 1;
    const t = a.authorityType || "unknown";
    byType[t] = (byType[t] || 0) + 1;
    const st = a.currentnessStatus || "unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;
    const jur = a.authorityState || "?";
    if (!byState[jur]) byState[jur] = { n: 0, currentAsOf: 0, unknown: 0, withUrl: 0 };
    byState[jur].n += 1;
    if (st === "current_as_of_source_date" || st === "current_verified_from_source") {
      byState[jur].currentAsOf += 1;
    } else {
      byState[jur].unknown += 1;
    }
    if (a.canonicalSourceUrl) {
      withUrl += 1;
      byState[jur].withUrl += 1;
    }
    if (a.sourceMetadata?.retrievedAt) withRetrievedAt += 1;
    if (a.currentnessStatus) withCurrentness += 1;
  }
}

const backlog = {
  safelyRefreshable: Object.entries(byState)
    .filter(([, v]) => v.withUrl > 0 && v.currentAsOf > 0)
    .map(([k]) => k)
    .sort(),
  unverifiable: Object.entries(byState)
    .filter(([, v]) => v.unknown === v.n)
    .map(([k]) => k)
    .sort(),
  staleCheckCandidates: Object.entries(byState)
    .filter(([, v]) => v.withUrl > 0)
    .map(([k]) => k)
    .sort(),
  historical: [],
  supersededCandidates: [],
};

const report = {
  generatedAt: new Date().toISOString(),
  wave: "2E",
  scope: "bundle_matrix_currentness_audit",
  note: "Bundle-level audit only. Staging DB counts may differ for CL rows and last_checked_at.",
  totals: {
    authorities: total,
    withCanonicalUrl: withUrl,
    withRetrievedAt,
    withCurrentnessField: withCurrentness,
  },
  byAuthorityType: byType,
  byCurrentnessStatus: byStatus,
  backlog,
};

fs.mkdirSync(reportsDir, { recursive: true });
fs.writeFileSync(
  path.join(reportsDir, "wave2e-currentness-audit.json"),
  `${JSON.stringify(report, null, 2)}\n`,
);

const md = [
  "# Wave 2E — Currentness Audit (bundles)",
  "",
  `Generated: ${report.generatedAt}`,
  `Authorities: ${total}`,
  "",
  "## By status",
  "",
  ...Object.entries(byStatus).map(([k, v]) => `- ${k}: ${v}`),
  "",
  "## By type",
  "",
  ...Object.entries(byType).map(([k, v]) => `- ${k}: ${v}`),
  "",
  `Safely refreshable jurisdictions (URL + current_as_of): ${backlog.safelyRefreshable.length}`,
  `Unverifiable (all unknown in bundle): ${backlog.unverifiable.length}`,
  "",
  "No statuses mutated by this audit.",
  "",
].join("\n");

fs.writeFileSync(path.join(reportsDir, "wave2e-currentness-audit.md"), md);
console.log(JSON.stringify({ ok: true, totals: report.totals, byStatus }, null, 2));
