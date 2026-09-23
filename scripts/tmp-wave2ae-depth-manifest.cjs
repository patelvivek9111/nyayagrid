/**
 * Wave 2AE — DB-only authority-depth ranking manifest.
 * ZERO CourtListener HTTP. Run after case<20 baseline closes.
 */
"use strict";
const postgres = require("postgres");
const { REGISTRY } = require("./cl-court-map-registry.cjs");

function classify(deficit, mid, high, unresolvedCitePressure) {
  if (deficit >= 80 || (deficit >= 50 && mid === 0)) return "CRITICAL_DEPTH";
  if (deficit >= 40 || mid < 5) return "HIGH_DEPTH";
  if (deficit >= 15) return "MEDIUM_DEPTH";
  return "LOW_DEPTH";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const perJur = await sql`
      select
        coalesce(nullif(btrim(authority_state), ''), 'US') as j,
        count(*)::int as authorities,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules,
        count(*) filter (where authority_type = 'case' and court_level in ('state_high','scotus'))::int as high_court,
        count(*) filter (where authority_type = 'case' and court_level in ('state_appellate','circuit'))::int as intermediate,
        round(100.0 * count(*) filter (where currentness_status is not null) / greatest(count(*),1), 1)::float as currentness_pct,
        round(100.0 * count(*) filter (
          where canonical_source_url is not null and btrim(canonical_source_url) <> ''
        ) / greatest(count(*),1), 1)::float as canonical_pct
      from legal_authorities
      group by 1
      order by 1
    `;

    const citeByState = await sql`
      select
        coalesce(nullif(btrim(a.authority_state), ''), 'US') as j,
        count(*) filter (where c.to_authority_id is null)::int as target_absent
      from legal_authority_citations c
      join legal_authorities a on a.id = c.from_authority_id
      group by 1
    `;
    const citeMap = Object.fromEntries(citeByState.map((r) => [r.j, Number(r.target_absent) || 0]));

    const courtsByJ = {};
    for (const e of Object.values(REGISTRY)) {
      if (!e?.jurisdiction || e.verificationStatus !== "VERIFIED" || !e.ingestEnabled) continue;
      if (!courtsByJ[e.jurisdiction]) courtsByJ[e.jurisdiction] = [];
      courtsByJ[e.jurisdiction].push({
        cl: e.clCourtId,
        nyaya: e.nyayaCourtId,
        level: e.courtLevel,
      });
    }

    const rows = perJur.map((r) => {
      const j = r.j;
      const auth = Number(r.authorities) || 0;
      const deficit = Math.max(0, 101 - auth);
      const mid = Number(r.intermediate) || 0;
      const high = Number(r.high_court) || 0;
      const targetAbsent = citeMap[j] || 0;
      const verified = courtsByJ[j] || [];
      const casesNeeded = deficit; // approx 1 auth ≈ 1 case for CL depth
      const estReq = Math.ceil(casesNeeded * 2.3);
      const score =
        deficit * 10 +
        (mid === 0 && j !== "US" && j !== "DE" ? 200 : 0) +
        Math.min(targetAbsent, 500) * 0.05 +
        (100 - Number(r.currentness_pct || 0)) * 0.5;
      return {
        j,
        authorities: auth,
        cases: Number(r.cases) || 0,
        statutes: Number(r.statutes) || 0,
        regulations: Number(r.regulations) || 0,
        rules: Number(r.rules) || 0,
        authorityDeficitTo101: deficit,
        highCourt: high,
        intermediateAppellate: mid,
        currentnessPct: Number(r.currentness_pct) || 0,
        canonicalPct: Number(r.canonical_pct) || 0,
        citationTargetAbsent: targetAbsent,
        verifiedCourts: verified,
        preferredCourt: verified.find((c) => c.level === "state_high" || c.level === "scotus") || verified[0] || null,
        expectedCasesNeeded: casesNeeded,
        estimatedClRequests: estReq,
        score,
        class: classify(deficit, mid, high, targetAbsent),
        reason:
          deficit >= 80
            ? "largest authority deficit below gate"
            : mid === 0 && deficit > 0
              ? "weak/absent intermediate appellate depth"
              : targetAbsent > 100
                ? "citation TARGET_ABSENT demand"
                : "depth/breadth improvement",
      };
    });

    rows.sort((a, b) => b.score - a.score || b.authorityDeficitTo101 - a.authorityDeficitTo101);
    const top10 = rows.filter((r) => r.authorityDeficitTo101 > 0).slice(0, 10);
    const byClass = { CRITICAL_DEPTH: 0, HIGH_DEPTH: 0, MEDIUM_DEPTH: 0, LOW_DEPTH: 0 };
    for (const r of rows) byClass[r.class] = (byClass[r.class] || 0) + 1;

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2AE",
        courtListenerHttpCalls: 0,
        generatedAt: new Date().toISOString(),
        featureAgents: process.env.FEATURE_AGENTS || "0",
        classCounts: byClass,
        top10,
        allWithDeficit: rows.filter((r) => r.authorityDeficitTo101 > 0).length,
        note: "Ranked for authority-depth expansion after national min-case baseline. Not vanity 101 fill.",
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
