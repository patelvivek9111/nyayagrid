/**
 * Classify citation edges into valid/in-scope denominator buckets.
 * ZERO CourtListener. ZERO mutations.
 *
 * Buckets (mutually exclusive for unresolved; resolved counted separately):
 * - VALID_PRESENT_RESOLVED
 * - VALID_TARGET_ABSENT
 * - VALID_PRESENT_UNRESOLVED_DEFECT
 * - AMBIGUOUS
 * - MALFORMED
 * - OUT_OF_SCOPE
 * - UNSUPPORTED_AUTHORITY_TYPE
 * - SOURCE_UNAVAILABLE
 */
"use strict";
const postgres = require("postgres");

function classifyUnresolved(norm, raw) {
  const n = String(norm || "").trim();
  const r = String(raw || "").trim();
  if (!n || n.length < 3) return "MALFORMED";

  // Malformed patterns
  if (/^[\d\s.,;:]+$/.test(n)) return "MALFORMED";
  if (/\?\?\?|FIXME|TODO|lorem/i.test(n)) return "MALFORMED";
  if (n.length > 180) return "MALFORMED";

  // Out of scope / unsupported types (not NyayaGrid primary case/statute/reg/rule corpus)
  if (/\b(WL|LEXIS|Westlaw|Google Scholar)\b/i.test(n)) return "OUT_OF_SCOPE";
  if (/\b(Restatement|Am\.\s*Jur|C\.J\.S\.|ALR|Law Review|L\.\s*Rev\.)\b/i.test(n)) return "UNSUPPORTED_AUTHORITY_TYPE";
  if (/\b(Treatise|Hornbook|Black'?s Law)\b/i.test(n)) return "UNSUPPORTED_AUTHORITY_TYPE";
  if (/\b(U\.N\.|I\.C\.J\.|E\.C\.H\.R\.|foreign)\b/i.test(n)) return "OUT_OF_SCOPE";

  // Ambiguous: incomplete volume/page or multi-cite mashed
  if (/\band\b.+\bv\./i.test(n) && /\d+\s+[A-Z]/.test(n) && n.split(/\d+/).length > 6) return "AMBIGUOUS";
  if (/^\d+\s+[A-Za-z.\s]+$/.test(n) && !/\d+$/.test(n) && !/ section /.test(n)) return "AMBIGUOUS";
  if (/\bat\s+\d+/i.test(n) && !/\d+\s+U\.?\s*S\.?\s+\d+/i.test(n) && n.split(/\s+/).length < 4) return "AMBIGUOUS";

  // Known primary families → VALID_TARGET_ABSENT (identity clear, corpus missing)
  if (/\b\d+\s+U\.?\s*S\.?\s+\d+/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+F\.\s*(2d|3d|4th)\s+\d+/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+F\.\s*Supp/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+U\.?\s*S\.?\s*C\.?/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+C\.?\s*F\.?\s*R\.?/i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\bFed\.\s*R\./i.test(n)) return "VALID_TARGET_ABSENT";
  if (/\b\d+\s+[A-Z][a-z]+\.?\s*(2d|3d)?\s+\d+/i.test(n)) return "VALID_TARGET_ABSENT"; // state reporters

  // Source unavailable markers (parallel reporters without U.S.)
  if (/\bS\.\s*Ct\.\b/i.test(n) && !/\bU\.?\s*S\.?\s+\d+/i.test(n)) return "SOURCE_UNAVAILABLE";
  if (/\bL\.\s*Ed\.?\s*(2d)?\b/i.test(n) && !/\bU\.?\s*S\.?\s+\d+/i.test(n)) return "SOURCE_UNAVAILABLE";

  // Insufficient local parser evidence — do not guess
  if (/\d/.test(n) && /[A-Za-z]/.test(n) && n.length >= 6) return "UNKNOWN_EXTERNAL";
  return "AMBIGUOUS";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
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

    // Defect: unresolved but matching authority exists by normalized citation
    const defects = await sql`
      select e.id
      from legal_authority_citations e
      join legal_authorities a
        on e.to_authority_id is null
       and e.normalized_citation is not null
       and length(e.normalized_citation) > 4
       and (
         a.normalized_citation = e.normalized_citation
         or a.citation = e.normalized_citation
       )
      limit 50000
    `;
    const defectIds = new Set(defects.map((d) => d.id));

    const unresolved = await sql`
      select id, normalized_citation, raw_citation
      from legal_authority_citations
      where to_authority_id is null
    `;

    const buckets = {
      VALID_PRESENT_RESOLVED: Number(totals.resolved || 0),
      VALID_TARGET_ABSENT: 0,
      VALID_PRESENT_UNRESOLVED_DEFECT: 0,
      AMBIGUOUS: 0,
      MALFORMED: 0,
      OUT_OF_SCOPE: 0,
      UNSUPPORTED_AUTHORITY_TYPE: 0,
      SOURCE_UNAVAILABLE: 0,
      UNKNOWN_EXTERNAL: 0,
    };

    const samples = {
      VALID_TARGET_ABSENT: [],
      AMBIGUOUS: [],
      MALFORMED: [],
      OUT_OF_SCOPE: [],
      UNSUPPORTED_AUTHORITY_TYPE: [],
      SOURCE_UNAVAILABLE: [],
      VALID_PRESENT_UNRESOLVED_DEFECT: [],
      UNKNOWN_EXTERNAL: [],
    };

    for (const e of unresolved) {
      let bucket;
      if (defectIds.has(e.id)) {
        bucket = "VALID_PRESENT_UNRESOLVED_DEFECT";
      } else {
        bucket = classifyUnresolved(e.normalized_citation, e.raw_citation);
      }
      buckets[bucket] += 1;
      if (samples[bucket] && samples[bucket].length < 8) {
        samples[bucket].push(String(e.normalized_citation || e.raw_citation || "").slice(0, 80));
      }
    }

    const validInScope =
      buckets.VALID_PRESENT_RESOLVED +
      buckets.VALID_TARGET_ABSENT +
      buckets.VALID_PRESENT_UNRESOLVED_DEFECT;

    const resolved = buckets.VALID_PRESENT_RESOLVED;
    const validRate = validInScope > 0 ? Number(((resolved / validInScope) * 100).toFixed(2)) : 0;
    const rawRate =
      Number(totals.extracted) > 0
        ? Number(((Number(totals.resolved) / Number(totals.extracted)) * 100).toFixed(2))
        : 0;

    console.log(
      JSON.stringify({
        ok: true,
        classification: "QUEUE2_CITATION_VALID_DENOMINATOR",
        generatedAt: new Date().toISOString(),
        courtListenerHttpCalls: 0,
        mutations: 0,
        rules: {
          VALID_PRESENT_RESOLVED: "to_authority_id set",
          VALID_TARGET_ABSENT: "parseable primary-family citation; no matching authority",
          VALID_PRESENT_UNRESOLVED_DEFECT: "unresolved edge but matching authority exists by citation",
          AMBIGUOUS: "incomplete or multi-cite mash",
          MALFORMED: "empty/garbage/non-citation",
          OUT_OF_SCOPE: "WL/LEXIS/secondary-commercial/foreign",
          UNSUPPORTED_AUTHORITY_TYPE: "restatements/ALR/treatises etc.",
          SOURCE_UNAVAILABLE: "parallel reporters without reliable primary ingest path",
          UNKNOWN_EXTERNAL: "insufficient local parser evidence; do not guess",
        },
        extracted: Number(totals.extracted),
        resolved,
        unresolved: Number(totals.unresolved),
        buckets,
        validInScopeResolvable: validInScope,
        validInScopeResolutionPct: validRate,
        rawResolutionPct: rawRate,
        samples,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400) }));
  process.exit(1);
});
