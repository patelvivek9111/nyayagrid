/**
 * Zero-CL unresolved citation classification snapshot (staging DB).
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
    const [totals] = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [r] = await sql`
      with u as (
        select lower(coalesce(normalized_citation, raw_citation, '')) as n
        from legal_authority_citations
        where to_authority_id is null
      )
      select
        count(*)::int as n,
        count(*) filter (where n ~* '^\\d+\\s+u\\.?\\s*s\\.?\\s+\\d+' or n ~* '^\\d+\\s+f\\.\\s*(2d|3d|4th)\\s+\\d+' or n ~* '^\\d+\\s+f\\.\\s*supp' or n ~* '^\\d+\\s+[a-z]{1,8}\\.?(2d|3d)?\\s+\\d+')::int as target_absent_case,
        count(*) filter (where n ~* 'u\\.?\\s*s\\.?\\s*c\\.?')::int as target_absent_statute,
        count(*) filter (where n ~* 'c\\.?\\s*f\\.?\\s*r\\.?')::int as target_absent_regulation,
        count(*) filter (where n ~* 'fed\\.\\s*r\\.')::int as target_absent_rule,
        count(*) filter (where length(n) < 4)::int as malformed
      from u
    `;
    const caseN = Number(r.target_absent_case || 0);
    const statuteN = Number(r.target_absent_statute || 0);
    const regN = Number(r.target_absent_regulation || 0);
    const ruleN = Number(r.target_absent_rule || 0);
    const malformed = Number(r.malformed || 0);
    const classified = caseN + statuteN + regN + ruleN + malformed;
    const other = Math.max(0, Number(totals.unresolved || 0) - classified);
    console.log(
      JSON.stringify({
        ok: true,
        classification: "WEEK2_UNRESOLVED_CLASSIFICATION_SNAPSHOT",
        generatedAt: new Date().toISOString(),
        courtListenerHttpCalls: 0,
        aiCalls: 0,
        totals,
        buckets: {
          TARGET_ABSENT_CASE: caseN,
          TARGET_ABSENT_STATUTE: statuteN,
          TARGET_ABSENT_REGULATION: regN,
          TARGET_ABSENT_RULE: ruleN,
          SOURCE_UNAVAILABLE: 0,
          AMBIGUOUS: 0,
          UNSUPPORTED: 0,
          MALFORMED: malformed,
          INSUFFICIENT_METADATA_OTHER: other,
        },
        note: "Zero-CL heuristic buckets from normalized/raw text; SOURCE_UNAVAILABLE/AMBIGUOUS/UNSUPPORTED require status fields not densely populated — residual in OTHER.",
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
