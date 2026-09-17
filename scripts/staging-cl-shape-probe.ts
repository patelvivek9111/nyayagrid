/**
 * Dump CourtListener search hit keys only (no opinion text, no API key).
 * Env: COURTLISTENER_API_KEY, CL_COURT (default scotus)
 */
async function main() {
  const key = process.env.COURTLISTENER_API_KEY?.trim();
  if (!key) {
    console.log(JSON.stringify({ ok: false, reason: "missing_key" }));
    process.exit(2);
  }
  const court = process.env.CL_COURT?.trim() || "scotus";
  const urls = [
    `https://www.courtlistener.com/api/rest/v4/search/?type=o&q=*&court=${encodeURIComponent(court)}&order_by=dateFiled%20desc&page_size=2`,
    `https://www.courtlistener.com/api/rest/v4/opinions/?cluster__docket__court=${encodeURIComponent(court)}&order_by=-id&page_size=2`,
  ];
  const out = [];
  for (const url of urls) {
    const res = await fetch(url, {
      headers: { Authorization: `Token ${key}`, Accept: "application/json" },
    });
    const body = (await res.json()) as {
      results?: Array<Record<string, unknown>>;
      count?: number;
      detail?: string;
    };
    const first = body.results?.[0] ?? null;
    out.push({
      url: url.replace(/Token [^"]+/, "Token ***"),
      status: res.status,
      count: body.count ?? body.results?.length ?? null,
      detail: body.detail ?? null,
      firstKeys: first ? Object.keys(first).sort() : [],
      id: first?.id ?? null,
      cluster_id: first?.cluster_id ?? null,
      opinion_id: first?.opinion_id ?? null,
      absolute_url: first?.absolute_url ?? null,
      caseName: first?.caseName ?? first?.case_name ?? null,
      court_id: first?.court_id ?? first?.court ?? null,
      dateFiled: first?.dateFiled ?? first?.date_filed ?? null,
      citation: first?.citation ?? null,
    });
  }
  console.log(JSON.stringify({ ok: true, featureAgents: process.env.FEATURE_AGENTS ?? null, probes: out }, null, 2));
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message ?? e).slice(0, 300) }));
  process.exit(1);
});
