#!/usr/bin/env node
/**
 * Zero-CL discovery of CA3 / EDPA / PA warrant-relevant acquisition targets.
 * Does not restart prior SCOTUS/zero-CL discovery; additive forum gap pass only.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");

const OUT = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/corpus-strengthening-pass1-forum-warrant-targets.json",
);

const FORUMS = new Set(["us-ca-3", "us-d-paed", "st-pa-high", "st-pa-super"]);
const WARRANT_RE =
  /\b(warrant|probable cause|search and seizure|fourth amendment|suppression|exclusionary|franks|knock.?and.?announce|exigent|good.?faith|particularity)\b/i;

function parseReporter(cite) {
  const t = String(cite || "").replace(/\s+/g, " ").trim();
  const specs = [
    [/^(\d{1,4})\s+F\.?\s*4th\s+(\d{1,4})$/i, (v, p) => `${v} F.4th ${p}`, "F.4th"],
    [/^(\d{1,4})\s+F\.?\s*3d\s+(\d{1,4})$/i, (v, p) => `${v} F.3d ${p}`, "F.3d"],
    [/^(\d{1,4})\s+F\.?\s*2d\s+(\d{1,4})$/i, (v, p) => `${v} F.2d ${p}`, "F.2d"],
    [/^(\d{1,4})\s+F\.?\s*Supp\.?\s*3d\s+(\d{1,4})$/i, (v, p) => `${v} F.Supp.3d ${p}`, "F.Supp.3d"],
    [/^(\d{1,4})\s+F\.?\s*Supp\.?\s*2d\s+(\d{1,4})$/i, (v, p) => `${v} F.Supp.2d ${p}`, "F.Supp.2d"],
    [/^(\d{1,4})\s+F\.?\s*Supp\.?\s+(\d{1,4})$/i, (v, p) => `${v} F.Supp. ${p}`, "F.Supp."],
    [/^(\d{1,4})\s+A\.?\s*3d\s+(\d{1,4})$/i, (v, p) => `${v} A.3d ${p}`, "A.3d"],
    [/^(\d{1,4})\s+A\.?\s*2d\s+(\d{1,4})$/i, (v, p) => `${v} A.2d ${p}`, "A.2d"],
  ];
  for (const [re, fmt, reporter] of specs) {
    const m = t.match(re);
    if (!m) continue;
    return { citation: fmt(Number(m[1]), Number(m[2])), reporter };
  }
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
  try {
    await sql.unsafe("BEGIN READ ONLY");
    const forumAuth = await sql`
      select id, citation, normalized_citation, court_id, court_level, authority_state, title, decision_date
      from legal_authorities
      where authority_type = 'case'
        and court_id in ('us-ca-3', 'us-d-paed', 'st-pa-high', 'st-pa-super')
    `;
    const chunks = await sql`
      select authority_id, content
      from legal_authority_chunks
      where authority_id in ${sql(forumAuth.map((a) => a.id))}
        and chunk_index < 3
    `;
    await sql.unsafe("COMMIT");

    const warrantAuthIds = new Set();
    const byAuthContent = new Map();
    for (const c of chunks) {
      const prev = byAuthContent.get(c.authority_id) || "";
      byAuthContent.set(c.authority_id, prev + "\n" + (c.content || ""));
    }
    for (const a of forumAuth) {
      const text = `${a.title || ""}\n${byAuthContent.get(a.id) || ""}`;
      if (WARRANT_RE.test(text)) warrantAuthIds.add(a.id);
    }

    const warrantForum = forumAuth.filter((a) => warrantAuthIds.has(a.id));
    const forumCounts = {};
    for (const a of forumAuth) {
      forumCounts[a.court_id] = forumCounts[a.court_id] || { total: 0, warrantRelevant: 0 };
      forumCounts[a.court_id].total += 1;
      if (warrantAuthIds.has(a.id)) forumCounts[a.court_id].warrantRelevant += 1;
    }

    // Unresolved edges from warrant-relevant forum authorities, reporter-shaped only.
    const unresolved =
      warrantForum.length === 0
        ? []
        : await (async () => {
            const sql2 = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
            try {
              await sql2.unsafe("BEGIN READ ONLY");
              const rows = await sql2`
                select
                  coalesce(nullif(btrim(e.normalized_citation), ''), btrim(e.raw_citation)) as cite,
                  count(*)::int as edges,
                  array_agg(distinct a.court_id) as source_courts
                from legal_authority_citations e
                join legal_authorities a on a.id = e.from_authority_id
                where e.to_authority_id is null
                  and a.id in ${sql2(warrantForum.map((x) => x.id))}
                group by 1
                order by count(*) desc
                limit 400
              `;
              await sql2.unsafe("COMMIT");
              return rows;
            } finally {
              await sql2.end({ timeout: 5 });
            }
          })();

    const presentRows = await (async () => {
      const sql2 = postgres(url, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
      try {
        return await sql2`
          select normalized_citation, citation from legal_authorities
          where authority_type = 'case'
            and (normalized_citation is not null or citation is not null)
        `;
      } finally {
        await sql2.end({ timeout: 5 });
      }
    })();
    const presentNorms = new Set();
    for (const r of presentRows) {
      if (r.normalized_citation) presentNorms.add(r.normalized_citation);
      if (r.citation) presentNorms.add(r.citation);
    }

    const targets = [];
    for (const row of unresolved) {
      const parsed = parseReporter(row.cite);
      if (!parsed) continue;
      if (presentNorms.has(parsed.citation)) continue;
      // Prefer federal reporter / Atlantic for forum depth; skip U.S. (handled in SCOTUS batch)
      if (/^U\.S\./i.test(parsed.reporter)) continue;
      targets.push({
        citation: parsed.citation,
        reporter: parsed.reporter,
        incomingUnresolvedEdges: row.edges,
        sourceCourts: row.source_courts,
        role: "forum_warrant_depth_candidate",
        alreadyInCorpus: false,
      });
    }

    // Dedup and take top by edges
    const byCite = new Map();
    for (const t of targets) {
      const prev = byCite.get(t.citation);
      if (!prev || t.incomingUnresolvedEdges > prev.incomingUnresolvedEdges) byCite.set(t.citation, t);
    }
    const ranked = [...byCite.values()].sort((a, b) => b.incomingUnresolvedEdges - a.incomingUnresolvedEdges);

    // Seed classic PA / CA3 / EDPA warrant-ish reporter targets if still absent (bounded).
    const seed = [
      "392 F.2d 641", // US v. Ventresca often cited; may already exist as US reports path
      "509 F.2d 1232",
      "637 F.2d 914",
      "724 F.2d 370",
      "849 F.2d 839",
      "942 F.2d 226",
      "55 F.3d 820",
      "119 F.3d 1070",
      "221 F.3d 428",
      "326 F.3d 367",
      "453 F.3d 150",
      "599 F.3d 298",
      "704 F.3d 239",
      "825 F.3d 130",
      "942 F.3d 114",
      "47 A.3d 1176",
      "75 A.3d 485",
      "105 A.3d 1257",
      "150 A.3d 970",
      "218 A.3d 404",
      "68 A.2d 360",
      "277 A.2d 159",
      "439 A.2d 1149",
      "526 A.2d 319",
      "628 A.2d 1143",
      "75 F.Supp.2d 411",
      "248 F.Supp.2d 393",
      "390 F.Supp.2d 471",
      "531 F.Supp.2d 652",
    ];
    for (const cite of seed) {
      const parsed = parseReporter(cite);
      if (!parsed) continue;
      if (presentNorms.has(parsed.citation)) continue;
      if (byCite.has(parsed.citation)) continue;
      ranked.push({
        citation: parsed.citation,
        reporter: parsed.reporter,
        incomingUnresolvedEdges: 0,
        sourceCourts: [],
        role: "forum_warrant_seed_candidate",
        alreadyInCorpus: false,
        caution: "Seed candidate; acquire only via citation-lookup verification. Do not invent holdings.",
      });
    }

    const pick = ranked.slice(0, 20);
    const payload = {
      ok: true,
      classification: "PASS1_FORUM_WARRANT_TARGET_DISCOVERY",
      generatedAt: new Date().toISOString(),
      courtListenerHttpCalls: 0,
      mutations: 0,
      forumCounts,
      warrantRelevantForumAuthorities: warrantForum.map((a) => ({
        id: a.id,
        citation: a.citation,
        courtId: a.court_id,
        title: a.title,
        date: a.decision_date,
      })),
      proposedAcquireBatch: pick,
      notes: [
        "Zero-CL discovery only. Acquire via citation-lookup verified ingest; no search fallback.",
        "Do not restart completed SCOTUS five-target or prior zero-CL compact-resolve work.",
        "Treatment remains TREATMENT_UNVERIFIED until source-holding review.",
      ],
    };
    fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
    console.log(
      JSON.stringify({
        ok: true,
        out: path.basename(OUT),
        forumCounts,
        warrantRelevantForumAuthorities: warrantForum.length,
        proposed: pick.length,
        top: pick.slice(0, 10).map((t) => ({ citation: t.citation, edges: t.incomingUnresolvedEdges, role: t.role })),
        courtListenerHttpCalls: 0,
      }),
    );
  } catch (e) {
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500), courtListenerHttpCalls: 0 }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
