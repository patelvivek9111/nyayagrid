"use strict";
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
async function main() {
  const key = process.env.COURTLISTENER_API_KEY;
  const id = "indctapp";
  const out = { id, courtListenerHttpCalls: 0 };
  await new Promise((r) => setTimeout(r, 1500));
  try {
    const url = `${CL_BASE}/search/?type=o&court=${id}&page_size=3&order_by=dateFiled desc`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    out.courtListenerHttpCalls += 1;
    out.searchHttp = res.status;
    const body = await res.json();
    const hits = body.results || [];
    out.searchCount = hits.length;
    out.samples = hits.slice(0, 3).map((h) => ({
      dateFiled: h.dateFiled || h.date_filed,
      caseName: h.caseName || h.case_name,
      opId: h.opinions?.[0]?.id ?? h.id,
      snippetLen: String(h.opinions?.[0]?.snippet || "").length,
    }));
  } catch (e) {
    out.searchError = String(e.message || e).slice(0, 120);
  }
  // earliest via search asc
  await new Promise((r) => setTimeout(r, 2200));
  try {
    const url = `${CL_BASE}/search/?type=o&court=${id}&page_size=1&order_by=dateFiled asc`;
    const res = await fetch(url, {
      headers: { Authorization: `Token ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    out.courtListenerHttpCalls += 1;
    const body = await res.json();
    const h = (body.results || [])[0];
    out.earliest = h ? { dateFiled: h.dateFiled || h.date_filed, caseName: h.caseName || h.case_name } : null;
  } catch (e) {
    out.earliestError = String(e.message || e).slice(0, 120);
  }
  const usable = out.searchCount > 0;
  out.mappingStatus = usable ? "VERIFIED" : out.searchError ? "AMBIGUOUS" : "UNAVAILABLE";
  out.fullName = "Indiana Court of Appeals";
  out.jurisdiction = "SA";
  console.log(JSON.stringify(out));
}
main();
