/**
 * Federal circuit retrieval smoke — DB only, ZERO CourtListener HTTP.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const circuits = [
      "us-scotus",
      "us-ca-1", "us-ca-2", "us-ca-3", "us-ca-4", "us-ca-5", "us-ca-6",
      "us-ca-7", "us-ca-8", "us-ca-9", "us-ca-10", "us-ca-11", "us-ca-dc", "us-ca-fed",
    ];
    const counts = await sql`
      select court_id, count(*)::int as n
      from legal_authorities
      where source_provider = 'courtlistener'
        and court_id = any(${circuits})
      group by court_id
    `;
    const byId = Object.fromEntries(counts.map((r) => [r.court_id, r.n]));
    const represented = circuits.map((id) => ({ court_id: id, n: byId[id] || 0, present: (byId[id] || 0) > 0 }));
    const missing = represented.filter((r) => !r.present).map((r) => r.court_id);

    // Isolation: query by court_id should not return other circuits
    const isolation = [];
    for (const id of ["us-scotus", "us-ca-7", "us-ca-9", "us-ca-fed"]) {
      const rows = await sql`
        select court_id, count(*)::int as n
        from legal_authorities
        where source_provider = 'courtlistener' and court_id = ${id}
        group by court_id
      `;
      const bleed = rows.some((r) => r.court_id !== id);
      isolation.push({ filter: id, hits: rows[0]?.n || 0, bleed, status: !bleed && (rows[0]?.n || 0) > 0 ? "PASS" : "FAIL" });
    }

    console.log(
      JSON.stringify(
        {
          ok: missing.length === 0 && isolation.every((x) => x.status === "PASS"),
          courtListenerHttpCalls: 0,
          allCircuitsRepresented: missing.length === 0,
          missing,
          represented,
          scotusRetrieval: isolation.find((x) => x.filter === "us-scotus"),
          circuitIsolation: isolation,
          featureAgents: process.env.FEATURE_AGENTS ?? null,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
