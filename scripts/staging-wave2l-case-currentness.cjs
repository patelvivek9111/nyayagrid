/**
 * Wave 2L — mark CL/case unknowns as historical (not treatment status). No CL HTTP.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const before = await sql`
      select count(*)::int as unknown from legal_authorities
      where currentness_status = 'unknown' or currentness_status is null
    `;
    const updated = await sql`
      update legal_authorities
      set currentness_status = 'historical',
          last_checked_at = coalesce(last_checked_at, now()),
          metadata = coalesce(metadata, '{}'::jsonb) || ${sql.json({
            currentnessPolicy: "wave2l-historical-case",
            currentnessNote: "Cases are historical authorities; currentness_status is not Shepard/KeyCite treatment.",
          })},
          updated_at = now()
      where authority_type = 'case'
        and (currentness_status = 'unknown' or currentness_status is null)
      returning id
    `;
    const after = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type='case')::int as cases,
        count(*) filter (where source_provider='courtlistener')::int as cl,
        count(*) filter (where currentness_status='unknown' or currentness_status is null)::int as unknown,
        count(*) filter (where currentness_status='historical')::int as historical,
        count(*) filter (where last_checked_at is not null)::int as last_checked,
        count(*) filter (where normalized_citation is not null and btrim(normalized_citation)<>'')::int as normalized,
        count(*) filter (where source_provider is not null and source_external_id is not null)::int as provenance
      from legal_authorities
    `;
    process.stdout.write(JSON.stringify({ ok: true, wave: "2L", before: before[0], appliedHistorical: updated.length, after: after[0], courtListenerHttpCalls: 0 }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main().catch((e) => {
  process.stdout.write(JSON.stringify({ ok: false, err: String(e.message || e) }));
  process.exit(1);
});
