#!/usr/bin/env node
/**
 * Count unresolved/resolved citation edges matching target citations.
 * Zero CourtListener. Zero AI.
 *
 * Usage:
 *   node tmp-queue2-cite-target-edge-count.cjs '422 U.S. 490|8 F.4th 531'
 *   node tmp-queue2-cite-target-edge-count.cjs --fsupp-top 15
 *   node tmp-queue2-cite-target-edge-count.cjs --live-demand '523 U.S. 83|844 F.2d 461'
 */
"use strict";
const postgres = require("postgres");

function norms(cite) {
  const raw = String(cite || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  const out = new Set();
  if (!raw) return [];
  out.add(raw);
  out.add(raw.toUpperCase());
  out.add(raw.replace(/\./g, ""));
  out.add(raw.replace(/\s+/g, ""));
  // U.S. spacing variants
  out.add(raw.replace(/U\.\s*S\./gi, "U.S."));
  out.add(raw.replace(/U\.\s*S\./gi, "U. S."));
  out.add(raw.replace(/U\.\s*S\./gi, "US"));
  // F.Supp spacing
  out.add(raw.replace(/F\.\s*Supp\.?\s*/gi, "F. Supp. "));
  out.add(raw.replace(/F\.\s*Supp\.?\s*/gi, "F.Supp."));
  out.add(raw.replace(/F\.\s*Supp\.?\s*/gi, "F.Supp. "));
  // compact reporter forms used in corpus (P3d)
  out.add(raw.replace(/P\.?\s*3d/gi, "P3d"));
  out.add(raw.replace(/P\.?\s*2d/gi, "P2d"));
  out.add(raw.replace(/F\.?\s*3d/gi, "F3d"));
  out.add(raw.replace(/F\.?\s*2d/gi, "F2d"));
  out.add(raw.replace(/F\.?\s*4th/gi, "F4th"));
  return [...out].filter(Boolean);
}

async function countForCite(sql, cite) {
  const variants = norms(cite);
  const compact = variants.map((v) => v.replace(/\./g, "").replace(/\s+/g, "").toUpperCase());
  const [row] = await sql`
    select
      count(*)::int as total,
      count(*) filter (where to_authority_id is null)::int as unresolved,
      count(*) filter (where to_authority_id is not null)::int as resolved
    from legal_authority_citations
    where normalized_citation = any(${variants})
       or raw_citation = any(${variants})
       or upper(replace(replace(coalesce(normalized_citation,''), '.', ''), ' ', '')) = any(${compact})
       or upper(replace(replace(coalesce(raw_citation,''), '.', ''), ' ', '')) = any(${compact})
  `;
  return {
    citation: cite,
    variants,
    total: row.total,
    unresolved: row.unresolved,
    resolved: row.resolved,
  };
}

async function fsuppTop(sql, limit) {
  const rows = await sql`
    select
      coalesce(nullif(btrim(normalized_citation), ''), nullif(btrim(raw_citation), '')) as cite,
      count(*)::int as edge_demand,
      count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
    where to_authority_id is null
      and (
        normalized_citation ~* 'F\\.?\\s*Supp'
        or raw_citation ~* 'F\\.?\\s*Supp'
      )
      and coalesce(normalized_citation, raw_citation) ~* '^[0-9]+\\s+F\\.?\\s*Supp'
    group by 1
    having count(*) filter (where to_authority_id is null) >= 1
    order by unresolved desc, edge_demand desc
    limit ${limit}
  `;
  return rows
    .filter((r) => r.cite && /\d/.test(r.cite) && /F\.?\s*Supp/i.test(r.cite))
    .map((r) => ({
      citation: String(r.cite).replace(/\s+/g, " ").trim(),
      edgeDemand: r.unresolved,
      citationFamily: "federal_supplement",
      status: "READY_CL_SUPPLEMENTAL",
    }));
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const args = process.argv.slice(2);
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    if (args[0] === "--fsupp-top") {
      const limit = Math.min(Math.max(Number(args[1] || 15), 1), 50);
      const targets = await fsuppTop(sql, limit);
      console.log(JSON.stringify({
        ok: true,
        mode: "fsupp_top",
        targets,
        courtListenerHttpCalls: 0,
        aiCalls: 0,
      }));
      return;
    }
    const cites = String(args[0] === "--live-demand" ? args[1] : args[0] || "")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!cites.length) {
      console.log(JSON.stringify({ ok: false, reason: "no_citations", courtListenerHttpCalls: 0 }));
      process.exit(2);
    }
    const counts = [];
    for (const c of cites) counts.push(await countForCite(sql, c));
    console.log(JSON.stringify({
      ok: true,
      mode: "edge_counts",
      counts,
      courtListenerHttpCalls: 0,
      aiCalls: 0,
    }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e?.message || e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
