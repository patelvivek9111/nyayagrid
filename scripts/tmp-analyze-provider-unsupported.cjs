/**
 * Bucket PROVIDER_UNSUPPORTED / DEFERRED / EXTERNAL_NOT_FOUND without CL API.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  citationToBulkVrpKey,
  classifyCaseCitationLookupEligibility,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const CITE_DB = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const NEG = path.join(ROOT, "cl-identity-negative-cache-2026-10-13.json");

async function main() {
  const neg = JSON.parse(fs.readFileSync(NEG, "utf8"));
  const citeDb = new DatabaseSync(CITE_DB, { readOnly: true });
  const volumeCov = new Set(
    citeDb
      .prepare(
        "SELECT DISTINCT volume || '|' || reporter_compact AS vk FROM vrp_map WHERE volume IS NOT NULL AND reporter_compact <> ''",
      )
      .all()
      .map((r) => String(r.vk)),
  );

  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require" });
  const unresolved = await sql`
    select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
           a.court_id as from_court_id, a.court as from_court
    from legal_authority_citations e
    left join legal_authorities a on a.id = e.from_authority_id
    where e.to_authority_id is null`;
  const authorityRows = await sql`
    select id, citation, normalized_citation, metadata, source_external_id, source_provider,
           ingestion_status,
           exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities`;
  await sql.end({ timeout: 5 });

  const index = new LocalAuthorityIndex(
    authorityRows.map((a) => ({
      id: a.id,
      citation: a.citation,
      normalizedCitation: a.normalized_citation,
      metadata: a.metadata || {},
      sourceExternalId: a.source_external_id,
      sourceProvider: a.source_provider,
      ingestionStatus: a.ingestion_status,
      corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
    })),
  );
  const queue = buildUnresolvedTargetQueue(
    unresolved.map((e) => ({
      id: e.id,
      fromAuthorityId: e.from_authority_id,
      rawCitation: e.raw_citation,
      normalizedCitation: e.normalized_citation,
      createdAt: e.created_at,
      fromCourtId: e.from_court_id,
      fromCourt: e.from_court,
    })),
    index,
  );

  const unsupported = {
    RECENT_AFTER_BULK_SNAPSHOT: 0,
    REPORTER_NOT_IN_CL_BULK: 0,
    CLUSTER_MISSING: 0,
    CITATION_PARSER_MISMATCH: 0,
    OFFICIAL_SOURCE_AVAILABLE: 0,
    STATE_COURT_SOURCE_CANDIDATE: 0,
    FEDERAL_OFFICIAL_SOURCE_CANDIDATE: 0,
    OTHER_PUBLIC_DATASET_CANDIDATE: 0,
    UNKNOWN: 0,
  };
  const deferred = { providerGap: 0, collision: 0, notFound: 0, recentSnapshot: 0, normalization: 0, stillDeferred: 0 };
  const externalNf = { bulkGraphRecoverable: 0, officialSourceCandidate: 0, otherPublicSourceCandidate: 0, stillUnavailable: 0 };

  for (const t of queue.targets) {
    const el = classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation);
    if (!el.eligible) continue;
    const vrp = citationToBulkVrpKey(t.normalizedCitation) || citationToBulkVrpKey(t.representativeRaw);
    const parts = vrp ? String(vrp).split("|") : [];
    const vol = parts[0] ? Number(parts[0]) : null;
    const rep = parts[1] || "";
    const vk = parts.length >= 2 ? `${parts[0]}|${parts[1]}` : null;
    const nf = neg.notFound?.[t.targetKey];

    if (nf?.reason === "bulk_volume_absent_provider_gap") {
      if (rep === "us" && Number.isFinite(vol) && vol >= 570) unsupported.RECENT_AFTER_BULK_SNAPSHOT += t.edgeCount;
      else if (vk && !volumeCov.has(vk)) unsupported.REPORTER_NOT_IN_CL_BULK += t.edgeCount;
      else if (/^(f3d|f2d|f4th|us|sct|led2d|fsupp)/i.test(rep)) unsupported.FEDERAL_OFFICIAL_SOURCE_CANDIDATE += t.edgeCount;
      else if (/^(p|a|so|se|sw|ne|nw|idaho|or|mass|ariz|cal|tex|ill|pa|ohio)/i.test(rep))
        unsupported.STATE_COURT_SOURCE_CANDIDATE += t.edgeCount;
      else unsupported.UNKNOWN += t.edgeCount;
      continue;
    }
    if (nf) {
      if (/^(f3d|f2d|f4th|us|sct)/i.test(rep)) externalNf.officialSourceCandidate += t.edgeCount;
      else externalNf.stillUnavailable += t.edgeCount;
      continue;
    }
    // deferred / other
    if (vk && !volumeCov.has(vk)) deferred.providerGap += t.edgeCount;
    else if (!vrp) deferred.normalization += t.edgeCount;
    else deferred.notFound += t.edgeCount;
  }

  const out = { unsupported, deferred, externalNf };
  fs.writeFileSync(path.join(ROOT, "provider-unsupported-analysis-2026-10-13.json"), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
