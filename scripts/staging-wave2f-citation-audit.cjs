/**
 * Staging Wave 2F: citation edge family + WHY audit (no CourtListener).
 */
"use strict";

const postgres = require("postgres");
const {
  auditCitationEdges,
  FAMILY_BUCKETS,
  WHY_CODES,
} = require("./wave2f-citation-audit.cjs");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, ssl: "require" });

  const citeCounts = await sql`
    select
      count(*)::int as total,
      count(*) filter (where to_authority_id is not null)::int as resolved,
      count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;

  const edges = await sql`
    select
      id,
      from_authority_id,
      to_authority_id,
      raw_citation,
      normalized_citation,
      pinpoint
    from legal_authority_citations
  `;

  const authorities = await sql`
    select id, citation, normalized_citation, authority_type, jurisdiction, source_provider
    from legal_authorities
  `;

  const audit = auditCitationEdges(edges, authorities);

  const unresolvedByFamily = await sql`
    select
      count(*) filter (where normalized_citation ~* '^\\d{1,3}\\s+U\\.?\\s?S\\.?\\s+\\d')::int as us_reports,
      count(*) filter (where normalized_citation ~* '^\\d{1,4}\\s+F\\.\\s?(2d|3d|4th)?\\s+\\d' and normalized_citation !~* 'Supp')::int as federal_reporter,
      count(*) filter (where normalized_citation ~* 'F\\.\\s*Supp')::int as federal_supplement,
      count(*) filter (where normalized_citation ~* '^\\d{1,2}\\s+U\\.?\\s?S\\.?\\s?C')::int as usc,
      count(*) filter (where normalized_citation ~* '^\\d{1,2}\\s+C\\.?\\s?F\\.?\\s?R')::int as cfr,
      count(*) filter (where to_authority_id is null)::int as unresolved_total
    from legal_authority_citations
  `;

  const authorityNormGap = await sql`
    select
      count(*) filter (where citation is not null and btrim(citation) <> '')::int as with_citation,
      count(*) filter (
        where citation is not null and btrim(citation) <> ''
          and (normalized_citation is null or btrim(normalized_citation) = '')
      )::int as missing_normalized
    from legal_authorities
  `;

  console.log(
    JSON.stringify(
      {
        ok: true,
        wave: "2F",
        generatedAt: new Date().toISOString(),
        citationGraph: citeCounts[0],
        authorityNormalizationGap: authorityNormGap[0],
        families: audit.families,
        whyUnresolved: audit.whyUnresolved,
        sqlUnresolvedHints: unresolvedByFamily[0],
        samples: audit.samples,
        whySamples: audit.whySamples,
        meta: {
          familyBuckets: FAMILY_BUCKETS,
          whyCodes: WHY_CODES,
          edgesAudited: edges.length,
          authoritiesIndexed: authorities.length,
        },
      },
      null,
      2,
    ),
  );

  await sql.end({ timeout: 5 });
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e) }));
  process.exit(1);
});
