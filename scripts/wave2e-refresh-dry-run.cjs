/**
 * Wave 2E refresh dry-run against official URLs (no CL, no DB writes).
 * Uses curated bundle canonical URLs for a bounded sample.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

function contentHash(text) {
  return createHash("sha256")
    .update(text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim(), "utf8")
    .digest("hex");
}

async function check(url, priorHash) {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
      headers: { "User-Agent": "NyayaGridCorpusRefresh/1.0", Accept: "text/html,*/*" },
    });
    if (res.status === 429) return { outcome: "rate_limited", httpStatus: 429 };
    if (!res.ok) return { outcome: res.status >= 500 ? "failed" : "unavailable", httpStatus: res.status };
    const body = await res.text();
    const hash = contentHash(body);
    const etag = res.headers.get("etag");
    const lastModified = res.headers.get("last-modified");
    return {
      outcome: priorHash && priorHash === hash ? "unchanged" : priorHash ? "changed" : "fetched",
      httpStatus: res.status,
      hash,
      etag,
      lastModified,
      bytes: body.length,
    };
  } catch (e) {
    return { outcome: "failed", error: String(e.message || e).slice(0, 200) };
  }
}

async function main() {
  const bundlesDir = path.join("packages", "research", "corpus", "bundles");
  const targets = [];

  // Prefer live-refreshable official sources: eCFR + a few state regs/rules with URLs.
  for (const f of [
    "expansion-wave2c-cfr.json",
    "expansion-wave2d-state-regs.json",
    "expansion-wave2e-state-regs.json",
    "expansion-federal-rules.json",
  ]) {
    const p = path.join(bundlesDir, f);
    if (!fs.existsSync(p)) continue;
    const arr = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const a of arr) {
      if (!a.canonicalSourceUrl || !a.sourceExternalId) continue;
      targets.push({
        id: a.sourceExternalId,
        url: a.canonicalSourceUrl,
        type: a.authorityType,
        state: a.authorityState,
        file: f,
      });
    }
  }

  // Bounded: 3 eCFR + 4 state regs + 2 federal rules
  const sample = [
    ...targets.filter((t) => t.file.includes("cfr")).slice(0, 3),
    ...targets.filter((t) => t.file.includes("state-regs")).slice(0, 4),
    ...targets.filter((t) => t.file.includes("federal-rules")).slice(0, 2),
  ];

  const results = [];
  for (const t of sample) {
    const r = await check(t.url, null);
    results.push({ ...t, ...r });
    await new Promise((r) => setTimeout(r, 400));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    wave: "2E",
    note: "Dry-run HTTP checks only; no corpus mutation; no CourtListener.",
    attempted: results.length,
    fetched: results.filter((r) => r.outcome === "fetched").length,
    unchanged: results.filter((r) => r.outcome === "unchanged").length,
    changed: results.filter((r) => r.outcome === "changed").length,
    unavailable: results.filter((r) => r.outcome === "unavailable").length,
    failed: results.filter((r) => r.outcome === "failed").length,
    rateLimited: results.filter((r) => r.outcome === "rate_limited").length,
    results: results.map(({ id, url, type, state, outcome, httpStatus, bytes, error }) => ({
      id,
      url,
      type,
      state,
      outcome,
      httpStatus,
      bytes,
      error,
    })),
  };

  const out = path.join("packages", "research", "corpus", "reports", "wave2e-refresh-dry-run.json");
  fs.writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify({ ok: true, ...summary, results: undefined, sampleIds: results.map((r) => r.id) }, null, 2));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e) }));
  process.exit(1);
});
