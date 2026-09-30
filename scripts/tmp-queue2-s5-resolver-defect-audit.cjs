/**
 * Session 5 — deep audit of sampled RESOLVER_DEFECT citation edges.
 * ZERO CourtListener. Read-only.
 *
 * Env: DEFECT_IDS=uuid,uuid,...
 */
"use strict";
const postgres = require("postgres");

const IDS = String(process.env.DEFECT_IDS || process.argv[2] || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function hexDump(s) {
  return Buffer.from(String(s || ""), "utf8")
    .toString("hex")
    .match(/.{1,2}/g)
    ?.join(" ")
    .slice(0, 200);
}

function classifyRoot(edge, candidates) {
  if (!candidates.length) return "TARGET_LOOKUP";
  if (candidates.length > 1) return "AMBIGUITY_HANDLING";
  const eNorm = String(edge.normalized_citation || "");
  const eRaw = String(edge.raw_citation || "");
  const a = candidates[0];
  const aNorm = String(a.normalized_citation || "");
  const aCit = String(a.citation || "");
  if (eNorm === aNorm || eNorm === aCit) {
    // exact string equal but still unresolved → resolver query/update path
    return "DB_QUERY";
  }
  // soft equal after NFKC / section-sign normalize
  const soft = (s) =>
    String(s || "")
      .normalize("NFKC")
      .replace(/\u00a7|\u00c2\u00a7|┬º|Â§/g, "§")
      .replace(/\s+/g, " ")
      .trim();
  if (soft(eNorm) === soft(aNorm) || soft(eNorm) === soft(aCit) || soft(eRaw) === soft(aCit)) {
    return "NORMALIZATION";
  }
  if (/\d+\s*C\.?\s*F\.?\s*R/i.test(eNorm) && /\d+\s*C\.?\s*F\.?\s*R/i.test(aNorm || aCit)) {
    return "ALIAS";
  }
  return "OTHER";
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
    process.exit(2);
  }
  if (!IDS.length) {
    console.log(JSON.stringify({ ok: false, reason: "no_ids" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const edges = await sql`
      select e.id, e.raw_citation, e.normalized_citation, e.to_authority_id,
             e.from_authority_id, a.title as citing_title, a.citation as citing_citation,
             a.authority_type as citing_type
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.id = any(${IDS}::uuid[])
    `;

    const defects = [];
    for (const edge of edges) {
      const norm = edge.normalized_citation;
      const raw = edge.raw_citation;
      // exact match candidates (current resolver)
      const exact = await sql`
        select id, citation, normalized_citation, authority_type, title, source_provider
        from legal_authorities
        where (normalized_citation = ${norm} or citation = ${norm} or citation = ${raw})
        limit 20
      `;
      // soft-normalized candidates
      const softAll = await sql`
        select id, citation, normalized_citation, authority_type, title, source_provider
        from legal_authorities
        where authority_type = 'regulation'
          and (
            replace(replace(coalesce(normalized_citation,''), '§', ''), ' ', '')
              ilike '%' || replace(replace(coalesce(${norm},''), '§', ''), ' ', '') || '%'
            or replace(replace(coalesce(citation,''), '§', ''), ' ', '')
              ilike '%' || replace(replace(coalesce(${norm},''), '§', ''), ' ', '') || '%'
          )
        limit 20
      `;
      const root = classifyRoot(edge, exact);
      defects.push({
        id: edge.id,
        raw: edge.raw_citation,
        normalized: edge.normalized_citation,
        rawHex: hexDump(edge.raw_citation),
        normHex: hexDump(edge.normalized_citation),
        citingAuthorityId: edge.from_authority_id,
        citingTitle: edge.citing_title,
        citingCitation: edge.citing_citation,
        toAuthorityId: edge.to_authority_id,
        targetPresentExact: exact.length > 0,
        exactCandidateCount: exact.length,
        exactCandidates: exact.map((c) => ({
          id: c.id,
          citation: c.citation,
          normalized: c.normalized_citation,
          citationHex: hexDump(c.citation),
          normHex: hexDump(c.normalized_citation),
          type: c.authority_type,
          source: c.source_provider,
        })),
        softCandidateCount: softAll.length,
        softCandidates: softAll.slice(0, 5).map((c) => ({
          id: c.id,
          citation: c.citation,
          normalized: c.normalized_citation,
        })),
        rootCause: root,
        failurePhase:
          exact.length === 0
            ? "TARGET_LOOKUP_NO_EXACT_MATCH"
            : exact.length > 1
              ? "AMBIGUOUS_MULTI_CANDIDATE"
              : edge.to_authority_id
                ? "ALREADY_RESOLVED"
                : "EXACT_MATCH_PRESENT_BUT_UNRESOLVED",
      });
    }

    const byRoot = {};
    for (const d of defects) byRoot[d.rootCause] = (byRoot[d.rootCause] || 0) + 1;

    console.log(
      JSON.stringify(
        {
          ok: true,
          classification: "MANUAL_QUEUE2_S5_RESOLVER_DEFECT_AUDIT",
          courtListenerHttpCalls: 0,
          mutations: 0,
          sampleSize: defects.length,
          byRootCause: byRoot,
          defects,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 400) }));
  process.exit(1);
});
