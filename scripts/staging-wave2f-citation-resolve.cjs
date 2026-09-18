/**
 * Wave 2F exact citation resolve pass (staging).
 * Deterministic aliases only — no fuzzy title matching, no CourtListener.
 */
"use strict";

const postgres = require("postgres");
const {
  citationLookupAliases,
  leanNormalizeCitation,
} = require("./wave2f-citation-audit.cjs");

function indexKeysForAuthority(row) {
  const keys = new Set();
  for (const value of [row.normalized_citation, row.citation].filter(Boolean)) {
    const lean = leanNormalizeCitation(value) || value;
    for (const alias of citationLookupAliases(lean)) keys.add(alias);
    for (const alias of citationLookupAliases(value)) keys.add(alias);
  }
  const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
  const aliases = Array.isArray(meta.citationAliases)
    ? meta.citationAliases
    : Array.isArray(meta.parallelCitations)
      ? meta.parallelCitations
      : [];
  for (const a of aliases) {
    if (typeof a !== "string" || !a.trim()) continue;
    const lean = leanNormalizeCitation(a) || a.trim();
    for (const alias of citationLookupAliases(lean)) keys.add(alias);
  }
  if (row.source_provider === "courtlistener" && row.source_external_id) {
    keys.add(`ext:${row.source_external_id}`);
  }
  return [...keys];
}

function lookupCandidates(index, raw, normalized) {
  const keys = new Set();
  for (const value of [normalized, raw].filter(Boolean)) {
    const lean = leanNormalizeCitation(value) || value;
    for (const alias of citationLookupAliases(lean)) keys.add(alias);
    for (const alias of citationLookupAliases(value)) keys.add(alias);
  }
  const ids = new Set();
  for (const key of keys) {
    const hit = index.get(key);
    if (hit) for (const id of hit) ids.add(id);
  }
  return [...ids];
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL missing");
  const dryRun = process.env.WAVE2F_RESOLVE_DRY_RUN === "1";
  const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 20, ssl: "require" });

  try {
    const before = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;

    // 1) Backfill authority normalized_citation + citationAliases BEFORE indexing.
    let authorityNormUpdated = 0;
    let parallelAliasWrites = 0;
    const authoritiesPre = await sql`
      select id, citation, normalized_citation, source_provider, source_external_id, metadata
      from legal_authorities
    `;
    if (!dryRun) {
      for (const row of authoritiesPre) {
        const lean =
          leanNormalizeCitation(row.normalized_citation) ||
          leanNormalizeCitation(row.citation);
        const meta = row.metadata && typeof row.metadata === "object" ? { ...row.metadata } : {};
        const existing = Array.isArray(meta.citationAliases) ? meta.citationAliases : [];
        const aliasSeed = lean || row.normalized_citation || row.citation;
        const aliases = aliasSeed
          ? citationLookupAliases(aliasSeed).filter((a) => a !== lean && a !== row.citation)
          : [];
        const merged = [...new Set([...existing, ...aliases])].slice(0, 12);
        const needsNorm =
          lean && (!row.normalized_citation || row.normalized_citation !== lean);
        const needsAliases = merged.length !== existing.length;
        if (!needsNorm && !needsAliases) continue;
        if (needsAliases) {
          meta.citationAliases = merged;
          parallelAliasWrites += 1;
        }
        if (needsNorm) authorityNormUpdated += 1;
        await sql`
          update legal_authorities
          set metadata = ${sql.json(meta)},
              normalized_citation = coalesce(${lean}, normalized_citation),
              updated_at = now()
          where id = ${row.id}
        `;
      }
    }

    // 2) Reload authorities and build lookup index.
    const authorities = await sql`
      select id, citation, normalized_citation, source_provider, source_external_id, metadata
      from legal_authorities
    `;

    const index = new Map();
    for (const row of authorities) {
      for (const key of indexKeysForAuthority(row)) {
        if (!index.has(key)) index.set(key, new Set());
        index.get(key).add(row.id);
      }
    }

    // 3) Re-normalize unresolved edges, then exact-resolve.
    const unresolved = await sql`
      select id, raw_citation, normalized_citation, to_authority_id
      from legal_authority_citations
      where to_authority_id is null
    `;

    let newlyResolved = 0;
    let ambiguous = 0;
    let edgeNormUpdated = 0;
    let stillUnresolved = 0;
    const sampleResolved = [];
    const sampleAmbiguous = [];
    const familyResolved = {
      us_reports: 0,
      federal_reporter: 0,
      usc: 0,
      cfr: 0,
      federal_rules: 0,
      other: 0,
    };

    function familyOf(cite) {
      if (!cite) return "other";
      if (/^\d{1,3}\s+U\.?\s*S\.?\s+\d/i.test(cite) && !/U\.?\s*S\.?\s*C/i.test(cite)) return "us_reports";
      if (/^\d{1,4}\s+F\./i.test(cite)) return "federal_reporter";
      if (/U\.?\s*S\.?\s*C/i.test(cite)) return "usc";
      if (/C\.?\s*F\.?\s*R/i.test(cite)) return "cfr";
      if (/^Fed\.?\s*R/i.test(cite)) return "federal_rules";
      return "other";
    }

    for (const edge of unresolved) {
      const lean =
        leanNormalizeCitation(edge.normalized_citation) ||
        leanNormalizeCitation(edge.raw_citation) ||
        edge.normalized_citation;

      if (!dryRun && lean && edge.normalized_citation && lean !== edge.normalized_citation) {
        await sql`
          update legal_authority_citations
          set normalized_citation = ${lean}
          where id = ${edge.id}
        `;
        edgeNormUpdated += 1;
      }

      const candidates = lookupCandidates(index, edge.raw_citation, lean || edge.normalized_citation);
      if (candidates.length === 1) {
        if (!dryRun) {
          await sql`
            update legal_authority_citations
            set to_authority_id = ${candidates[0]}
            where id = ${edge.id} and to_authority_id is null
          `;
        }
        newlyResolved += 1;
        familyResolved[familyOf(lean || edge.normalized_citation)] += 1;
        if (sampleResolved.length < 12) {
          sampleResolved.push({ raw: edge.raw_citation, lean, to: candidates[0] });
        }
      } else if (candidates.length > 1) {
        ambiguous += 1;
        if (sampleAmbiguous.length < 5) {
          sampleAmbiguous.push({
            raw: edge.raw_citation,
            lean,
            candidates: candidates.slice(0, 3),
          });
        }
      } else {
        stillUnresolved += 1;
      }
    }

    const after = await sql`
      select
        count(*)::int as extracted,
        count(*) filter (where to_authority_id is not null)::int as resolved,
        count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;

    const byFamily = await sql`
      select
        count(*) filter (where to_authority_id is not null and normalized_citation ~* '^\\d{1,3}\\s+U\\.?\\s?S\\.?\\s+\\d')::int as us_reports_resolved,
        count(*) filter (where to_authority_id is not null and normalized_citation ~* '^\\d{1,2}\\s+U\\.?\\s?S\\.?\\s?C')::int as usc_resolved,
        count(*) filter (where to_authority_id is not null and normalized_citation ~* '^\\d{1,2}\\s+C\\.?\\s?F\\.?\\s?R')::int as cfr_resolved,
        count(*) filter (where to_authority_id is not null and normalized_citation ~* '^Fed\\.\\s*R')::int as fed_rules_resolved,
        count(*) filter (where to_authority_id is not null and normalized_citation ~* '^\\d{1,4}\\s+F\\.')::int as freporter_resolved
      from legal_authority_citations
    `;

    // Why remaining unresolved (sample classification against index).
    let missingTarget = 0;
    let parserGap = 0;
    for (const edge of unresolved.slice(0, 500)) {
      const lean =
        leanNormalizeCitation(edge.normalized_citation) ||
        leanNormalizeCitation(edge.raw_citation);
      if (!lean && !leanNormalizeCitation(edge.raw_citation)) parserGap += 1;
      else if (lookupCandidates(index, edge.raw_citation, lean).length === 0) missingTarget += 1;
    }

    console.log(
      JSON.stringify({
        ok: true,
        wave: "2F",
        dryRun,
        generatedAt: new Date().toISOString(),
        before: before[0],
        after: after[0],
        newlyResolved,
        ambiguous,
        stillUnresolved,
        edgeNormUpdated,
        authorityNormUpdated,
        parallelAliasWrites,
        newlyResolvedByFamily: familyResolved,
        resolutionPct:
          after[0].extracted > 0
            ? Math.round((10000 * after[0].resolved) / after[0].extracted) / 100
            : 0,
        byFamily: byFamily[0],
        auditHints: { missingTargetSample500: missingTarget, parserGapSample500: parserGap },
        sampleResolved,
        sampleAmbiguous,
        notes: [
          "Authority alias/normalization backfill runs before resolve index build.",
          "Exact alias/normalized match only; multiple hits left unresolved as ambiguous.",
          "No CourtListener traffic; no fuzzy title linking.",
        ],
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
