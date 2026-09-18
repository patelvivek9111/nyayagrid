/**
 * Staging Wave 2F: backfill legal_authorities.normalized_citation from citation
 * using deterministic leanNormalize rules (high-confidence only).
 */
"use strict";

const postgres = require("postgres");
const { leanNormalizeCitation, classifyCitationFamily, PARSER_SUPPORTED_FAMILIES } = require("./wave2f-citation-audit.cjs");

function isHighConfidenceNormalize(citation, normalized) {
  if (!citation || !normalized) return false;
  const family = classifyCitationFamily(citation, normalized);
  if (!PARSER_SUPPORTED_FAMILIES.has(family)) return false;
  if (family === "unknown" || family === "malformed_partial") return false;
  const lean = leanNormalizeCitation(citation);
  return lean === normalized;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, ssl: "require" });

  const before = await sql`
    select
      count(*)::int as total,
      count(*) filter (where citation is not null and btrim(citation) <> '')::int as with_citation,
      count(*) filter (
        where citation is not null and btrim(citation) <> ''
          and normalized_citation is not null and btrim(normalized_citation) <> ''
      )::int as with_normalized,
      count(*) filter (
        where citation is not null and btrim(citation) <> ''
          and (normalized_citation is null or btrim(normalized_citation) = '')
      )::int as missing_normalized
    from legal_authorities
  `;

  const candidates = await sql`
    select id, citation, normalized_citation, authority_type, source_provider
    from legal_authorities
    where citation is not null
      and btrim(citation) <> ''
      and (normalized_citation is null or btrim(normalized_citation) = '')
  `;

  const updates = [];
  const skipped = { low_confidence: 0, no_change: 0, garbage: 0 };

  for (const row of candidates) {
    const citation = String(row.citation).trim();
    const normalized = leanNormalizeCitation(citation);
    if (!normalized || normalized === citation && classifyCitationFamily(citation, null) === "unknown") {
      skipped.garbage += 1;
      continue;
    }
    if (!isHighConfidenceNormalize(citation, normalized)) {
      skipped.low_confidence += 1;
      continue;
    }
    if (row.normalized_citation === normalized) {
      skipped.no_change += 1;
      continue;
    }
    updates.push({ id: row.id, citation, normalized, authority_type: row.authority_type });
  }

  let updatedCount = 0;
  if (!dryRun && updates.length > 0) {
    for (const batch of chunk(updates, 100)) {
      for (const u of batch) {
        const res = await sql`
          update legal_authorities
          set normalized_citation = ${u.normalized}, updated_at = now()
          where id = ${u.id}
            and (normalized_citation is null or btrim(normalized_citation) = '')
          returning id
        `;
        updatedCount += res.length;
      }
    }
  } else {
    updatedCount = updates.length;
  }

  const after = await sql`
    select
      count(*)::int as total,
      count(*) filter (where citation is not null and btrim(citation) <> '')::int as with_citation,
      count(*) filter (
        where citation is not null and btrim(citation) <> ''
          and normalized_citation is not null and btrim(normalized_citation) <> ''
      )::int as with_normalized,
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
        dryRun,
        before: before[0],
        after: after[0],
        candidates: candidates.length,
        eligibleUpdates: updates.length,
        updated: dryRun ? 0 : updatedCount,
        wouldUpdate: dryRun ? updates.length : undefined,
        skipped,
        sampleUpdates: updates.slice(0, 10).map((u) => ({
          citation: u.citation,
          normalized: u.normalized,
          authority_type: u.authority_type,
        })),
      },
      null,
      2,
    ),
  );

  await sql.end({ timeout: 5 });
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e) }));
  process.exit(1);
});
