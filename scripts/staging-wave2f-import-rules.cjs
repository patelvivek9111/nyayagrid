/**
 * Wave 2F: import curated state court-rules bundle into staging (append-only).
 * No embeddings required for citation resolution; chunks optional.
 */
"use strict";

const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");

  // Inlined by esbuild from corpus bundle; also accepts uploaded /tmp path.
  let authorities;
  try {
    authorities = require("../packages/research/corpus/bundles/expansion-wave2f-state-rules.json");
  } catch {
    const p = "/tmp/expansion-wave2f-state-rules.json";
    if (!fs.existsSync(p)) throw new Error("wave2f rules bundle not found");
    authorities = JSON.parse(fs.readFileSync(p, "utf8"));
  }
  if (!Array.isArray(authorities)) throw new Error("bundle must be array");
  const bundlePath = "expansion-wave2f-state-rules.json";
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, ssl: "require" });

  let imported = 0;
  let skipped = 0;
  let newVersion = 0;
  const samples = [];

  try {
    for (const a of authorities) {
      const content = a.content || "";
      const hash = sha256(content);
      const existing = await sql`
        select id from legal_authorities
        where source_provider = ${a.sourceProvider || "us-primary-corpus"}
          and source_external_id = ${a.sourceExternalId}
        limit 1
      `;

      if (existing.length === 0) {
        const id = randomUUID();
        await sql`
          insert into legal_authorities (
            id, authority_type, jurisdiction, court, court_id, authority_state,
            title, citation, normalized_citation, source_provider, source_external_id,
            canonical_source_url, ingestion_status, currentness_status, last_checked_at,
            metadata, created_at, updated_at
          ) values (
            ${id},
            ${a.authorityType || "rule"},
            ${a.jurisdiction || null},
            ${a.court || null},
            ${a.courtId || null},
            ${a.authorityState || null},
            ${a.title},
            ${a.citation || null},
            ${a.normalizedCitation || a.citation || null},
            ${a.sourceProvider || "us-primary-corpus"},
            ${a.sourceExternalId},
            ${a.canonicalSourceUrl || null},
            'ready',
            ${a.currentnessStatus || "current_as_of_source_date"},
            now(),
            ${sql.json({
              ...(a.sourceMetadata || {}),
              bundleSourceClass: a.bundleSourceClass || "PRIMARY_OFFICIAL",
              wave: "2F",
            })},
            now(),
            now()
          )
        `;
        await sql`
          insert into legal_authority_versions (
            authority_id, version_number, content, sha256, valid_from, valid_to,
            source_provider, source_metadata
          ) values (
            ${id}, 1, ${content}, ${hash}, now(), null,
            ${a.sourceProvider || "us-primary-corpus"},
            ${sql.json({ wave: "2F", retrievedAt: a.sourceMetadata?.retrievedAt || null })}
          )
        `;
        imported += 1;
        if (samples.length < 5) samples.push({ citation: a.citation, action: "imported" });
        continue;
      }

      const authId = existing[0].id;
      const latest = await sql`
        select id, sha256, version_number from legal_authority_versions
        where authority_id = ${authId}
        order by version_number desc limit 1
      `;
      if (latest[0]?.sha256 === hash) {
        skipped += 1;
        continue;
      }
      await sql`
        update legal_authority_versions set valid_to = now()
        where authority_id = ${authId} and valid_to is null
      `;
      await sql`
        insert into legal_authority_versions (
          authority_id, version_number, content, sha256, valid_from, valid_to,
          source_provider, source_metadata
        ) values (
          ${authId},
          ${(latest[0]?.version_number || 0) + 1},
          ${content},
          ${hash},
          now(),
          null,
          ${a.sourceProvider || "us-primary-corpus"},
          ${sql.json({ wave: "2F", priorSha: latest[0]?.sha256 || null })}
        )
      `;
      newVersion += 1;
      if (samples.length < 5) samples.push({ citation: a.citation, action: "new_version" });
    }

    const counts = await sql`
      select
        count(*)::int as total,
        count(*) filter (where authority_type = 'case')::int as cases,
        count(*) filter (where authority_type = 'statute')::int as statutes,
        count(*) filter (where authority_type = 'regulation')::int as regulations,
        count(*) filter (where authority_type = 'rule')::int as rules
      from legal_authorities
    `;
    const ruleJurs = await sql`
      select authority_state, count(*)::int as n
      from legal_authorities
      where authority_type = 'rule' and authority_state is not null
      group by 1 order by 1
    `;

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2F",
        bundlePath,
        imported,
        skipped,
        newVersion,
        samples,
        corpus: counts[0],
        ruleJurisdictions: ruleJurs,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e?.message || e).slice(0, 500) }));
  process.exit(1);
});
