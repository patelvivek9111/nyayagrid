/**
 * Phase 1B: First live CourtListener identity batch.
 * HARD CAP: 20 CL requests. Identity lookup only. Zero full-text acquisition.
 * No quota probe. No docket enrichment. No opinion fetch.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  targetKey,
  experimentalNormalize,
  parseCitationLookupResponse,
  createResolutionRecord,
  appendLedger,
  loadLedger,
  RESOLVER_VERSION,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const MAX_REQUESTS = 20;
const RATE_MS = 5000;
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const SOURCE = "courtlistener";
const CHECKPOINT_DIR = path.join(__dirname, "..", "packages/research/corpus/resolution/checkpoints");
const LEDGER_PATH = path.join(
  __dirname,
  "..",
  "packages/research/corpus/resolution/ledger/cl-identity-batch1-2026-10-09.jsonl",
);
const REPORT_JSON = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch1-2026-10-09.json",
);
const REPORT_MD = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-identity-live-batch1-2026-10-09.md",
);
const FULLTEXT_QUEUE = path.join(
  __dirname,
  "..",
  "packages/research/corpus/resolution/fulltext-demand-queue-2026-10-09.json",
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2));
}

async function healthSnapshot(sql) {
  const [cases] = await sql`select count(*)::int as n from legal_authorities where authority_type='case'`;
  const [auth] = await sql`select count(*)::int as n from legal_authorities`;
  const [cite] = await sql`
    select count(*)::int as extracted,
           count(*) filter (where to_authority_id is not null)::int as resolved,
           count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;
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
  const presentTargetAmbiguous = presentRows.filter((r) => Number(r.n) > 1).length;

  const green =
    h.duplicates === 0 &&
    h.orphans === 0 &&
    h.missing_embeddings === 0 &&
    failed === 0 &&
    notProcessed === 0 &&
    presentTargetDefectsDeterministic === 0;

  return {
    cases: cases.n,
    authorities: auth.n,
    extracted: cite.extracted,
    resolved: cite.resolved,
    unresolved: cite.unresolved,
    duplicates: h.duplicates,
    orphans: h.orphans,
    missingEmbeddings: h.missing_embeddings,
    failed,
    notProcessed,
    presentTargetDefectsDeterministic,
    presentTargetAmbiguous,
    green,
  };
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

async function ensureIdentityAuthority(sql, target, lookup) {
  const clusterId = lookup.clusterId;
  const citations = lookup.citations || [];
  const primaryCite =
    citations.find((c) => targetKey(c, c) === target.targetKey) ||
    experimentalNormalize(target.normalizedCitation) ||
    target.normalizedCitation;
  const existing = await findExistingAuthority(sql, {
    clusterId,
    normalizedCitation: primaryCite,
    citations,
  });
  if (existing.ambiguous) return { ok: false, reason: "local_ambiguous_after_lookup" };
  if (existing.row) {
    const corpusComplete = Boolean(existing.row.has_embeddings) && existing.row.ingestion_status === "ready";
    // Learn aliases safely
    const [full] = await sql`select metadata from legal_authorities where id = ${existing.row.id}`;
    const meta = full?.metadata && typeof full.metadata === "object" ? { ...full.metadata } : {};
    const aliases = Array.isArray(meta.citationAliases) ? meta.citationAliases : [];
    const parallels = Array.isArray(meta.parallelCitations) ? meta.parallelCitations : [];
    const mergedAliases = [...new Set([...aliases, target.normalizedCitation, target.representativeRaw, ...citations].filter(Boolean))].slice(0, 24);
    const mergedParallels = [...new Set([...parallels, ...citations].filter(Boolean))].slice(0, 24);
    meta.citationAliases = mergedAliases;
    meta.parallelCitations = mergedParallels;
    meta.identityResolution = {
      method: "COURTLISTENER_CITATION_LOOKUP",
      clusterId,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };
    await sql`
      update legal_authorities
      set metadata = ${sql.json(meta)},
          last_checked_at = now(),
          updated_at = now()
      where id = ${existing.row.id}
    `;
    return {
      ok: true,
      authorityId: existing.row.id,
      created: false,
      corpusComplete,
      via: existing.via,
    };
  }

  // Metadata-only AUTHORITY_RESOLVED identity (pending ingestion; no chunks)
  const authorityId = crypto.randomUUID();
  const title = lookup.caseName || primaryCite || target.normalizedCitation;
  const metadata = {
    adapter: "citation-resolution-identity-batch1",
    identityOnly: true,
    corpusComplete: false,
    clClusterId: clusterId,
    clOpinionIds: lookup.opinionIds || [],
    parallelCitations: citations.slice(0, 12),
    citationAliases: [...new Set([target.normalizedCitation, target.representativeRaw, primaryCite, ...citations].filter(Boolean))].slice(0, 24),
    identityResolution: {
      method: "COURTLISTENER_CITATION_LOOKUP",
      clusterId,
      court: lookup.court,
      dateFiled: lookup.dateFiled,
      evidence: lookup.evidence,
      resolvedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    },
    demandQueueCandidate: true,
    edgeDemand: target.edgeCount,
  };
  await sql`
    insert into legal_authorities (
      id, authority_type, jurisdiction, court, court_id, title, citation, normalized_citation,
      decision_date, source_provider, source_external_id, canonical_source_url,
      metadata, ingestion_status, created_at, updated_at, last_checked_at
    ) values (
      ${authorityId}, 'case', ${lookup.court ? "us" : null}, ${lookup.court}, ${null},
      ${title}, ${primaryCite}, ${experimentalNormalize(primaryCite) || primaryCite},
      ${lookup.dateFiled ? String(lookup.dateFiled).slice(0, 10) : null},
      ${SOURCE}, ${`cl-cluster-${clusterId}`},
      ${`https://www.courtlistener.com/api/rest/v4/clusters/${clusterId}/`},
      ${sql.json(metadata)}, 'pending'::authority_ingestion_status,
      now(), now(), now()
    )
  `;
  return { ok: true, authorityId, created: true, corpusComplete: false, via: "created_identity" };
}

async function backfillTarget(sql, target, authorityId, method, evidence) {
  const unresolved = await sql`
    select id, from_authority_id, raw_citation, normalized_citation, to_authority_id
    from legal_authority_citations
    where to_authority_id is null
  `;
  const matches = unresolved.filter((e) => targetKey(e.raw_citation, e.normalized_citation) === target.targetKey);
  const ledger = [];
  let updated = 0;
  for (const e of matches) {
    const rows = await sql`
      update legal_authority_citations
      set to_authority_id = ${authorityId}
      where id = ${e.id} and to_authority_id is null
      returning id, raw_citation
    `;
    if (!rows.length) continue;
    if (rows[0].raw_citation !== e.raw_citation) {
      throw new Error(`raw_citation_mutated:${e.id}`);
    }
    updated += 1;
    ledger.push(
      createResolutionRecord({
        rawCitation: e.raw_citation || target.representativeRaw,
        normalizedCitation: e.normalized_citation || target.normalizedCitation,
        targetKey: target.targetKey,
        fromAuthorityId: e.from_authority_id,
        citationEdgeId: e.id,
        toAuthorityId: authorityId,
        method,
        confidence: "HIGH",
        evidence,
        externalIdentity: { provider: "courtlistener", clusterId: String(evidence.find((x) => x.startsWith("cluster:"))?.slice(8) || ""), opinionId: null },
        state: "AUTHORITY_RESOLVED",
      }),
    );
  }
  return { updated, matchCount: matches.length, ledger };
}

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const url = process.env.DATABASE_URL?.trim();
  if (!apiKey) {
    console.log(JSON.stringify({ ok: false, reason: "COURTLISTENER_API_KEY missing" }));
    process.exit(2);
  }
  if (!url || /localhost|127\.0\.0\.1|:5433/i.test(url)) {
    console.log(JSON.stringify({ ok: false, reason: "need authoritative Neon DATABASE_URL" }));
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let requestsUsed = 0;
  let lastAt = 0;
  let hit429 = false;
  let hit502 = 0;
  const results = [];
  const fullTextCandidates = [];
  let edgesResolved = 0;
  let targetsHigh = 0;
  let targetsAmbiguous = 0;
  let targetsNotFound = 0;
  let targetsFailed = 0;
  let authorityResolvedTargets = 0;
  let corpusCompleteTargets = 0;
  let identityOnlyTargets = 0;
  let authoritiesCreated = 0;
  const ledgerAll = [];
  let stopReason = "BATCH_COMPLETE";

  try {
    await sql.unsafe("BEGIN READ ONLY");
    const start = await healthSnapshot(sql);
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const authorities = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider, title, court, court_id, decision_date, ingestion_status
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");

    if (!start.green) {
      console.log(JSON.stringify({ ok: false, reason: "start_health_not_green", start }));
      process.exit(3);
    }

    const index = new LocalAuthorityIndex(
      authorities.map((a) => ({
        id: a.id,
        citation: a.citation,
        normalizedCitation: a.normalized_citation,
        metadata: a.metadata || {},
        sourceExternalId: a.source_external_id,
        sourceProvider: a.source_provider,
        title: a.title,
        court: a.court,
        courtId: a.court_id,
        decisionDate: a.decision_date,
        ingestionStatus: a.ingestion_status,
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
    const batch = queue.targets
      .filter((t) => t.lookupSuitable && t.localCandidateStatus === "NO_LOCAL_MATCH")
      .slice(0, MAX_REQUESTS);

    const edgesRepresented = batch.reduce((s, t) => s + t.edgeCount, 0);
    console.log(JSON.stringify({ phase: "selected", targets: batch.length, edgesRepresented, start }, null, 2));

    for (let i = 0; i < batch.length; i++) {
      if (requestsUsed >= MAX_REQUESTS) break;
      const target = batch[i];
      const wait = RATE_MS - (Date.now() - lastAt);
      if (lastAt && wait > 0) await sleep(wait);

      requestsUsed += 1;
      lastAt = Date.now();
      let httpStatus = 0;
      let body = null;
      try {
        const res = await fetch(`${CL_BASE}/citation-lookup/`, {
          method: "POST",
          headers: {
            Authorization: `Token ${apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: target.normalizedCitation || target.representativeRaw }),
          signal: AbortSignal.timeout(60000),
        });
        httpStatus = res.status;
        if (res.status === 429) {
          hit429 = true;
          stopReason = "HTTP_429";
          targetsFailed += 1;
          results.push({
            targetKey: target.targetKey,
            citation: target.normalizedCitation,
            edgeCount: target.edgeCount,
            status: "failed",
            reason: "rate_limited",
            httpStatus,
          });
          break;
        }
        if (res.status === 502 || res.status === 504) {
          hit502 += 1;
          if (requestsUsed >= MAX_REQUESTS) {
            targetsFailed += 1;
            results.push({
              targetKey: target.targetKey,
              citation: target.normalizedCitation,
              edgeCount: target.edgeCount,
              status: "failed",
              reason: `http_${httpStatus}_no_retry_budget`,
              httpStatus,
            });
            break;
          }
          // single bounded retry (counts against hard cap)
          await sleep(2000);
          requestsUsed += 1;
          lastAt = Date.now();
          const res2 = await fetch(`${CL_BASE}/citation-lookup/`, {
            method: "POST",
            headers: {
              Authorization: `Token ${apiKey}`,
              Accept: "application/json",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ text: target.normalizedCitation || target.representativeRaw }),
            signal: AbortSignal.timeout(60000),
          });
          httpStatus = res2.status;
          if (!res2.ok) {
            targetsFailed += 1;
            results.push({
              targetKey: target.targetKey,
              citation: target.normalizedCitation,
              edgeCount: target.edgeCount,
              status: "failed",
              reason: `http_${httpStatus}`,
              httpStatus,
            });
            if (requestsUsed >= MAX_REQUESTS) break;
            continue;
          }
          body = await res2.json();
        } else if (!res.ok) {
          targetsFailed += 1;
          results.push({
            targetKey: target.targetKey,
            citation: target.normalizedCitation,
            edgeCount: target.edgeCount,
            status: "failed",
            reason: `http_${httpStatus}`,
            httpStatus,
          });
          continue;
        } else {
          body = await res.json();
        }
      } catch (e) {
        targetsFailed += 1;
        results.push({
          targetKey: target.targetKey,
          citation: target.normalizedCitation,
          edgeCount: target.edgeCount,
          status: "failed",
          reason: String(e.message || e).slice(0, 200),
        });
        continue;
      }

      const parsed = parseCitationLookupResponse(body);
      const record = {
        targetKey: target.targetKey,
        citation: target.normalizedCitation,
        representativeRaw: target.representativeRaw,
        edgeCount: target.edgeCount,
        uniqueCitingCases: target.uniqueCitingCases,
        jurisdictions: target.jurisdictions,
        httpStatus,
        providerStatus: parsed.status,
        clusterId: parsed.status === "resolved" ? parsed.clusterId : null,
        opinionIds: parsed.status === "resolved" ? parsed.opinionIds : [],
        citations: parsed.status === "resolved" ? parsed.citations : [],
        caseName: parsed.status === "resolved" ? parsed.caseName : null,
        court: parsed.status === "resolved" ? parsed.court : null,
        dateFiled: parsed.status === "resolved" ? parsed.dateFiled : null,
        evidence: parsed.evidence || [],
        candidateCount:
          parsed.status === "ambiguous"
            ? parsed.candidates.length
            : parsed.status === "resolved"
              ? 1
              : 0,
      };

      if (parsed.status === "ambiguous") {
        targetsAmbiguous += 1;
        record.status = "NO_AUTO_RESOLVE";
        record.confidence = null;
        results.push(record);
      } else if (parsed.status === "not_found") {
        targetsNotFound += 1;
        record.status = "IDENTITY_UNRESOLVED";
        results.push(record);
      } else if (parsed.status === "failed") {
        targetsFailed += 1;
        record.status = "failed";
        results.push(record);
      } else if (parsed.status === "resolved") {
        // HIGH only with single cluster
        const ensured = await ensureIdentityAuthority(sql, target, parsed);
        if (!ensured.ok) {
          targetsAmbiguous += 1;
          record.status = "NO_AUTO_RESOLVE";
          record.reason = ensured.reason;
          results.push(record);
        } else {
          const bf = await backfillTarget(
            sql,
            target,
            ensured.authorityId,
            "COURTLISTENER_CITATION_LOOKUP",
            parsed.evidence,
          );
          edgesResolved += bf.updated;
          targetsHigh += 1;
          if (ensured.created) authoritiesCreated += 1;
          if (ensured.corpusComplete) corpusCompleteTargets += 1;
          else {
            authorityResolvedTargets += 1;
            identityOnlyTargets += 1;
            fullTextCandidates.push({
              targetKey: target.targetKey,
              authorityId: ensured.authorityId,
              clusterId: parsed.clusterId,
              citation: target.normalizedCitation,
              edgeCount: target.edgeCount,
              caseName: parsed.caseName,
              court: parsed.court,
            });
          }
          ledgerAll.push(...bf.ledger);
          record.status = "HIGH_RESOLVED";
          record.confidence = "HIGH";
          record.authorityId = ensured.authorityId;
          record.createdAuthority = ensured.created;
          record.corpusComplete = ensured.corpusComplete;
          record.edgesBackfilled = bf.updated;
          results.push(record);
        }
      }

      // Checkpoint every 5 requests
      if (requestsUsed % 5 === 0 || hit429) {
        const health = await healthSnapshot(sql);
        const cp = {
          atRequest: requestsUsed,
          requestsUsed,
          targetsHigh,
          targetsAmbiguous,
          targetsNotFound,
          targetsFailed,
          edgesResolved,
          authorityResolvedTargets,
          corpusCompleteTargets,
          identityOnlyTargets,
          fullTextCandidatesQueued: fullTextCandidates.length,
          health,
          hit429,
          updatedAt: new Date().toISOString(),
        };
        writeJson(path.join(CHECKPOINT_DIR, `identity-batch1-cp-${requestsUsed}.json`), cp);
        console.log(JSON.stringify({ checkpoint: cp }, null, 2));
        if (!health.green) {
          stopReason = "HEALTH_NOT_GREEN";
          break;
        }
      }
      if (hit429) break;
    }

    if (ledgerAll.length) appendLedger(LEDGER_PATH, ledgerAll);

    // Final health + ledger dup check
    const end = await healthSnapshot(sql);
    const ledger = loadLedger(LEDGER_PATH);
    const active = ledger.filter((r) => r.active);
    const byEdge = new Map();
    let duplicateActiveMappings = 0;
    for (const r of active) {
      if (!r.citationEdgeId) continue;
      if (byEdge.has(r.citationEdgeId)) duplicateActiveMappings += 1;
      byEdge.set(r.citationEdgeId, r);
    }

    writeJson(FULLTEXT_QUEUE, {
      generatedAt: new Date().toISOString(),
      batch: "identity-batch1",
      candidates: fullTextCandidates,
      note: "Demand-driven full-text queue only; not acquired in this run.",
    });

    const targetResolutionRate = requestsUsed > 0 ? targetsHigh / requestsUsed : 0;
    const edgeResolutionRate = requestsUsed > 0 ? edgesResolved / requestsUsed : 0;
    const backfillMultiplier = targetsHigh > 0 ? edgesResolved / targetsHigh : 0;
    const authorityOnlyRate = targetsHigh > 0 ? identityOnlyTargets / targetsHigh : 0;
    const noResultRate = requestsUsed > 0 ? targetsNotFound / requestsUsed : 0;
    const ambiguityRate = requestsUsed > 0 ? targetsAmbiguous / requestsUsed : 0;
    const actualIdentitySuccess = targetResolutionRate;
    const withinProjection = actualIdentitySuccess >= 0.45 && actualIdentitySuccess <= 0.7;
    // Also treat >70% as within/better than projection band
    const withinOrAboveProjection = actualIdentitySuccess >= 0.45;

    let scaleDecision = "RUN_SECOND_SMALL_SAMPLE";
    let finalClass = "CITATION_IDENTITY_BATCH1_MODERATE";
    if (hit429 || stopReason === "HEALTH_NOT_GREEN") {
      scaleDecision = "BLOCK_RESOLVER";
      finalClass = "CITATION_IDENTITY_BATCH1_BLOCKED";
    } else if (targetResolutionRate >= 0.55 && end.green && edgesResolved > 0) {
      scaleDecision = "SCALE_IDENTITY_RESOLUTION";
      finalClass = actualIdentitySuccess >= 0.7 ? "CITATION_IDENTITY_BATCH1_STRONG" : "CITATION_IDENTITY_BATCH1_MODERATE";
    } else if (targetResolutionRate < 0.25) {
      scaleDecision = "KEEP_ACQUISITION_PRIMARY";
      finalClass = "CITATION_IDENTITY_BATCH1_WEAK";
    } else if (targetResolutionRate >= 0.45) {
      scaleDecision = "SCALE_IDENTITY_RESOLUTION";
      finalClass = "CITATION_IDENTITY_BATCH1_MODERATE";
    }

    // Remaining day ~378 - requestsUsed (prior probe already consumed 1 earlier; day rem was 378)
    const dayRemainingEst = Math.max(0, 378 - requestsUsed);
    const nextBudget =
      scaleDecision === "SCALE_IDENTITY_RESOLUTION"
        ? Math.min(75, Math.max(20, Math.floor(dayRemainingEst * 0.2)))
        : scaleDecision === "RUN_SECOND_SMALL_SAMPLE"
          ? 20
          : 0;

    const report = {
      ok: end.green && !hit429 && stopReason !== "HEALTH_NOT_GREEN",
      classification: "CITATION_IDENTITY_LIVE_BATCH1",
      stopReason,
      courtListenerHttpCalls: requestsUsed,
      fullTextAcquired: 0,
      start,
      end,
      resolvedDelta: end.resolved - start.resolved,
      unresolvedDelta: end.unresolved - start.unresolved,
      authoritiesCreated,
      casesAdded: end.cases - start.cases,
      authoritiesAdded: end.authorities - start.authorities,
      targets: {
        attempted: results.length,
        highResolved: targetsHigh,
        ambiguous: targetsAmbiguous,
        notFound: targetsNotFound,
        providerFailure: targetsFailed,
      },
      states: {
        AUTHORITY_RESOLVED_targets: authorityResolvedTargets,
        CORPUS_COMPLETE_targets_already_local: corpusCompleteTargets,
        identityOnlyTargets,
      },
      backfill: {
        edgesRepresented,
        edgesResolved,
        oldUnresolvedEdgesBackfilled: edgesResolved,
        backfillMultiplier,
      },
      yield: {
        targetResolutionRate,
        edgeResolutionRate,
        ambiguityRate,
        noResultRate,
        authorityOnlyRate,
        projectedIdentitySuccess: "45-70%",
        actualIdentitySuccess,
        withinProjection: withinOrAboveProjection,
      },
      health: {
        ...end,
        duplicateActiveMappings,
        status: end.green && duplicateActiveMappings === 0 ? "PASS" : "FAIL",
      },
      fullTextQueue: {
        newCandidates: fullTextCandidates.length,
        topCandidates: fullTextCandidates.slice(0, 10),
      },
      http: { requestsAuthorized: 20, requestsUsed, hit429, hit502 },
      scaleDecision,
      nextRecommendedBudget: nextBudget,
      finalClassification: finalClass,
      results,
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    writeJson(REPORT_JSON, report);
    fs.writeFileSync(
      REPORT_MD,
      `# Citation Identity Live Batch 1

**Status:** ${report.ok ? "OK" : "ISSUES"}  
**Stop:** ${stopReason}  
**CL requests:** ${requestsUsed} / 20  
**Full-text acquired:** 0  

## Yield

| Metric | Value |
|---|---:|
| HIGH targets resolved | ${targetsHigh} |
| edges resolved | ${edgesResolved} |
| target resolution rate | ${(targetResolutionRate * 100).toFixed(1)}% |
| edges / CL request | ${edgeResolutionRate.toFixed(2)} |
| backfill multiplier | ${backfillMultiplier.toFixed(2)} |
| ambiguity rate | ${(ambiguityRate * 100).toFixed(1)}% |
| no-result rate | ${(noResultRate * 100).toFixed(1)}% |
| authority-only rate | ${(authorityOnlyRate * 100).toFixed(1)}% |

Projected identity success: 45–70%. Actual: **${(actualIdentitySuccess * 100).toFixed(1)}%**.

## Corpus

resolved ${start.resolved} → ${end.resolved} (Δ ${report.resolvedDelta})  
unresolved ${start.unresolved} → ${end.unresolved} (Δ ${report.unresolvedDelta})  
authorities created (identity-only): ${authoritiesCreated}

## Scale decision

**${scaleDecision}** — next budget recommendation (not executed): **${nextBudget}**
`,
    );

    console.log("COURTLISTENER_IDENTITY_BATCH1_COMPLETE");
    console.log(
      JSON.stringify(
        {
          ok: report.ok,
          stopReason,
          requestsUsed,
          targetsHigh,
          edgesResolved,
          targetResolutionRate,
          scaleDecision,
          finalClassification: finalClass,
          health: report.health.status,
          reportJson: REPORT_JSON,
        },
        null,
        2,
      ),
    );
    process.exit(report.ok ? 0 : 5);
  } catch (e) {
    try {
      await sql.unsafe("ROLLBACK");
    } catch {
      /* */
    }
    console.log(
      JSON.stringify({
        ok: false,
        err: String(e.message || e).slice(0, 1500),
        requestsUsed,
        courtListenerHttpCalls: requestsUsed,
      }),
    );
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
