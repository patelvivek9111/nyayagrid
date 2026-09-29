/** Dump one CL search hit shape for hist discovery debugging. */
"use strict";
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  const court = process.argv[2] || "ca5";
  const gte = process.argv[3] || "1995-01-01";
  const lte = process.argv[4] || "1999-12-31";
  const params = new URLSearchParams({
    type: "o",
    court,
    order_by: "dateFiled asc",
    page_size: "2",
    filed_after: gte,
    filed_before: lte,
  });
  const res = await fetch(`${CL_BASE}/search/?${params}`, {
    headers: { Authorization: `Token ${key}`, Accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.json();
  const first = (body.results || [])[0] || null;
  console.log(
    JSON.stringify({
      ok: res.ok,
      status: res.status,
      count: body.count,
      resultLen: (body.results || []).length,
      firstKeys: first ? Object.keys(first) : [],
      firstSample: first
        ? {
            id: first.id,
            cluster_id: first.cluster_id,
            absolute_url: first.absolute_url,
            dateFiled: first.dateFiled,
            caseName: first.caseName,
            opinions: first.opinions,
          }
        : null,
      courtListenerHttpCalls: 1,
    }),
  );
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e) }));
  process.exit(1);
});
