/**
 * Resolve Wave-1 CourtListener court ids via /courts/ metadata (no guessing).
 * Usage on Fly: CL_COURT_PROBE=1 node staging-cl-court-map-probe-bundled.cjs
 */
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

const WANTED = [
  { state: "CA", roles: ["high", "appellate"], needles: ["supreme court of california", "court of appeal"] },
  { state: "DE", roles: ["high"], needles: ["supreme court of delaware"] },
  { state: "FL", roles: ["high", "appellate"], needles: ["supreme court of florida", "district court of appeal"] },
  { state: "IL", roles: ["high", "appellate"], needles: ["supreme court of illinois", "appellate court of illinois"] },
  { state: "MA", roles: ["high", "appellate"], needles: ["supreme judicial court", "appeals court"] },
  { state: "NJ", roles: ["high", "appellate"], needles: ["supreme court of new jersey", "appellate division"] },
  { state: "NY", roles: ["high", "appellate"], needles: ["court of appeals", "appellate division"] },
  { state: "PA", roles: ["high", "appellate", "appellate"], needles: ["supreme court of pennsylvania", "superior court of pennsylvania", "commonwealth court"] },
  { state: "TX", roles: ["high", "high", "appellate"], needles: ["supreme court of texas", "court of criminal appeals", "court of appeals"] },
  { state: "VA", roles: ["high", "appellate"], needles: ["supreme court of virginia", "court of appeals of virginia"] },
];

const ASSUMED = {
  cal: "st-ca-high",
  calctapp: "st-ca-app",
  del: "st-de-high",
  fla: "st-fl-high",
  fladistctapp: "st-fl-app",
  ill: "st-il-high",
  illappct: "st-il-app",
  mass: "st-ma-high",
  massappct: "st-ma-app",
  nj: "st-nj-high",
  njsuperct: "st-nj-app",
  ny: "st-ny-high",
  nyappdiv: "st-ny-app",
  pa: "st-pa-high",
  pasuperct: "st-pa-super",
  pacommwlth: "st-pa-comm",
  tex: "st-tx-high",
  texcrimapp: "st-tx-crim",
  texapp: "st-tx-app",
  va: "st-va-high",
  vacapp: "st-va-app",
};

async function main() {
  const key = process.env.COURTLISTENER_API_KEY?.trim();
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  const rateMs = Math.max(Number.parseInt(process.env.CL_RATE_MS ?? "800", 10) || 800, 400);
  const courts = [];
  let url = `${CL_BASE}/courts/?page_size=100`;
  let pages = 0;
  while (url && pages < 40) {
    pages += 1;
    await new Promise((r) => setTimeout(r, rateMs));
    const res = await fetch(url, {
      headers: { Authorization: `Token ${key}`, Accept: "application/json" },
    });
    if (res.status === 429) {
      console.log(
        JSON.stringify({
          ok: true,
          status: "rate_limited",
          retryAfter: res.headers.get("retry-after"),
          pages,
          courtsSoFar: courts.length,
        }),
      );
      process.exit(0);
    }
    if (!res.ok) {
      console.log(JSON.stringify({ ok: false, reason: `courts_http_${res.status}`, pages }));
      process.exit(1);
    }
    const body = await res.json();
    for (const c of body.results || []) {
      courts.push({
        id: c.id,
        name: c.full_name || c.short_name || c.name || "",
        jurisdiction: c.jurisdiction || null,
        in_use: c.in_use,
      });
    }
    url = body.next || null;
  }

  const matches = [];
  const unmatched = [];
  for (const want of WANTED) {
    for (const needle of want.needles) {
      const found = courts.filter(
        (c) =>
          String(c.name).toLowerCase().includes(needle) &&
          (want.state === "MA" ||
            want.state === "NY" ||
            String(c.jurisdiction || "").toLowerCase().includes(want.state.toLowerCase()) ||
            String(c.id).toLowerCase().startsWith(want.state.toLowerCase().slice(0, 2)) ||
            true),
      );
      const top = found.slice(0, 5).map((c) => ({ id: c.id, name: c.name, jurisdiction: c.jurisdiction }));
      if (top.length === 0) unmatched.push({ state: want.state, needle });
      else matches.push({ state: want.state, needle, candidates: top });
    }
  }

  const assumedValidated = [];
  for (const [clId, nyayaId] of Object.entries(ASSUMED)) {
    const hit = courts.find((c) => String(c.id).toLowerCase() === clId);
    assumedValidated.push({
      clCourt: clId,
      nyayaCourtId: nyayaId,
      found: Boolean(hit),
      name: hit?.name ?? null,
      jurisdiction: hit?.jurisdiction ?? null,
    });
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        courtsFetched: courts.length,
        pages,
        assumedValidated,
        missingAssumed: assumedValidated.filter((a) => !a.found),
        matches: matches.slice(0, 80),
        unmatched,
        featureAgents: process.env.FEATURE_AGENTS ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 400) }));
  process.exit(1);
});
