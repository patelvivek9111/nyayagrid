/**
 * Zero-CL present-but-not-matched + citation baseline audit.
 * Deterministic only. ZERO CourtListener HTTP.
 */
"use strict";
const postgres = require("postgres");
const {
  leanNormalizeCitation,
  citationLookupAliases,
  classifyCitationFamily,
  isGarbageCitation,
} = require("./wave2f-citation-audit.cjs");

function parseVolReporterPage(cite) {
  const t = String(cite || "").replace(/\s+/g, " ").trim();
  let m = t.match(/^(\d{1,3})\s+U\.?\s*S\.?\s+(\d{1,4})$/i);
  if (m) return { family: "us_reports", volume: Number(m[1]), page: Number(m[2]), reporter: "U.S." };
  m = t.match(/^(\d{1,4})\s+F\.?\s*(2d|3d|4th)\s+(\d{1,4})$/i);
  if (m) return { family: "federal_reporter", volume: Number(m[1]), page: Number(m[3]), reporter: `F.${m[2].toLowerCase()}` };
  m = t.match(/^(\d{1,4})\s+F\.?\s*Supp\.?\s*(2d|3d|4th)?\s+(\d{1,4})$/i);
  if (m) return { family: "federal_supplement", volume: Number(m[1]), page: Number(m[3]), reporter: m[2] ? `F. Supp. ${m[2].toLowerCase()}` : "F. Supp." };
  return null;
}

function keyOf(p) {
  return `${p.family}|${p.volume}|${p.reporter}|${p.page}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const [graph] = await sql`
      select count(*)::int as extracted,
             count(*) filter (where to_authority_id is not null)::int as resolved,
             count(*) filter (where to_authority_id is null)::int as unresolved
      from legal_authority_citations
    `;
    const [corpus] = await sql`
      select count(*)::int as authorities,
             count(*) filter (where authority_type='case')::int as cases,
             count(*) filter (where authority_type='case' and source_provider='courtlistener')::int as cl_cases
      from legal_authorities
    `;
    const [chunks] = await sql`
      select count(*)::int as chunks,
             count(*) filter (where embedding is not null)::int as embeddings,
             count(*) filter (where embedding is null)::int as missing_embeddings
      from legal_authority_chunks
    `;
    const orphans = await sql`
      select count(*)::int as n from legal_authority_chunks c
      left join legal_authorities a on a.id = c.authority_id where a.id is null
    `;
    const dupes = await sql`
      select count(*)::int as n from (
        select source_provider, source_external_id from legal_authorities
        where source_external_id is not null group by 1,2 having count(*)>1
      ) d
    `;

    const authorities = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider, court, decision_date
      from legal_authorities
    `;
    const unresolved = await sql`
      select id, raw_citation, normalized_citation
      from legal_authority_citations
      where to_authority_id is null
    `;

    // Alias index (same as resolver)
    const aliasIndex = new Map();
    const vrpIndex = new Map(); // volume/reporter/page -> authority ids
    for (const a of authorities) {
      const keys = new Set();
      for (const v of [a.normalized_citation, a.citation].filter(Boolean)) {
        const lean = leanNormalizeCitation(v) || v;
        for (const k of citationLookupAliases(lean)) keys.add(k);
        for (const k of citationLookupAliases(v)) keys.add(k);
        const p = parseVolReporterPage(leanNormalizeCitation(v) || v);
        if (p) {
          const vk = keyOf(p);
          if (!vrpIndex.has(vk)) vrpIndex.set(vk, new Set());
          vrpIndex.get(vk).add(a.id);
        }
      }
      const meta = a.metadata && typeof a.metadata === "object" ? a.metadata : {};
      for (const alias of [...(meta.citationAliases || []), ...(meta.parallelCitations || [])]) {
        if (typeof alias !== "string" || !alias.trim()) continue;
        const lean = leanNormalizeCitation(alias) || alias.trim();
        for (const k of citationLookupAliases(lean)) keys.add(k);
        const p = parseVolReporterPage(lean);
        if (p) {
          const vk = keyOf(p);
          if (!vrpIndex.has(vk)) vrpIndex.set(vk, new Set());
          vrpIndex.get(vk).add(a.id);
        }
      }
      if (a.source_provider === "courtlistener" && a.source_external_id) keys.add(`ext:${a.source_external_id}`);
      for (const k of keys) {
        if (!aliasIndex.has(k)) aliasIndex.set(k, new Set());
        aliasIndex.get(k).add(a.id);
      }
    }

    let catA = 0; // definitely present and matchable (alias)
    let catB = 0; // ambiguous
    let catC = 0; // not present
    let vrpOnly = 0; // volume/page present but alias miss — potential gap
    let malformed = 0;
    const catAExamples = [];
    const vrpOnlyExamples = [];
    const familyAbsent = {};
    const absentGroups = new Map();

    for (const e of unresolved) {
      const raw = e.raw_citation || "";
      const norm = e.normalized_citation || "";
      const lean = leanNormalizeCitation(norm) || leanNormalizeCitation(raw) || norm || raw;
      const family = classifyCitationFamily(raw, lean);
      if (isGarbageCitation(raw) && isGarbageCitation(norm)) {
        malformed += 1;
        continue;
      }

      const keys = new Set();
      for (const v of [lean, raw, norm].filter(Boolean)) {
        for (const k of citationLookupAliases(v)) keys.add(k);
        const l = leanNormalizeCitation(v);
        if (l) for (const k of citationLookupAliases(l)) keys.add(k);
      }
      const ids = new Set();
      for (const k of keys) {
        const hit = aliasIndex.get(k);
        if (hit) for (const id of hit) ids.add(id);
      }

      if (ids.size === 1) {
        catA += 1;
        if (catAExamples.length < 20) catAExamples.push({ raw, lean, to: [...ids][0], family });
        continue;
      }
      if (ids.size > 1) {
        catB += 1;
        continue;
      }

      const p = parseVolReporterPage(lean);
      if (p) {
        const vk = keyOf(p);
        const vrpHits = vrpIndex.get(vk);
        if (vrpHits && vrpHits.size === 1) {
          vrpOnly += 1;
          if (vrpOnlyExamples.length < 20) {
            vrpOnlyExamples.push({ raw, lean, to: [...vrpHits][0], family, key: vk });
          }
          continue;
        }
        if (vrpHits && vrpHits.size > 1) {
          catB += 1;
          continue;
        }
      }

      catC += 1;
      familyAbsent[family] = (familyAbsent[family] || 0) + 1;
      const gKey = lean || raw || "(empty)";
      if (!absentGroups.has(gKey)) {
        absentGroups.set(gKey, {
          citation: gKey,
          family,
          edges: 0,
          citing: new Set(),
          parsed: p,
        });
      }
      const g = absentGroups.get(gKey);
      g.edges += 1;
      // from_authority not selected; approximate by edge count uniqueness later
    }

    // Re-query for unique citing authorities per absent target
    const topAbsent = [];
    const ranked = [...absentGroups.values()].sort((a, b) => b.edges - a.edges).slice(0, 80);
    for (const g of ranked) {
      const rows = await sql`
        select count(*)::int as edges,
               count(distinct from_authority_id)::int as citing
        from legal_authority_citations
        where to_authority_id is null
          and (
            normalized_citation = ${g.citation}
            or raw_citation = ${g.citation}
            or coalesce(normalized_citation, raw_citation) = ${g.citation}
          )
      `;
      // also check presence
      const present = await sql`
        select id, citation, normalized_citation, source_external_id
        from legal_authorities
        where normalized_citation = ${g.citation}
           or citation = ${g.citation}
           or normalized_citation ilike ${g.citation}
           or citation ilike ${g.citation}
        limit 3
      `;
      topAbsent.push({
        citation: g.citation,
        family: g.family,
        reporter: g.parsed?.reporter || null,
        unresolvedEdges: rows[0]?.edges || g.edges,
        uniqueCitingAuthorities: rows[0]?.citing || g.edges,
        present: present.length > 0,
        authorityId: present[0]?.id || null,
        recommendedPath: present.length
          ? "existing_corpus_reresolve"
          : g.family === "us_reports"
            ? "future_zero_cl_intake_or_next_cl_a2"
            : g.family === "federal_reporter"
              ? "next_cl_a2"
              : g.family === "usc" || g.family === "cfr" || g.family === "federal_rules"
                ? "future_zero_cl_intake"
                : "next_cl_a2",
      });
    }

    const usReports = topAbsent.filter((t) => t.family === "us_reports" && !t.present).slice(0, 50);
    const fRep = topAbsent.filter((t) => t.family === "federal_reporter" && !t.present);
    // If top 80 isn't enough for F.3d, pull dedicated ranking
    let fRepTop = fRep.slice(0, 50);
    if (fRepTop.length < 50) {
      const fEdges = await sql`
        select coalesce(normalized_citation, raw_citation) as cite, count(*)::int as edges,
               count(distinct from_authority_id)::int as citing
        from legal_authority_citations
        where to_authority_id is null
          and coalesce(normalized_citation, raw_citation) ~* '^\\d{1,4}\\s+F\\.\\s?(2d|3d|4th)\\s+\\d'
          and coalesce(normalized_citation, raw_citation) !~* 'Supp'
        group by 1
        order by edges desc
        limit 50
      `;
      fRepTop = [];
      for (const row of fEdges) {
        const lean = leanNormalizeCitation(row.cite) || row.cite;
        const present = await sql`
          select id from legal_authorities
          where normalized_citation = ${lean} or citation = ${lean}
             or normalized_citation ilike ${lean} or citation ilike ${lean}
          limit 1
        `;
        fRepTop.push({
          citation: lean,
          family: "federal_reporter",
          unresolvedEdges: row.edges,
          uniqueCitingAuthorities: row.citing,
          present: present.length > 0,
          authorityId: present[0]?.id || null,
          recommendedPath: present.length ? "existing_corpus_reresolve" : "next_cl_a2",
        });
      }
    }

    // Dedicated US Reports top 50 if needed
    let usTop = usReports;
    if (usTop.length < 50) {
      const usEdges = await sql`
        select coalesce(normalized_citation, raw_citation) as cite, count(*)::int as edges,
               count(distinct from_authority_id)::int as citing
        from legal_authority_citations
        where to_authority_id is null
          and coalesce(normalized_citation, raw_citation) ~* '^\\d{1,3}\\s+U\\.?\\s*S\\.?\\s+\\d'
        group by 1
        order by edges desc
        limit 50
      `;
      usTop = [];
      for (const row of usEdges) {
        const lean = leanNormalizeCitation(row.cite) || row.cite;
        const present = await sql`
          select id from legal_authorities
          where normalized_citation = ${lean} or citation = ${lean}
             or normalized_citation ilike ${lean} or citation ilike ${lean}
          limit 1
        `;
        usTop.push({
          citation: lean,
          family: "us_reports",
          unresolvedEdges: row.edges,
          uniqueCitingAuthorities: row.citing,
          present: present.length > 0,
          authorityId: present[0]?.id || null,
          recommendedPath: present.length
            ? "existing_corpus_reresolve"
            : "future_zero_cl_intake_or_next_cl_a2",
        });
      }
    }

    const presentInTop = topAbsent.filter((t) => t.present);
    const rate = graph.extracted ? Number(((100 * graph.resolved) / graph.extracted).toFixed(2)) : 0;

    console.log(
      JSON.stringify({
        ok: true,
        courtListenerHttpCalls: 0,
        mutations: 0,
        generatedAt: new Date().toISOString(),
        citationBaseline: {
          extracted: graph.extracted,
          resolved: graph.resolved,
          unresolved: graph.unresolved,
          targetAbsent: catC,
          malformed,
          presentButNotMatched_aliasExact: catA,
          ambiguous: catB,
          vrpPresentAliasMiss: vrpOnly,
          resolutionRatePct: rate,
        },
        presentButNotMatched: {
          categoryA_definitelyPresentMatchable: catA,
          categoryB_ambiguous: catB,
          categoryC_notPresent: catC,
          vrpOnlyPotentialGap: vrpOnly,
          catAExamples,
          vrpOnlyExamples,
          verdict:
            catA === 0 && vrpOnly === 0
              ? "NO_DETERMINISTIC_PRESENT_BUT_UNMATCHED"
              : catA > 0
                ? "RESOLVER_GAP_CATEGORY_A"
                : "INVESTIGATE_VRP_ONLY",
        },
        familyAbsent,
        topAbsentRemaining: topAbsent.filter((t) => !t.present).slice(0, 40),
        top50UsReportsRemaining: usTop.filter((t) => !t.present),
        top50FederalReporterRemaining: fRepTop.filter((t) => !t.present),
        alreadyPresentHighImpact: presentInTop,
        corpus,
        chunks,
        orphanCount: orphans[0]?.n || 0,
        duplicateSourceIds: dupes[0]?.n || 0,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500), courtListenerHttpCalls: 0 }));
  process.exit(1);
});
