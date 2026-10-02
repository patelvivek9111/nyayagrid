/**
 * ZERO-CL local citation extraction backfill for hist-ingest / zero-edge cases.
 * Usage (fly): node script --hist-only [--limit N]
 * No CourtListener. No OpenAI.
 */
"use strict";
const crypto = require("crypto");
const postgres = require("postgres");

const ARGV = process.argv.slice(2);
function flag(name) {
  return ARGV.includes(name);
}
function opt(name, def) {
  const i = ARGV.indexOf(name);
  if (i >= 0 && ARGV[i + 1]) return ARGV[i + 1];
  return def;
}

const HIST_ONLY = flag("--hist-only");
const DO_RERESOLVE = flag("--reresolve");
const LIMIT = Number(opt("--limit", "912"));
const BATCH = Number(opt("--batch", "40"));

const EXTRACT_RES = [
  /\b\d{1,3}\s+U\.?\s*S\.?\s+\d{1,4}\b/gi,
  /\b\d{1,3}\s+S\.?\s*Ct\.?\s+\d{1,4}\b/gi,
  /\b\d{1,4}\s+F\.?\s*(?:2d|3d|4th)\s+\d{1,4}\b/gi,
  /\b\d{1,4}\s+F\.?\s*Supp\.?\s*(?:2d|3d)?\s+\d{1,4}\b/gi,
  /\b\d{1,2}\s+U\.?\s*S\.?\s*C\.?\s*§\s*[\dA-Za-z.()-]+\b/gi,
  /\b\d{1,2}\s+C\.?\s*F\.?\s*R\.?\s*§\s*[\d.()-]+\b/gi,
  /\bFed\.?\s*R\.?\s*(?:Civ\.?\s*P\.?|Evid\.?|App\.?\s*P\.?|Crim\.?\s*P\.?)\s+\d+[A-Za-z]?\b/gi,
  /\b\d{1,4}\s+[A-Z][a-z]{0,10}\.?\s*(?:2d|3d)?\s+\d{1,4}\b/g,
];

function leanNorm(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .replace(/\bU\.\s+S\./gi, "U.S.")
    .replace(/\bF\.\s+(2d|3d|4th)\b/gi, (_, x) => `F.${x.toLowerCase()}`)
    .replace(/\bF\.\s*Supp\.\s*(2d|3d)?/gi, (_, x) => (x ? `F. Supp. ${x.toLowerCase()}` : "F. Supp."))
    .trim();
}

function extract(content) {
  const seen = new Set();
  const out = [];
  for (const re of EXTRACT_RES) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(String(content || ""))) !== null) {
      const raw = m[0].trim();
      const normalized = leanNorm(raw);
      if (!normalized || normalized.length < 5) continue;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      out.push({ raw, normalized });
    }
  }
  return out;
}

function aliases(n) {
  const base = leanNorm(n);
  const set = new Set([base]);
  const us = base.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (us) {
    set.add(`${us[1]} U.S. ${us[2]}`);
    set.add(`${us[1]} U. S. ${us[2]}`);
  }
  const f = base.match(/^(\d{1,4})\s+F\.?\s*(2d|3d|4th)\s+(\d{1,4})$/i);
  if (f) {
    set.add(`${f[1]} F.${f[2].toLowerCase()} ${f[3]}`);
    set.add(`${f[1]} F. ${f[2].toLowerCase()} ${f[3]}`);
  }
  const usc = base.match(/^(\d{1,2})\s+U\.?\s*S\.?\s*C\.?\s*§\s*(.+)$/i);
  if (usc) {
    set.add(`${usc[1]} U.S.C. § ${usc[2]}`);
    set.add(`${usc[1]} USC § ${usc[2]}`);
  }
  const cfr = base.match(/^(\d{1,2})\s+C\.?\s*F\.?\s*R\.?\s*§\s*(.+)$/i);
  if (cfr) {
    set.add(`${cfr[1]} C.F.R. § ${cfr[2]}`);
    set.add(`${cfr[1]} CFR § ${cfr[2]}`);
  }
  return [...set];
}

function pct(n, d) {
  return d ? Number(((100 * n) / d).toFixed(2)) : 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, idle_timeout: 30, connect_timeout: 30 });
  const started = Date.now();
  try {
    const [before] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;

    // Candidate authorities: case, has text, zero edges
    const candidates = await sql`
      select a.id
      from legal_authorities a
      where a.authority_type = 'case'
        and (${HIST_ONLY}::boolean is false or coalesce(a.metadata->>'adapter','') = 's3-hist-ingest')
        and exists (
          select 1 from legal_authority_versions v
          where v.authority_id = a.id and length(v.content) >= 200
        )
        and not exists (
          select 1 from legal_authority_citations c where c.from_authority_id = a.id
        )
      order by a.created_at desc
      limit ${LIMIT}
    `;

    // Alias index for resolve-at-insert
    const authorities = await sql`select id, citation, normalized_citation from legal_authorities`;
    const aliasIndex = new Map();
    for (const a of authorities) {
      for (const v of [a.normalized_citation, a.citation].filter(Boolean)) {
        for (const k of aliases(v)) {
          if (!aliasIndex.has(k)) aliasIndex.set(k, new Set());
          aliasIndex.get(k).add(a.id);
        }
      }
    }

    let processed = 0;
    let newOcc = 0;
    let newResolvedAtInsert = 0;
    let failures = 0;
    const uniqueNew = new Set();

    for (let i = 0; i < candidates.length; i += BATCH) {
      const batch = candidates.slice(i, i + BATCH);
      const ids = batch.map((b) => b.id);
      const texts = await sql`
        select a.id, v.content
        from legal_authorities a
        join lateral (
          select content from legal_authority_versions
          where authority_id = a.id order by version_number desc limit 1
        ) v on true
        where a.id = any(${ids}::uuid[])
      `;

      const rows = [];
      for (const t of texts) {
        try {
          const cites = extract(t.content);
          for (const cit of cites) {
            let toId = null;
            for (const k of aliases(cit.normalized)) {
              const hit = aliasIndex.get(k);
              if (hit && hit.size === 1) {
                toId = [...hit][0];
                break;
              }
            }
            rows.push({
              id: crypto.randomUUID(),
              from: t.id,
              to: toId,
              raw: cit.raw,
              norm: cit.normalized,
            });
            if (!uniqueNew.has(cit.normalized)) uniqueNew.add(cit.normalized);
            if (toId) newResolvedAtInsert += 1;
          }
          processed += 1;
        } catch {
          failures += 1;
        }
      }

      // These authorities were selected with zero edges; in-memory dedupe is sufficient for this pass.
      for (const r of rows) {
        await sql`
          insert into legal_authority_citations (
            id, from_authority_id, to_authority_id, raw_citation, normalized_citation
          ) values (${r.id}, ${r.from}, ${r.to}, ${r.raw}, ${r.norm})
        `;
        newOcc += 1;
      }

      if ((i / BATCH) % 5 === 0) {
        // progress heartbeat to stdout (fly)
        console.error(`progress processed=${processed}/${candidates.length} newOcc=${newOcc}`);
      }
    }

    let reresolveFixed = 0;
    if (DO_RERESOLVE) {
      const unresolved = await sql`
        select id, raw_citation, normalized_citation
        from legal_authority_citations where to_authority_id is null
      `;
      // refresh alias index
      const authorities2 = await sql`select id, citation, normalized_citation from legal_authorities`;
      const alias2 = new Map();
      for (const a of authorities2) {
        for (const v of [a.normalized_citation, a.citation].filter(Boolean)) {
          for (const k of aliases(v)) {
            if (!alias2.has(k)) alias2.set(k, new Set());
            alias2.get(k).add(a.id);
          }
        }
      }
      for (const e of unresolved) {
        const ids = new Set();
        for (const v of [e.normalized_citation, e.raw_citation].filter(Boolean)) {
          for (const k of aliases(leanNorm(v))) {
            const hit = alias2.get(k);
            if (hit) for (const id of hit) ids.add(id);
          }
        }
        if (ids.size !== 1) continue;
        const toId = [...ids][0];
        await sql`
          update legal_authority_citations
          set to_authority_id = ${toId}
          where id = ${e.id} and to_authority_id is null
        `;
        reresolveFixed += 1;
      }
    }

    const [after] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [dup] = await sql`
      select count(*)::int as n from (
        select from_authority_id, normalized_citation
        from legal_authority_citations group by 1,2 having count(*) > 1
      ) d
    `;

    console.log(
      JSON.stringify({
        ok: true,
        classification: "ZERO_CL_CITATION_EXTRACTION_BACKFILL",
        courtListenerHttpCalls: 0,
        openaiCalls: 0,
        histOnly: HIST_ONLY,
        candidates: candidates.length,
        processed,
        failures,
        newCitationOccurrences: newOcc,
        newUniqueCitationStrings: uniqueNew.size,
        newResolvedAtInsert,
        reresolveFixed,
        before,
        after,
        resolutionPctBefore: pct(before.resolved, before.extracted),
        resolutionPctAfter: pct(after.resolved, after.extracted),
        deltaExtracted: after.extracted - before.extracted,
        deltaResolved: after.resolved - before.resolved,
        duplicateCitationEdges: dup.n,
        elapsedMs: Date.now() - started,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
