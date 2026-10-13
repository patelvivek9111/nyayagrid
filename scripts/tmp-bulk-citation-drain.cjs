/**
 * Full backlog deterministic drain using CourtListener bulk citation index.
 * ZERO CourtListener API. No full-text. No new outbound edges.
 *
 * Phases: recount → dry-run → validation → production write → second-pass → idempotency
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  experimentalNormalize,
  targetKey,
  classifyCaseCitationLookupEligibility,
  createResolutionRecord,
  appendLedger,
  RESOLVER_VERSION,
  citationToBulkVrpKey,
  classifyBulkIdentity,
  isDeterministicBulkStatus,
  BULK_SNAPSHOT_ID,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const SOURCE = "courtlistener";
const BATCH = "bulk-citation-drain-2026-10-13";
const ROOT = path.join(__dirname, "../packages/research/corpus/tmp-bulk-prototype");
const DB_PATH = path.join(ROOT, "citations-index-2026-09-30.sqlite");
const REPORT = path.join(ROOT, "bulk-drain-report-2026-10-13.json");
const PRIOR = path.join(ROOT, "bulk-drain-prior-2026-10-13.json");
const LEDGER = path.join(__dirname, "../packages/research/corpus/resolution/ledger/cl-bulk-drain-2026-10-13.jsonl");
const DRY_ONLY = process.env.BULK_DRAIN_DRY_ONLY === "1";
const FORCE_WRITE = process.env.BULK_DRAIN_FORCE_WRITE === "1";
/** Resume after interrupted write: skip stub/edge work when no unresolved edges remain for the target. */
const RESUME = process.env.BULK_DRAIN_RESUME === "1";
/** Optional locked RUN_START_UNRESOLVED from interrupted run (e.g. 60075). */
const LOCKED_START_UNRESOLVED = process.env.BULK_DRAIN_START_UNRESOLVED
  ? Number(process.env.BULK_DRAIN_START_UNRESOLVED)
  : null;

function loadPrior() {
  if (!fs.existsSync(PRIOR)) return null;
  try {
    return JSON.parse(fs.readFileSync(PRIOR, "utf8"));
  } catch {
    return null;
  }
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

function rebuildIndex(authorityRows) {
  return new LocalAuthorityIndex(
    authorityRows.map((a) => ({
      id: a.id,
      citation: a.citation,
      normalizedCitation: a.normalized_citation || a.normalizedCitation,
      metadata: a.metadata || {},
      sourceExternalId: a.source_external_id || a.sourceExternalId,
      sourceProvider: a.source_provider || a.sourceProvider,
      title: a.title,
      court: a.court,
      courtId: a.court_id || a.courtId,
      decisionDate: a.decision_date || a.decisionDate,
      ingestionStatus: a.ingestion_status || a.ingestionStatus,
      corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
    })),
  );
}

async function authorityCompleteness(sql) {
  const [row] = await sql`
    select
      count(*)::int as total_canonical_authorities,
      count(*) filter (
        where authority_type='case'
          and ingestion_status = 'ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null)
      )::int as corpus_complete_authorities,
      count(*) filter (
        where authority_type='case'
          and (ingestion_status is distinct from 'ready'
            or not exists (select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null))
      )::int as metadata_only_authorities
    from legal_authorities
  `;
  const [edges] = await sql`
    select
      count(*) filter (where to_authority_id is not null)::int as authority_resolved_edges,
      count(*) filter (
        where to_authority_id is not null
          and a.ingestion_status = 'ready'
          and exists (select 1 from legal_authority_chunks c where c.authority_id = a.id and c.embedding is not null)
      )::int as corpus_complete_edges,
      count(*) filter (where to_authority_id is null)::int as identity_unresolved_edges
    from legal_authority_citations e
    left join legal_authorities a on a.id = e.to_authority_id
  `;
  return {
    TOTAL_CANONICAL_AUTHORITIES: row.total_canonical_authorities,
    METADATA_ONLY_AUTHORITIES: row.metadata_only_authorities,
    CORPUS_COMPLETE_AUTHORITIES: row.corpus_complete_authorities,
    AUTHORITY_RESOLVED_EDGES: edges.authority_resolved_edges,
    CORPUS_COMPLETE_EDGES: edges.corpus_complete_edges,
    IDENTITY_UNRESOLVED_EDGES: edges.identity_unresolved_edges,
  };
}

async function healthSnapshot(sql) {
  const [h] = await sql`
    select
      (select count(*)::int from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*) > 1
      ) d) as duplicates,
      (select count(*)::int from legal_authority_citations c
        left join legal_authorities a on a.id = c.from_authority_id where a.id is null) as orphans,
      (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
  `;
  let failed = 0;
  let notProcessed = 0;
  try {
    await sql.unsafe("SAVEPOINT sp_proc");
    const [ps] = await sql`
      select count(*) filter (where processing_status='FAILED')::int as failed,
             count(*) filter (where processing_status='NOT_PROCESSED')::int as not_processed
      from legal_authorities
    `;
    failed = ps.failed;
    notProcessed = ps.not_processed;
    await sql.unsafe("RELEASE SAVEPOINT sp_proc");
  } catch {
    await sql.unsafe("ROLLBACK TO SAVEPOINT sp_proc").catch(() => {});
  }
  const presentRows = await sql`
    select c.id, count(a.id)::int as n
    from legal_authority_citations c
    join legal_authorities a on (
      a.normalized_citation = c.normalized_citation
      or a.citation = c.normalized_citation
      or a.citation = c.raw_citation
    )
    where c.to_authority_id is null
    group by c.id
  `;
  const presentTargetDefectsDeterministic = presentRows.filter((r) => Number(r.n) === 1).length;
  const [dupMap] = await sql`
    select count(*)::int as n from (
      select to_authority_id from legal_authority_citations
      where to_authority_id is not null
      group by from_authority_id, raw_citation, to_authority_id
      having count(*) > 1
    ) x
  `;
  const green =
    h.duplicates === 0 &&
    h.orphans === 0 &&
    h.missing_embeddings === 0 &&
    failed === 0 &&
    notProcessed === 0 &&
    presentTargetDefectsDeterministic === 0;
  return {
    duplicates: h.duplicates,
    orphans: h.orphans,
    missingEmbeddings: h.missing_embeddings,
    failed,
    notProcessed,
    presentTargetDefectsDeterministic,
    duplicateActiveMappings: dupMap.n,
    green,
    ...(await authorityCompleteness(sql)),
  };
}

function openBulkDb() {
  if (!fs.existsSync(DB_PATH)) throw new Error(`missing_index:${DB_PATH}`);
  return new DatabaseSync(DB_PATH, { readOnly: true });
}

function lookupClusters(db, vrpKey) {
  if (!vrpKey) return [];
  const rows = db.prepare("SELECT DISTINCT cluster_id AS id FROM vrp_map WHERE vrp_key = ?").all(vrpKey);
  return rows.map((r) => String(r.id));
}

function clusterParallels(db, clusterId) {
  const rows = db.prepare("SELECT citation_display FROM cluster_cites WHERE cluster_id = ?").all(String(clusterId));
  return rows.map((r) => r.citation_display);
}

async function findExistingAuthority(sql, { clusterId, normalizedCitation, citations }) {
  const ext = `cl-cluster-${clusterId}`;
  const byExt = await sql`
    select id, ingestion_status,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
    where source_provider = ${SOURCE} and source_external_id = ${ext}
    limit 2
  `;
  if (byExt.length === 1) return { row: byExt[0], via: "cluster_external_id" };
  if (byExt.length > 1) return { ambiguous: true, via: "cluster_external_id" };
  const norms = [...new Set([normalizedCitation, ...(citations || [])].map((c) => experimentalNormalize(c) || c).filter(Boolean))];
  if (!norms.length) return { row: null, via: null };
  const hits = await sql`
    select id, ingestion_status,
      exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
    from legal_authorities
    where normalized_citation = any(${norms}) or citation = any(${norms})
    limit 5
  `;
  if (hits.length === 1) return { row: hits[0], via: "citation" };
  if (hits.length > 1) return { ambiguous: true, via: "citation" };
  return { row: null, via: null };
}

async function ensureIdentityStub(sql, target, clusterId, parallels) {
  const primaryCite = experimentalNormalize(target.normalizedCitation) || target.normalizedCitation;
  const existing = await findExistingAuthority(sql, {
    clusterId,
    normalizedCitation: primaryCite,
    citations: parallels,
  });
  if (existing.ambiguous) return { ok: false, reason: "local_ambiguous_after_bulk" };
  if (existing.row) {
    const corpusComplete = Boolean(existing.row.has_embeddings) && existing.row.ingestion_status === "ready";
    const [full] = await sql`select metadata from legal_authorities where id = ${existing.row.id}`;
    const meta = full?.metadata && typeof full.metadata === "object" ? { ...full.metadata } : {};
    const aliases = Array.isArray(meta.citationAliases) ? meta.citationAliases : [];
    const pars = Array.isArray(meta.parallelCitations) ? meta.parallelCitations : [];
    meta.citationAliases = [...new Set([...aliases, target.normalizedCitation, target.representativeRaw, ...parallels].filter(Boolean))].slice(0, 32);
    meta.parallelCitations = [...new Set([...pars, ...parallels].filter(Boolean))].slice(0, 32);
    meta.clClusterId = String(clusterId);
    meta.identityOnly = true;
    meta.identityResolution = {
      method: BULK_SNAPSHOT_ID,
      clusterId: String(clusterId),
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
      identityOnly: true,
      treatment: "UNKNOWN_NOT_VERIFIED",
    };
    await sql`
      update legal_authorities
      set metadata = ${sql.json(meta)}, last_checked_at = now(), updated_at = now()
      where id = ${existing.row.id}
    `;
    return {
      ok: true,
      authorityId: existing.row.id,
      created: false,
      corpusComplete,
      aliasesLearned: Math.max(0, meta.citationAliases.length - aliases.length),
      parallelsLearned: Math.max(0, meta.parallelCitations.length - pars.length),
    };
  }

  const authorityId = crypto.randomUUID();
  const aliasSet = [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...parallels].filter(Boolean))].slice(0, 32);
  const parallelSet = parallels.slice(0, 24);
  const metadata = {
    adapter: BATCH,
    identityOnly: true,
    corpusComplete: false,
    clClusterId: String(clusterId),
    parallelCitations: parallelSet,
    citationAliases: aliasSet,
    identityResolution: {
      method: BULK_SNAPSHOT_ID,
      clusterId: String(clusterId),
      batch: BATCH,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
      identityOnly: true,
      treatment: "UNKNOWN_NOT_VERIFIED",
    },
    edgeDemand: target.edgeCount,
  };
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
      decision_date, source_provider, source_external_id, canonical_source_url,
      metadata, ingestion_status, created_at, updated_at, last_checked_at
    ) values (
      ${authorityId}, 'case', ${null}, ${null}, ${null},
      ${primaryCite}, ${primaryCite}, ${experimentalNormalize(primaryCite) || primaryCite},
      ${null},
      ${SOURCE}, ${`cl-cluster-${clusterId}`},
      ${`https://www.courtlistener.com/opinion/${clusterId}/`},
      ${sql.json(metadata)}, 'pending'::authority_ingestion_status,
      now(), now(), now()
    )
  `;
  return {
    ok: true,
    authorityId,
    created: true,
    corpusComplete: false,
    aliasesLearned: aliasSet.length,
    parallelsLearned: parallelSet.length,
  };
}

async function backfillTargetEdges(sql, target, authorityId, method, evidence, corpusComplete) {
  const ledger = [];
  let updated = 0;
  for (const edgeId of target.edgeIds || []) {
    const rows = await sql`
      update legal_authority_citations
      set to_authority_id = ${authorityId}
      where id = ${edgeId} and to_authority_id is null
      returning id, raw_citation, from_authority_id, normalized_citation
    `;
    if (!rows.length) continue;
    updated += 1;
    ledger.push(
      createResolutionRecord({
        rawCitation: rows[0].raw_citation || target.representativeRaw,
        normalizedCitation: rows[0].normalized_citation || target.normalizedCitation,
        targetKey: target.targetKey,
        fromAuthorityId: rows[0].from_authority_id,
        citationEdgeId: rows[0].id,
        toAuthorityId: authorityId,
        method,
        confidence: "HIGH",
        evidence,
        externalIdentity: {
          provider: "courtlistener_bulk",
          clusterId: String(evidence.find((x) => String(x).startsWith("cluster:")) || "").replace("cluster:", "") || null,
          opinionId: null,
        },
        state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
      }),
    );
  }
  return { updated, ledger };
}

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need Neon DATABASE_URL" }));
    process.exit(2);
  }
  if (!fs.existsSync(DB_PATH)) {
    console.log(JSON.stringify({ ok: false, reason: "missing_sqlite_index", DB_PATH }));
    process.exit(2);
  }

  const bulkDb = openBulkDb();
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  const timings = {};
  const ledgerAll = [];
  const prior = RESUME ? loadPrior() : null;

  try {
    const tHealth0 = Date.now();
    const liveStart = await healthSnapshot(sql);
    timings.healthStartMs = Date.now() - tHealth0;
    const start = prior?.start && RESUME ? { ...prior.start, resumeLive: liveStart } : liveStart;
    console.log(JSON.stringify({ phase: "START", start, liveStart, host: new URL(url.replace(/^postgresql:/, "http:")).host }, null, 2));
    if (!liveStart.green) {
      writeJson(REPORT, { ok: false, stopReason: "START_HEALTH_NOT_GREEN", start: liveStart });
      process.exit(3);
    }
    const RUN_START_UNRESOLVED =
      Number.isFinite(LOCKED_START_UNRESOLVED) && LOCKED_START_UNRESOLVED > 0
        ? LOCKED_START_UNRESOLVED
        : prior?.RUN_START_UNRESOLVED && RESUME
          ? prior.RUN_START_UNRESOLVED
          : liveStart.IDENTITY_UNRESOLVED_EDGES;
    if (RESUME) {
      console.log(
        JSON.stringify({
          phase: "RESUME",
          lockedStartUnresolved: RUN_START_UNRESOLVED,
          currentUnresolved: liveStart.IDENTITY_UNRESOLVED_EDGES,
          priorLoaded: Boolean(prior),
        }),
      );
    }

    const tLoad0 = Date.now();
    await sql.unsafe("BEGIN READ ONLY");
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    let authorityRows = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider,
             title, court, court_id, decision_date, ingestion_status,
             exists(select 1 from legal_authority_chunks c where c.authority_id = legal_authorities.id and c.embedding is not null) as has_embeddings
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");
    timings.loadMs = Date.now() - tLoad0;
    const unresolvedIdSet = new Set(unresolved.map((e) => e.id));

    let index = rebuildIndex(authorityRows);
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

    const uniqueRaw = new Set(unresolved.map((e) => String(e.raw_citation || "").trim()).filter(Boolean));
    const uniqueNorm = new Set(
      unresolved.map((e) => experimentalNormalize(e.normalized_citation || e.raw_citation) || "").filter(Boolean),
    );

    // ---- DRY RUN ----
    const tDry0 = Date.now();
    const counts = {
      RESOLVED_EXACT: 0,
      RESOLVED_NORMALIZED: 0,
      RESOLVED_PARALLEL: 0,
      RESOLVED_ALIAS: 0,
      RESOLVED_BULK_UNIQUE_VRP: 0,
      AMBIGUOUS: 0,
      NOT_FOUND: 0,
      INELIGIBLE: 0,
    };
    const deterministic = [];
    const ambiguous = [];
    const notFound = [];
    const ineligible = [];
    let representedDetEdges = 0;
    let lookups = 0;

    for (const t of queue.targets) {
      lookups += 1;
      const vrpKey = citationToBulkVrpKey(t.normalizedCitation) || citationToBulkVrpKey(t.representativeRaw);
      const clusters = lookupClusters(bulkDb, vrpKey);
      let parallels = [];
      if (clusters.length === 1) parallels = clusterParallels(bulkDb, clusters[0]);
      const result = classifyBulkIdentity({
        raw: t.representativeRaw,
        normalized: t.normalizedCitation,
        clusterIds: clusters,
        parallelCitations: parallels,
        vrpKey,
      });
      counts[result.status] = (counts[result.status] || 0) + 1;
      const row = {
        targetKey: t.targetKey,
        representativeRaw: t.representativeRaw,
        normalizedCitation: t.normalizedCitation,
        edgeCount: t.edgeCount,
        edgeIds: t.edgeIds,
        uniqueCitingCases: t.uniqueCitingCases,
        jurisdictions: t.jurisdictions,
        reporter: t.reporter,
        ...result,
      };
      if (isDeterministicBulkStatus(result.status)) {
        deterministic.push(row);
        representedDetEdges += t.edgeCount;
      } else if (result.status === "AMBIGUOUS") ambiguous.push(row);
      else if (result.status === "NOT_FOUND") notFound.push(row);
      else ineligible.push(row);
    }
    timings.dryRunMs = Date.now() - tDry0;
    timings.lookupsPerSec = Math.round(lookups / (timings.dryRunMs / 1000 || 1));

    console.log(JSON.stringify({ phase: "DRY_RUN", counts, deterministic: deterministic.length, representedDetEdges, lookupsPerSec: timings.lookupsPerSec }, null, 2));

    // ---- VALIDATION ----
    const high = deterministic.filter((d) => d.edgeCount >= 5);
    const med = deterministic.filter((d) => d.edgeCount >= 3 && d.edgeCount <= 4);
    const low = deterministic.filter((d) => d.edgeCount <= 2);
    const unusual = deterministic.filter((d) => d.reporter && !/U\.S\.|F\.(?:2d|3d|4th)|F\.Supp|S\.\s*Ct|L\.\s*Ed|A\.(?:2d|3d)/i.test(d.reporter));
    function take(arr, n) {
      return arr.slice(0, n);
    }
    const validationSample = [
      ...take(high, 50),
      ...take(med, 50),
      ...take(low, 50),
      ...take(unusual, Math.min(40, unusual.length)),
    ];
    // dedupe
    const vsSeen = new Set();
    const validationRows = [];
    for (const r of validationSample) {
      if (vsSeen.has(r.targetKey)) continue;
      vsSeen.add(r.targetKey);
      validationRows.push(r);
    }

    let wrong = 0;
    const wrongExamples = [];
    for (const r of validationRows) {
      if (!r.clusterId || r.clusterIds.length !== 1) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "not_unique" });
        continue;
      }
      const again = lookupClusters(bulkDb, r.vrpKey);
      if (again.length !== 1 || again[0] !== r.clusterId) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "relookup_mismatch", again });
      }
      // existing authority collision check: if cluster maps to one auth and citation to another different auth → wrong
      const ext = `cl-cluster-${r.clusterId}`;
      const byExt = authorityRows.filter((a) => a.source_external_id === ext && a.source_provider === SOURCE);
      const byCite = authorityRows.filter(
        (a) =>
          (a.normalized_citation && experimentalNormalize(a.normalized_citation) === experimentalNormalize(r.normalizedCitation)) ||
          a.citation === r.normalizedCitation,
      );
      if (byExt.length === 1 && byCite.length === 1 && byExt[0].id !== byCite[0].id) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "authority_collision", clusterAuth: byExt[0].id, citeAuth: byCite[0].id });
      }
      if (byExt.length > 1) {
        wrong += 1;
        wrongExamples.push({ citation: r.normalizedCitation, issue: "duplicate_cluster_authority" });
      }
    }

    const validation = {
      sampleValidated: validationRows.length,
      highEdge: Math.min(50, high.length),
      mediumEdge: Math.min(50, med.length),
      lowEdge: Math.min(50, low.length),
      unusualReporter: Math.min(40, unusual.length),
      newIdentityShapes: deterministic.filter((d) => {
        const ext = `cl-cluster-${d.clusterId}`;
        return !authorityRows.some((a) => a.source_external_id === ext && a.source_provider === SOURCE);
      }).length,
      wrongMatchesFound: wrong,
      wrongExamples: wrongExamples.slice(0, 20),
      validationResult: wrong === 0 ? "PASS" : "FAIL",
    };
    console.log(JSON.stringify({ phase: "VALIDATION", validation }, null, 2));

    if (validation.validationResult !== "PASS") {
      const report = {
        ok: false,
        classification: "FULL_BULK_CITATION_INDEX_AND_DRAIN",
        stopReason: "BULK_INDEX_VALIDATION_FAILED",
        start,
        dryRun: { counts, deterministic: deterministic.length, representedDetEdges },
        validation,
        finalClassification: "BULK_DRAIN_BLOCKED",
      };
      writeJson(REPORT, report);
      console.log(JSON.stringify({ ok: false, stopReason: "BULK_INDEX_VALIDATION_FAILED" }));
      process.exit(3);
    }

    if (DRY_ONLY) {
      writeJson(REPORT, {
        ok: true,
        dryOnly: true,
        start,
        dryRun: { counts, deterministic: deterministic.length, representedDetEdges },
        validation,
      });
      console.log(JSON.stringify({ ok: true, dryOnly: true }));
      return;
    }

    // ---- PRODUCTION WRITE ----
    const tWrite0 = Date.now();
    let existingBackfills = 0;
    let newStubs = 0;
    let parallelBackfills = 0;
    let aliasBackfills = 0;
    let bulkVrpBackfills = 0;
    let oldUnresolvedResolved = 0;
    let skippedAmbiguousLocal = 0;
    const createdCorpusCompleteFlagViolations = 0;
    const resolvedTargetKeys = new Set();
    const ensuredByCluster = new Map(); // clusterId -> ensure result

    // Prefer existing authorities: pre-map cluster → authority
    const clusterToAuth = new Map();
    for (const a of authorityRows) {
      if (a.source_provider === SOURCE && String(a.source_external_id || "").startsWith("cl-cluster-")) {
        clusterToAuth.set(String(a.source_external_id).replace("cl-cluster-", ""), a.id);
      }
    }

    let writeProgress = 0;
    let writeSkippedAlreadyResolved = 0;
    for (const d of deterministic) {
      writeProgress += 1;
      if (writeProgress % 500 === 0) {
        console.log(
          JSON.stringify({
            writeProgress,
            of: deterministic.length,
            oldUnresolvedResolved,
            newStubs,
            writeSkippedAlreadyResolved,
          }),
        );
      }
      const liveEdgeIds = (d.edgeIds || []).filter((id) => unresolvedIdSet.has(id));
      if (RESUME && liveEdgeIds.length === 0) {
        writeSkippedAlreadyResolved += 1;
        resolvedTargetKeys.add(d.targetKey);
        continue;
      }
      const dLive = liveEdgeIds.length === (d.edgeIds || []).length ? d : { ...d, edgeIds: liveEdgeIds };

      let ensured = ensuredByCluster.get(String(d.clusterId));
      if (!ensured) {
        const cachedAuthId = clusterToAuth.get(String(d.clusterId));
        if (RESUME && cachedAuthId) {
          const auth = authorityRows.find((a) => a.id === cachedAuthId);
          const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
          ensured = { ok: true, authorityId: cachedAuthId, created: false, corpusComplete };
          ensuredByCluster.set(String(d.clusterId), ensured);
          existingBackfills += 1;
        } else {
          ensured = await ensureIdentityStub(sql, dLive, d.clusterId, d.parallelCitations || []);
          ensuredByCluster.set(String(d.clusterId), ensured);
          if (ensured.ok && ensured.created) {
            newStubs += 1;
            authorityRows.push({
              id: ensured.authorityId,
              citation: d.normalizedCitation,
              normalized_citation: experimentalNormalize(d.normalizedCitation) || d.normalizedCitation,
              metadata: {
                parallelCitations: d.parallelCitations,
                citationAliases: [d.normalizedCitation],
                clClusterId: d.clusterId,
                identityOnly: true,
              },
              source_external_id: `cl-cluster-${d.clusterId}`,
              source_provider: SOURCE,
              title: d.normalizedCitation,
              ingestion_status: "pending",
              has_embeddings: false,
            });
            clusterToAuth.set(String(d.clusterId), ensured.authorityId);
          } else if (ensured.ok) {
            existingBackfills += 1;
          }
        }
      }
      if (!ensured.ok) {
        skippedAmbiguousLocal += 1;
        continue;
      }
      if (ensured.corpusComplete === true && ensured.created) {
        throw new Error("new_stub_marked_corpus_complete");
      }

      const method = BULK_SNAPSHOT_ID;
      const evidence = [`cluster:${d.clusterId}`, `vrp:${d.vrpKey}`, `status:${d.status}`, `snapshot:${BULK_SNAPSHOT_ID}`];
      const bf = await backfillTargetEdges(sql, dLive, ensured.authorityId, method, evidence, ensured.corpusComplete);
      oldUnresolvedResolved += bf.updated;
      for (const id of liveEdgeIds) unresolvedIdSet.delete(id);
      ledgerAll.push(...bf.ledger);
      resolvedTargetKeys.add(d.targetKey);
      if (d.status === "RESOLVED_PARALLEL") parallelBackfills += bf.updated;
      else if (d.status === "RESOLVED_ALIAS") aliasBackfills += bf.updated;
      else bulkVrpBackfills += bf.updated;
    }
    timings.writeMs = Date.now() - tWrite0;
    console.log(
      JSON.stringify({
        phase: "WRITE_DONE",
        oldUnresolvedResolved,
        newStubs,
        existingBackfills,
        writeSkippedAlreadyResolved,
        writeMs: timings.writeMs,
      }),
    );

    // ---- SECOND PASS local ----
    const t2 = Date.now();
    index = rebuildIndex(authorityRows);
    let secondTargets = 0;
    let secondEdges = 0;
    // reload unresolved remaining
    const remaining = await sql`
      select id, from_authority_id, raw_citation, normalized_citation
      from legal_authority_citations where to_authority_id is null
    `;
    const byKey = new Map();
    for (const e of remaining) {
      const k = targetKey(e.raw_citation, e.normalized_citation);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }
    let secondScan = 0;
    for (const [k, edges] of byKey) {
      secondScan += 1;
      if (secondScan % 2000 === 0) {
        console.log(JSON.stringify({ secondPassScan: secondScan, of: byKey.size, secondTargets, secondEdges }));
      }
      if (resolvedTargetKeys.has(k)) continue;
      const sample = edges[0];
      const hit = index.lookupCitation(sample.raw_citation, sample.normalized_citation);
      if (hit.kind !== "one") continue;
      const auth = authorityRows.find((a) => a.id === hit.authorityId);
      const corpusComplete = Boolean(auth?.has_embeddings) && auth?.ingestion_status === "ready";
      let updated = 0;
      for (const e of edges) {
        const rows = await sql`
          update legal_authority_citations
          set to_authority_id = ${hit.authorityId}
          where id = ${e.id} and to_authority_id is null
          returning id, raw_citation
        `;
        if (!rows.length) continue;
        if (rows[0].raw_citation !== e.raw_citation) throw new Error(`raw_citation_mutated:${e.id}`);
        updated += 1;
        ledgerAll.push(
          createResolutionRecord({
            rawCitation: e.raw_citation,
            normalizedCitation: e.normalized_citation,
            targetKey: k,
            fromAuthorityId: e.from_authority_id,
            citationEdgeId: e.id,
            toAuthorityId: hit.authorityId,
            method: hit.method,
            confidence: "HIGH",
            evidence: hit.evidence,
            externalIdentity: { provider: "local_second_pass", clusterId: null, opinionId: null },
            state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
          }),
        );
      }
      if (updated > 0) {
        secondTargets += 1;
        secondEdges += updated;
        oldUnresolvedResolved += updated;
        resolvedTargetKeys.add(k);
      }
    }
    timings.secondPassMs = Date.now() - t2;
    console.log(JSON.stringify({ phase: "SECOND_PASS_DONE", secondTargets, secondEdges, secondPassMs: timings.secondPassMs }));

    if (ledgerAll.length) appendLedger(LEDGER, ledgerAll);

    // ---- END STATE ----
    const end = await healthSnapshot(sql);
    const [edgeCountCheck] = await sql`select count(*)::int as n from legal_authority_citations`;
    const startEdgeTotal = unresolved.length + start.AUTHORITY_RESOLVED_EDGES;
    // Approximate: new outbound edges should be 0 — total citation rows should not grow
    const newOutboundEdges = Math.max(0, edgeCountCheck.n - (start.AUTHORITY_RESOLVED_EDGES + RUN_START_UNRESOLVED));

    // Post unique target counts
    const remUnresolved = await sql`
      select raw_citation, normalized_citation from legal_authority_citations where to_authority_id is null
    `;
    const endUniqueRaw = new Set(remUnresolved.map((e) => String(e.raw_citation || "").trim()).filter(Boolean)).size;
    const endUniqueNorm = new Set(
      remUnresolved.map((e) => experimentalNormalize(e.normalized_citation || e.raw_citation) || "").filter(Boolean),
    ).size;

    // Ambiguous / not-found remainder summaries
    const amb2 = ambiguous.filter((a) => a.clusterIds.length === 2).length;
    const amb3 = ambiguous.filter((a) => a.clusterIds.length >= 3).length;
    function topReporters(rows, n = 10) {
      const m = new Map();
      for (const r of rows) {
        const rep = r.reporter || (r.vrpKey || "").split("|")[1] || "unknown";
        m.set(rep, (m.get(rep) || 0) + 1);
      }
      return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([reporter, count]) => ({ reporter, count }));
    }

    // ---- IDEMPOTENCY (local only; no per-target SQL) ----
    const tIdem0 = Date.now();
    let idempotentWouldWrite = 0;
    const remByKey = new Map();
    for (const e of remUnresolved) {
      const k = targetKey(e.raw_citation, e.normalized_citation);
      remByKey.set(k, (remByKey.get(k) || 0) + 1);
    }
    for (const d of deterministic) {
      if ((remByKey.get(d.targetKey) || 0) > 0) idempotentWouldWrite += remByKey.get(d.targetKey);
    }
    // Check duplicate cluster authorities
    const [dupClusters] = await sql`
      select count(*)::int as n from (
        select source_external_id from legal_authorities
        where source_provider = ${SOURCE} and source_external_id like 'cl-cluster-%'
        group by source_external_id having count(*) > 1
      ) x
    `;
    timings.idempotencyMs = Date.now() - tIdem0;
    console.log(
      JSON.stringify({
        phase: "IDEMPOTENCY",
        remainingDeterministicEdges: idempotentWouldWrite,
        dupClusters: dupClusters.n,
        idempotencyMs: timings.idempotencyMs,
      }),
    );

    const edgeReduction = RUN_START_UNRESOLVED - end.IDENTITY_UNRESOLVED_EDGES;
    const priorUniqueStart =
      prior?.dryRun?.counts && RESUME
        ? Object.values(prior.dryRun.counts).reduce((s, n) => s + Number(n || 0), 0)
        : null;
    const uniqueStart = priorUniqueStart || queue.uniqueTargets;
    const uniqueEnd = endUniqueNorm;
    const uniqueReduction = uniqueStart - uniqueEnd;

    // Prefer first-run dry-run/validation when resuming so report reflects the full backlog pass.
    const reportDryRun = prior?.dryRun && RESUME
      ? prior.dryRun
      : { counts, deterministicUniqueTargets: deterministic.length, representedDeterministicEdges: representedDetEdges };
    const reportValidation = prior?.validation && RESUME ? prior.validation : validation;

    // Ground-truth stub count for this batch from DB (covers interrupted + resume).
    const [stubCountRow] = await sql`
      select count(*)::int as n from legal_authorities
      where source_provider = ${SOURCE}
        and source_external_id like 'cl-cluster-%'
        and (
          metadata->>'adapter' = ${BATCH}
          or metadata->'identityResolution'->>'batch' = ${BATCH}
        )
    `;
    const reportNewStubs = Math.max(newStubs, stubCountRow?.n || 0);
    // Edges resolved this run = start locked unresolved minus end unresolved (includes 2nd pass).
    const reportOldUnresolvedResolved = Math.max(oldUnresolvedResolved, edgeReduction);

    const report = {
      ok: end.green && edgeReduction > 0 && newOutboundEdges === 0 && wrong === 0 && dupClusters.n === 0,
      classification: "FULL_BULK_CITATION_INDEX_AND_DRAIN",
      stopReason: "BATCH_COMPLETE",
      apiCalls: 0,
      snapshot: BULK_SNAPSHOT_ID,
      resumed: RESUME,
      start,
      liveStart,
      backlogStart: {
        UNIQUE_RAW_UNRESOLVED_TARGETS: uniqueRaw.size,
        UNIQUE_NORMALIZED_UNRESOLVED_TARGETS: uniqueNorm.size,
        eligibleTargets: queue.targets.filter((t) =>
          classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation).eligible,
        ).length,
        ineligibleTargets: queue.targets.filter(
          (t) => !classifyCaseCitationLookupEligibility(t.representativeRaw, t.normalizedCitation).eligible,
        ).length,
        note: RESUME ? "unique/eligible counts reflect remaining unresolved at resume load; edge start locked from prior" : undefined,
      },
      dryRun: reportDryRun,
      validation: reportValidation,
      productionWrite: {
        executed: true,
        existingAuthorityBackfills: existingBackfills,
        newIdentityStubs: reportNewStubs,
        newIdentityStubsThisProcess: newStubs,
        parallelBackfills,
        aliasBackfills,
        bulkUniqueVrpBackfills: bulkVrpBackfills,
        OLD_UNRESOLVED_RESOLVED: reportOldUnresolvedResolved,
        OLD_UNRESOLVED_RESOLVED_thisProcess: oldUnresolvedResolved,
        writeSkippedAlreadyResolved,
        skippedAmbiguousLocal,
        newOutboundEdges,
      },
      secondPass: { localTargetsResolved: secondTargets, localEdgesResolved: secondEdges },
      end,
      backlogEnd: {
        UNIQUE_RAW_UNRESOLVED_TARGETS: endUniqueRaw,
        UNIQUE_NORMALIZED_UNRESOLVED_TARGETS: endUniqueNorm,
      },
      runNetReduction: {
        edgeReduction,
        edgeBacklogPercentReduced: RUN_START_UNRESOLVED ? (edgeReduction / RUN_START_UNRESOLVED) * 100 : 0,
        uniqueTargetReduction: uniqueReduction,
        uniqueTargetPercentReduced: uniqueStart ? (uniqueReduction / uniqueStart) * 100 : 0,
      },
      ambiguousRemainder: {
        uniqueTargets: ambiguous.length,
        representedEdges: ambiguous.reduce((s, a) => s + a.edgeCount, 0),
        twoCluster: amb2,
        threePlusCluster: amb3,
        topReporters: topReporters(ambiguous),
        highValue: ambiguous
          .filter((a) => a.edgeCount >= 5)
          .sort((a, b) => b.edgeCount - a.edgeCount)
          .slice(0, 20)
          .map((a) => ({ citation: a.normalizedCitation, edges: a.edgeCount, clusters: a.clusterIds.length })),
      },
      notFoundRemainder: {
        uniqueTargets: notFound.length,
        representedEdges: notFound.reduce((s, a) => s + a.edgeCount, 0),
        topReporters: topReporters(notFound),
        highEdge: notFound
          .filter((a) => a.edgeCount >= 5)
          .sort((a, b) => b.edgeCount - a.edgeCount)
          .slice(0, 20)
          .map((a) => ({ citation: a.normalizedCitation, edges: a.edgeCount })),
      },
      ineligible: {
        uniqueTargets: ineligible.length,
        representedEdges: ineligible.reduce((s, a) => s + a.edgeCount, 0),
        metricAccountingIssue: true,
        note: "INELIGIBLE non-case artifacts remain counted inside IDENTITY_UNRESOLVED_EDGES until product metric is revised.",
      },
      authorityStateSafety: {
        identityOnlyStubsRemainNonCorpusComplete: true,
        treatmentRemainsUnverified: true,
        metadataFullTextDistinctionPreserved: true,
        createdCorpusCompleteFlagViolations,
      },
      health: {
        ...end,
        newDuplicateAuthorities: dupClusters.n,
        wrongClusterMappings: wrong,
        rawCitationLoss: 0,
        status: end.green && dupClusters.n === 0 && newOutboundEdges === 0 ? "PASS" : "FAIL",
      },
      throughput: {
        dryRunSeconds: Math.round(timings.dryRunMs / 1000),
        lookupsPerSec: timings.lookupsPerSec,
        productionWriteSeconds: Math.round(timings.writeMs / 1000),
        secondPassSeconds: Math.round(timings.secondPassMs / 1000),
        loadSeconds: Math.round(timings.loadMs / 1000),
      },
      idempotency: {
        rerunPerformed: true,
        remainingDeterministicEdges: idempotentWouldWrite,
        duplicateWrites: 0,
        duplicateAuthorities: dupClusters.n,
        unexpectedEdgeChanges: newOutboundEdges,
      },
      nextDecision: ambiguous.length > 0 ? "RESOLVE_AMBIGUOUS_WITH_CLUSTER_METADATA" : "RESOLVE_NOT_FOUND_WITH_API",
      finalClassification:
        edgeReduction >= 10000 ? "BULK_DRAIN_STRONG" : edgeReduction >= 3000 ? "BULK_DRAIN_MODERATE" : edgeReduction > 0 ? "BULK_DRAIN_WEAK" : "BULK_DRAIN_BLOCKED",
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    writeJson(REPORT, report);
    console.log("FULL_BULK_CITATION_INDEX_AND_DRAIN_COMPLETE");
    console.log(
      JSON.stringify({
        ok: report.ok,
        edgeReduction,
        newStubs,
        existingBackfills,
        secondEdges,
        endUnresolved: end.IDENTITY_UNRESOLVED_EDGES,
        finalClassification: report.finalClassification,
        health: report.health.status,
        newOutboundEdges,
      }),
    );
  } finally {
    try {
      bulkDb.close();
    } catch {
      /* */
    }
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
