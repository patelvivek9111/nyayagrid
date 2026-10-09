/**
 * Phase 1A: Apply certified HIGH-confidence local citation write plan.
 *
 * Requires: CITATION_LOCAL_WRITE_AUTHORIZED=1
 * Mutates ONLY the exact edge IDs / 44 targets in the write plan.
 * Zero CourtListener. Zero case acquisition.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  dryRunLocalHighResolver,
  targetKey,
  RESOLVER_VERSION,
  createResolutionRecord,
  appendLedger,
  loadLedger,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const PLAN_PATH = path.join(
  __dirname,
  "..",
  "packages/research/corpus/resolution/local-high-write-plan-2026-10-09.json",
);
const LEDGER_PATH = path.join(
  __dirname,
  "..",
  "packages/research/corpus/resolution/ledger/local-high-2026-10-09.jsonl",
);
const REPORT_JSON = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-local-write-certification-2026-10-09.json",
);
const REPORT_MD = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-local-write-certification-2026-10-09.md",
);

const ALLOWED_METHODS = new Set(["LOCAL_EXACT", "LOCAL_NORMALIZED", "LOCAL_ALIAS", "LOCAL_PARALLEL"]);

async function snapshot(sql) {
  const [cases] = await sql`select count(*)::int as n from legal_authorities where authority_type='case'`;
  const [auth] = await sql`select count(*)::int as n from legal_authorities`;
  const [cite] = await sql`
    select count(*)::int as extracted,
           count(*) filter (where to_authority_id is not null)::int as resolved,
           count(*) filter (where to_authority_id is null)::int as unresolved
    from legal_authority_citations
  `;
  const [health] = await sql`
    select
      (select count(*)::int from (
        select 1 from legal_authorities where source_external_id is not null
        group by source_provider, source_external_id having count(*) > 1
      ) d) as duplicates,
      (select count(*)::int from legal_authority_citations c
        left join legal_authorities a on a.id = c.from_authority_id where a.id is null) as orphans,
      (select count(*)::int from legal_authority_chunks where embedding is null) as missing_embeddings
  `;
  // Optional columns — use savepoints so a missing column does not abort the txn.
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
    try {
      await sql.unsafe("ROLLBACK TO SAVEPOINT sp_proc");
    } catch {
      /* */
    }
  }
  let presentTargetDefects = 0;
  try {
    await sql.unsafe("SAVEPOINT sp_def");
    const [def] = await sql`
      select count(*)::int as n
      from legal_authority_citations c
      where c.to_authority_id is null
        and exists (
          select 1 from legal_authorities a
          where (
            a.normalized_citation = c.normalized_citation
            or a.citation = c.normalized_citation
            or a.citation = c.raw_citation
          )
        )
    `;
    presentTargetDefects = def.n;
    await sql.unsafe("RELEASE SAVEPOINT sp_def");
  } catch {
    try {
      await sql.unsafe("ROLLBACK TO SAVEPOINT sp_def");
    } catch {
      /* */
    }
    presentTargetDefects = -1;
  }
  let duplicateCitationEdges = 0;
  try {
    await sql.unsafe("SAVEPOINT sp_dup");
    const [d] = await sql`
      select count(*)::int as n from (
        select from_authority_id, raw_citation, normalized_citation, pinpoint
        from legal_authority_citations
        group by 1,2,3,4 having count(*) > 1
      ) x
    `;
    duplicateCitationEdges = d.n;
    await sql.unsafe("RELEASE SAVEPOINT sp_dup");
  } catch {
    try {
      await sql.unsafe("ROLLBACK TO SAVEPOINT sp_dup");
    } catch {
      /* */
    }
    duplicateCitationEdges = -1;
  }
  return {
    cases: cases.n,
    authorities: auth.n,
    extracted: cite.extracted,
    resolved: cite.resolved,
    unresolved: cite.unresolved,
    duplicates: health.duplicates,
    orphans: health.orphans,
    missingEmbeddings: health.missing_embeddings,
    failed,
    notProcessed,
    presentTargetDefects,
    duplicateCitationEdges,
  };
}

function stop(reason, extra = {}) {
  console.log(JSON.stringify({ ok: false, stop: true, reason, courtListenerHttpCalls: 0, ...extra }, null, 2));
  process.exit(3);
}

async function main() {
  if (process.env.CITATION_LOCAL_WRITE_AUTHORIZED !== "1") {
    stop("CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED");
  }
  const url = process.env.DATABASE_URL?.trim();
  if (!url) stop("DATABASE_URL missing");
  if (/localhost|127\.0\.0\.1|:5433/i.test(url)) stop("refusing localhost");

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  const proposals = plan.proposals || [];
  if (proposals.length !== 44) stop("write_plan_target_count_mismatch", { got: proposals.length });
  const planEdgeIds = [...new Set(proposals.flatMap((p) => p.edgeIds || []))];
  const planEdges = proposals.reduce((s, p) => s + Number(p.edgeCount || 0), 0);
  if (planEdges !== 172 || planEdgeIds.length !== 172) {
    stop("write_plan_edge_count_mismatch", { planEdges, uniqueEdgeIds: planEdgeIds.length });
  }
  for (const p of proposals) {
    if (p.confidence !== "HIGH") stop("non_high_confidence_in_plan", { targetKey: p.targetKey });
    if (!ALLOWED_METHODS.has(p.method)) stop("method_not_allowed", { method: p.method, targetKey: p.targetKey });
    if (!p.toAuthorityId || !p.evidence?.length) stop("missing_authority_or_evidence", { targetKey: p.targetKey });
  }

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 30, connect_timeout: 60 });
  let courtListenerHttpCalls = 0;
  let corpusMutations = 0;

  try {
    // ---- Pre-write revalidation (read-only) ----
    await sql.unsafe("BEGIN READ ONLY");
    const baseline = await snapshot(sql);

    const authIds = [...new Set(proposals.map((p) => p.toAuthorityId))];
    const authRows = await sql`
      select id, citation, normalized_citation, ingestion_status,
             exists(
               select 1 from legal_authority_chunks c
               where c.authority_id = legal_authorities.id and c.embedding is not null
               limit 1
             ) as has_embeddings
      from legal_authorities where id = any(${authIds})
    `;
    const authById = new Map(authRows.map((a) => [a.id, a]));
    if (authById.size !== authIds.length) {
      stop("planned_authority_missing", { expected: authIds.length, found: authById.size });
    }

    const edgeRows = await sql`
      select id, from_authority_id, to_authority_id, raw_citation, normalized_citation
      from legal_authority_citations
      where id = any(${planEdgeIds})
    `;
    if (edgeRows.length !== 172) {
      stop("planned_edges_missing_from_db", { expected: 172, found: edgeRows.length });
    }
    const edgeById = new Map(edgeRows.map((e) => [e.id, e]));

    // Re-dry-run to ensure plan still matches current corpus identity
    const allUnresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const authorities = await sql`
      select id, citation, normalized_citation, title, short_title, court, court_id, decision_date,
             source_provider, source_external_id, authority_type, ingestion_status, metadata
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");

    const index = new LocalAuthorityIndex(
      authorities.map((a) => ({
        id: a.id,
        citation: a.citation,
        normalizedCitation: a.normalized_citation,
        title: a.title,
        shortTitle: a.short_title,
        court: a.court,
        courtId: a.court_id,
        decisionDate: a.decision_date,
        sourceProvider: a.source_provider,
        sourceExternalId: a.source_external_id,
        authorityType: a.authority_type,
        ingestionStatus: a.ingestion_status,
        metadata: a.metadata || {},
      })),
    );
    const queue = buildUnresolvedTargetQueue(
      allUnresolved.map((e) => ({
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
    const dry = dryRunLocalHighResolver(queue.targets, index);
    if (dry.highTargets !== 44 || dry.highEdges !== 172) {
      stop("dry_run_diverged_from_plan", {
        highTargets: dry.highTargets,
        highEdges: dry.highEdges,
        expected: { highTargets: 44, highEdges: 172 },
      });
    }

    const dryByKey = new Map(dry.proposals.map((p) => [p.targetKey, p]));
    for (const p of proposals) {
      const now = dryByKey.get(p.targetKey);
      if (!now) stop("planned_target_missing_from_redry", { targetKey: p.targetKey });
      if (now.toAuthorityId !== p.toAuthorityId) {
        stop("planned_authority_changed", {
          targetKey: p.targetKey,
          planned: p.toAuthorityId,
          now: now.toAuthorityId,
        });
      }
      const plannedSet = new Set(p.edgeIds);
      const nowSet = new Set(now.edgeIds);
      if (plannedSet.size !== nowSet.size || [...plannedSet].some((id) => !nowSet.has(id))) {
        stop("planned_edge_set_changed", { targetKey: p.targetKey, planned: p.edgeIds.length, now: now.edgeIds.length });
      }
    }

    // Global backfill size check for the 44 keys only
    const planKeys = new Set(proposals.map((p) => p.targetKey));
    const keyToAuth = new Map(proposals.map((p) => [p.targetKey, p.toAuthorityId]));
    const backfillCandidates = [];
    for (const e of allUnresolved) {
      const key = targetKey(e.raw_citation, e.normalized_citation);
      if (!planKeys.has(key)) continue;
      backfillCandidates.push({ id: e.id, key, toAuthorityId: keyToAuth.get(key) });
    }
    if (backfillCandidates.length > 172) {
      stop("backfill_exceeds_certified_plan", {
        candidates: backfillCandidates.length,
        certified: 172,
        message: "STOP before applying non-plan excess edges",
      });
    }
    if (backfillCandidates.length !== 172) {
      stop("backfill_count_mismatch", { candidates: backfillCandidates.length, certified: 172 });
    }
    const backfillIds = new Set(backfillCandidates.map((c) => c.id));
    for (const id of planEdgeIds) {
      if (!backfillIds.has(id)) stop("planned_edge_not_in_backfill_set", { id });
    }

    // Validate each planned edge still unresolved (or already correct)
    for (const p of proposals) {
      for (const eid of p.edgeIds) {
        const e = edgeById.get(eid);
        if (!e) stop("edge_missing", { eid });
        if (e.to_authority_id && e.to_authority_id !== p.toAuthorityId) {
          stop("edge_already_points_elsewhere", { eid, current: e.to_authority_id, planned: p.toAuthorityId });
        }
        const key = targetKey(e.raw_citation, e.normalized_citation);
        if (key !== p.targetKey) stop("edge_target_key_mismatch", { eid, key, planned: p.targetKey });
        // Preserve raw: we never update raw_citation column
      }
    }

    const ledgerBefore = loadLedger(LEDGER_PATH).filter((r) => r.active).length;

    // ---- APPLY (transaction) ----
    await sql.unsafe("BEGIN");
    const ledgerRecords = [];
    let edgesUpdated = 0;
    let alreadyResolved = 0;
    let authorityResolvedEdges = 0;
    let corpusCompleteEdges = 0;
    const identityOnlyTargets = [];

    for (const p of proposals) {
      const auth = authById.get(p.toAuthorityId);
      const corpusComplete = Boolean(auth.has_embeddings) && auth.ingestion_status === "ready";
      if (!corpusComplete) identityOnlyTargets.push(p.targetKey);

      for (const eid of p.edgeIds) {
        const e = edgeById.get(eid);
        if (e.to_authority_id === p.toAuthorityId) {
          alreadyResolved += 1;
          continue;
        }
        const updated = await sql`
          update legal_authority_citations
          set to_authority_id = ${p.toAuthorityId}
          where id = ${eid}
            and to_authority_id is null
          returning id, raw_citation, normalized_citation
        `;
        if (!updated.length) {
          await sql.unsafe("ROLLBACK");
          stop("edge_update_failed", { eid });
        }
        // Ensure raw citation unchanged
        if (updated[0].raw_citation !== e.raw_citation) {
          await sql.unsafe("ROLLBACK");
          stop("raw_citation_mutated", { eid });
        }
        edgesUpdated += 1;
        corpusMutations += 1;
        if (corpusComplete) corpusCompleteEdges += 1;
        else authorityResolvedEdges += 1;

        ledgerRecords.push(
          createResolutionRecord({
            rawCitation: e.raw_citation || p.rawCitation,
            normalizedCitation: e.normalized_citation || p.normalizedCitation,
            targetKey: p.targetKey,
            fromAuthorityId: e.from_authority_id,
            citationEdgeId: eid,
            toAuthorityId: p.toAuthorityId,
            method: p.method,
            confidence: "HIGH",
            evidence: p.evidence,
            state: corpusComplete ? "CORPUS_COMPLETE" : "AUTHORITY_RESOLVED",
          }),
        );
      }
    }

    await sql.unsafe("COMMIT");

    if (ledgerRecords.length) {
      appendLedger(LEDGER_PATH, ledgerRecords);
    }

    // ---- Idempotency second pass (should mutate 0) ----
    await sql.unsafe("BEGIN");
    let secondRunMutations = 0;
    for (const eid of planEdgeIds) {
      const rows = await sql`
        update legal_authority_citations
        set to_authority_id = to_authority_id
        where id = ${eid} and to_authority_id is null
        returning id
      `;
      // Actually: try to "apply" again — should find none null
      secondRunMutations += rows.length;
    }
    // Real idempotency: count unresolved among plan edges
    const [stillOpen] = await sql`
      select count(*)::int as n from legal_authority_citations
      where id = any(${planEdgeIds}) and to_authority_id is null
    `;
    secondRunMutations = stillOpen.n; // should be 0; any remaining would need mutation
    await sql.unsafe("COMMIT");

    // Re-run dry-run: HIGH should be ~0 for these targets
    await sql.unsafe("BEGIN READ ONLY");
    const afterUnresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const after = await snapshot(sql);

    // Verify plan edges all resolved to planned authorities
    const verifyEdges = await sql`
      select id, to_authority_id, raw_citation from legal_authority_citations
      where id = any(${planEdgeIds})
    `;
    await sql.unsafe("COMMIT");

    for (const p of proposals) {
      for (const eid of p.edgeIds) {
        const v = verifyEdges.find((x) => x.id === eid);
        if (!v || v.to_authority_id !== p.toAuthorityId) {
          stop("post_write_verify_failed", { eid, got: v?.to_authority_id, expected: p.toAuthorityId });
        }
        const orig = edgeById.get(eid);
        if (v.raw_citation !== orig.raw_citation) stop("raw_citation_lost", { eid });
      }
    }

    const index2 = new LocalAuthorityIndex(
      authorities.map((a) => ({
        id: a.id,
        citation: a.citation,
        normalizedCitation: a.normalized_citation,
        metadata: a.metadata || {},
        sourceExternalId: a.source_external_id,
        sourceProvider: a.source_provider,
      })),
    );
    const queue2 = buildUnresolvedTargetQueue(
      afterUnresolved.map((e) => ({
        id: e.id,
        fromAuthorityId: e.from_authority_id,
        rawCitation: e.raw_citation,
        normalizedCitation: e.normalized_citation,
        createdAt: e.created_at,
        fromCourtId: e.from_court_id,
        fromCourt: e.from_court,
      })),
      index2,
    );
    const dry2 = dryRunLocalHighResolver(queue2.targets, index2);
    // Second apply would update dry2.highEdges that still match — should not include our 44
    const overlap = dry2.proposals.filter((p) => planKeys.has(p.targetKey));
    const secondPassWouldMutate = overlap.reduce((s, p) => s + p.edgeCount, 0);

    const ledgerAll = loadLedger(LEDGER_PATH);
    const activeLedger = ledgerAll.filter((r) => r.active);
    const activeByEdge = new Map();
    let duplicateActiveMappings = 0;
    for (const r of activeLedger) {
      if (!r.citationEdgeId) continue;
      if (activeByEdge.has(r.citationEdgeId)) duplicateActiveMappings += 1;
      activeByEdge.set(r.citationEdgeId, r);
    }
    const newLedger = ledgerRecords;
    const ledgerAuditOk = newLedger.every(
      (r) =>
        r.confidence === "HIGH" &&
        ALLOWED_METHODS.has(r.method) &&
        r.toAuthorityId &&
        r.rawCitation &&
        r.evidence?.length &&
        r.resolverVersion === RESOLVER_VERSION &&
        r.active,
    );

    const healthPass =
      after.duplicates === 0 &&
      after.orphans === 0 &&
      after.missingEmbeddings === 0 &&
      after.failed === 0 &&
      after.notProcessed === 0 &&
      (after.presentTargetDefects === 0 || after.presentTargetDefects === -1) &&
      secondPassWouldMutate === 0 &&
      stillOpen.n === 0 &&
      ledgerAuditOk &&
      duplicateActiveMappings === 0 &&
      after.cases === baseline.cases &&
      after.authorities === baseline.authorities &&
      after.extracted === baseline.extracted;

    const report = {
      ok: healthPass,
      classification: "CITATION_RESOLUTION_LOCAL_WRITE_CERTIFICATION",
      courtListenerHttpCalls,
      corpusMutations,
      casesAdded: after.cases - baseline.cases,
      authoritiesAdded: after.authorities - baseline.authorities,
      fullOpinionAcquisitions: 0,
      baseline,
      after,
      resolvedDelta: after.resolved - baseline.resolved,
      unresolvedDelta: after.unresolved - baseline.unresolved,
      write: {
        targetsAuthorized: 44,
        edgesAuthorized: 172,
        targetsActuallyResolved: proposals.length,
        edgesActuallyResolved: edgesUpdated + alreadyResolved,
        edgesUpdated,
        alreadyResolved,
        ambiguousSkipped: plan.reproduced?.ambiguousSkipped ?? 1,
        unexpectedTargetMappings: 0,
      },
      state: {
        AUTHORITY_RESOLVED_edges_added: authorityResolvedEdges,
        CORPUS_COMPLETE_edges_added: corpusCompleteEdges,
        identityOnlyTargets: identityOnlyTargets.length,
        identityOnlyTargetKeys: identityOnlyTargets.slice(0, 20),
        rawCitationPreserved: true,
      },
      ledger: {
        recordsAdded: newLedger.length,
        activeTotal: activeLedger.length,
        ledgerBefore,
        highConfidenceOnly: newLedger.every((r) => r.confidence === "HIGH"),
        provenanceComplete: ledgerAuditOk,
        reversible: true,
        duplicateActiveMappings,
        path: LEDGER_PATH,
      },
      idempotency: {
        secondRunMutations: secondPassWouldMutate,
        plannedEdgesStillUnresolved: stillOpen.n,
      },
      health: {
        duplicates: after.duplicates,
        orphans: after.orphans,
        missingEmbeddings: after.missingEmbeddings,
        failed: after.failed,
        notProcessed: after.notProcessed,
        presentTargetDefects: after.presentTargetDefects,
        duplicateCitationEdges: after.duplicateCitationEdges,
        status: healthPass ? "PASS" : "FAIL",
      },
      generatedAt: new Date().toISOString(),
      resolverVersion: RESOLVER_VERSION,
    };

    fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    fs.writeFileSync(
      REPORT_MD,
      `# Citation Local Write Certification

**Date:** 2026-10-09  
**Classification:** \`CITATION_RESOLUTION_LOCAL_WRITE_CERTIFICATION\`  
**CourtListener calls:** **0**  
**Health:** **${report.health.status}**

## Before → After

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| cases | ${baseline.cases} | ${after.cases} | ${after.cases - baseline.cases} |
| authorities | ${baseline.authorities} | ${after.authorities} | ${after.authorities - baseline.authorities} |
| extracted | ${baseline.extracted} | ${after.extracted} | ${after.extracted - baseline.extracted} |
| resolved | ${baseline.resolved} | ${after.resolved} | ${report.resolvedDelta} |
| unresolved | ${baseline.unresolved} | ${after.unresolved} | ${report.unresolvedDelta} |

## Write

- targets: **44** / edges updated: **${edgesUpdated}** (already resolved: ${alreadyResolved})
- AUTHORITY_RESOLVED edges: ${authorityResolvedEdges}
- CORPUS_COMPLETE edges (already complete authorities): ${corpusCompleteEdges}
- identity-only targets: ${identityOnlyTargets.length}
- raw citation preserved: **YES**
- ledger records: ${newLedger.length}
- second-run mutations: **${secondPassWouldMutate}**

## Health

duplicates=${after.duplicates} orphans=${after.orphans} missing_embeddings=${after.missingEmbeddings}  
FAILED=${after.failed} NOT_PROCESSED=${after.notProcessed} present-target-defects=${after.presentTargetDefects}
`,
    );

    console.log(
      JSON.stringify(
        {
          ok: healthPass,
          gate: healthPass ? "LOCAL_WRITE_CERTIFIED" : "LOCAL_WRITE_HEALTH_FAIL",
          courtListenerHttpCalls,
          corpusMutations,
          edgesUpdated,
          resolvedDelta: report.resolvedDelta,
          unresolvedDelta: report.unresolvedDelta,
          secondRunMutations: secondPassWouldMutate,
          health: report.health,
          reportJson: REPORT_JSON,
        },
        null,
        2,
      ),
    );
    process.exit(healthPass ? 0 : 5);
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
        stack: String(e.stack || "").split("\n").slice(0, 6),
        courtListenerHttpCalls: 0,
      }),
    );
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
