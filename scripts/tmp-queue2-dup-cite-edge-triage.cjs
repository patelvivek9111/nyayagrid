#!/usr/bin/env node
/**
 * Triage duplicateCitationEdges metric — classify true dups vs legitimate repeats.
 * ZERO CourtListener. Mutations only if APPLY=1 and true exact duplicates proven.
 */
"use strict";
const postgres = require("postgres");

async function main() {
  const url = process.env.DATABASE_URL;
  const apply = process.env.APPLY === "1" || process.argv.includes("--apply");
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "no_db" }));
    process.exit(2);
  }
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 5, connect_timeout: 30 });
  try {
    const groups = await sql`
      select
        from_authority_id,
        coalesce(normalized_citation, raw_citation) as cite_key,
        coalesce(to_authority_id::text, '') as target_key,
        count(*)::int as n,
        array_agg(id::text order by created_at, id) as edge_ids,
        array_agg(raw_citation order by created_at, id) as raws,
        array_agg(coalesce(normalized_citation,'') order by created_at, id) as norms,
        array_agg(coalesce(to_authority_id::text,'') order by created_at, id) as targets,
        array_agg(coalesce(pinpoint,'') order by created_at, id) as pinpoints,
        array_agg(created_at order by created_at, id) as created_ats
      from legal_authority_citations
      group by 1, 2, 3
      having count(*) > 1
      order by n desc, cite_key
      limit 50
    `;

    const classified = [];
    const trueDupEdgeIdsToDelete = [];

    for (const g of groups) {
      const pinpoints = g.pinpoints || [];
      const distinctPins = [...new Set(pinpoints.filter((p) => p && String(p).trim()))];
      const sameRaw = new Set(g.raws).size === 1;
      const sameNorm = new Set(g.norms).size === 1;
      const sameTarget = new Set(g.targets).size === 1;
      // Legitimate if different pinpoints for same cite from same authority
      const legitimateRepeat = distinctPins.length > 1;
      // Exact duplicate OR raw-whitespace variant that already shares normalized form
      const trueDuplicate =
        !legitimateRepeat &&
        sameNorm &&
        sameTarget &&
        (distinctPins.length <= 1) &&
        (sameRaw || sameNorm);

      const keepId = g.edge_ids[0];
      const dropIds = trueDuplicate ? g.edge_ids.slice(1) : [];
      if (trueDuplicate) trueDupEdgeIdsToDelete.push(...dropIds);

      classified.push({
        fromAuthorityId: g.from_authority_id,
        citeKey: g.cite_key,
        targetKey: g.target_key || null,
        count: g.n,
        sameCitingAuthority: true,
        sameRawCitation: sameRaw,
        sameNormalizedCitation: sameNorm,
        sameResolvedTarget: sameTarget,
        distinctPinpoints: distinctPins,
        classification: trueDuplicate
          ? sameRaw
            ? "TRUE_DUPLICATE"
            : "TRUE_DUPLICATE_RAW_VARIANT"
          : legitimateRepeat
            ? "LEGITIMATE_REPEAT_PINPOINT"
            : "NEEDS_REVIEW",
        keepEdgeId: keepId,
        dropEdgeIds: dropIds,
        edgeIds: g.edge_ids,
        raws: g.raws,
        norms: g.norms,
        createdAts: g.created_ats,
      });
    }

    let deleted = 0;
    if (apply && trueDupEdgeIdsToDelete.length) {
      const del = await sql`
        delete from legal_authority_citations
        where id = any(${trueDupEdgeIdsToDelete}::uuid[])
        returning id
      `;
      deleted = del.length;
    }

    const [after] = await sql`
      select count(*)::int as n from (
        select 1 from legal_authority_citations
        group by from_authority_id, coalesce(normalized_citation, raw_citation), coalesce(to_authority_id::text,'')
        having count(*) > 1
      ) d
    `;

    console.log(
      JSON.stringify({
        ok: true,
        classification: "QUEUE2_DUPLICATE_CITATION_EDGE_TRIAGE",
        courtListenerHttpCalls: 0,
        apply,
        groupCount: groups.length,
        trueDuplicates: classified.filter((c) =>
          c.classification === "TRUE_DUPLICATE" || c.classification === "TRUE_DUPLICATE_RAW_VARIANT",
        ).length,
        trueDuplicateExact: classified.filter((c) => c.classification === "TRUE_DUPLICATE").length,
        trueDuplicateRawVariant: classified.filter((c) => c.classification === "TRUE_DUPLICATE_RAW_VARIANT")
          .length,
        legitimateRepeats: classified.filter((c) => c.classification === "LEGITIMATE_REPEAT_PINPOINT")
          .length,
        needsReview: classified.filter((c) => c.classification === "NEEDS_REVIEW").length,
        edgesEligibleForSafeDelete: trueDupEdgeIdsToDelete.length,
        deleted,
        duplicateGroupCountAfter: after.n,
        groups: classified,
        note:
          "Metric groups by (from, normalized|raw, target). TRUE_DUPLICATE = identical cite+target+pinpoint from same authority. LEGITIMATE_REPEAT = distinct pinpoints.",
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 500) }));
  process.exit(1);
});
