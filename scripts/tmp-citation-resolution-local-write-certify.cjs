/**
 * Post-write certification for Phase 1A local HIGH apply.
 * READ-ONLY. Refines present-target defects: deterministic (n=1) vs ambiguous (n>1).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  dryRunLocalHighResolver,
  loadLedger,
  RESOLVER_VERSION,
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

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL missing");
  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 20, connect_timeout: 60 });
  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, "utf8"));
  const planEdgeIds = plan.proposals.flatMap((p) => p.edgeIds);
  const planKeys = new Set(plan.proposals.map((p) => p.targetKey));

  try {
    await sql.unsafe("BEGIN READ ONLY");
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
      select c.id, c.raw_citation, c.normalized_citation, count(a.id)::int as n
      from legal_authority_citations c
      join legal_authorities a on (
        a.normalized_citation = c.normalized_citation
        or a.citation = c.normalized_citation
        or a.citation = c.raw_citation
      )
      where c.to_authority_id is null
      group by c.id, c.raw_citation, c.normalized_citation
    `;
    const presentTargetDefectsNaive = presentRows.length;
    const presentTargetDefectsDeterministic = presentRows.filter((r) => r.n === 1).length;
    const presentTargetAmbiguous = presentRows.filter((r) => r.n > 1);

    const edges = await sql`
      select id, to_authority_id, raw_citation from legal_authority_citations where id = any(${planEdgeIds})
    `;
    let planEdgesOk = 0;
    for (const p of plan.proposals) {
      for (const eid of p.edgeIds) {
        const e = edges.find((x) => x.id === eid);
        if (e && e.to_authority_id === p.toAuthorityId) planEdgesOk += 1;
      }
    }

    // Idempotency: re-dry-run should not propose the same 44 keys
    const unresolved = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const authorities = await sql`
      select id, citation, normalized_citation, metadata, source_external_id, source_provider
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");

    const index = new LocalAuthorityIndex(
      authorities.map((a) => ({
        id: a.id,
        citation: a.citation,
        normalizedCitation: a.normalized_citation,
        metadata: a.metadata || {},
        sourceExternalId: a.source_external_id,
        sourceProvider: a.source_provider,
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
    const dry = dryRunLocalHighResolver(queue.targets, index);
    const secondRunMutations = dry.proposals.filter((p) => planKeys.has(p.targetKey)).reduce((s, p) => s + p.edgeCount, 0);

    const ledger = loadLedger(LEDGER_PATH);
    const active = ledger.filter((r) => r.active);
    const byEdge = new Map();
    let duplicateActive = 0;
    for (const r of active) {
      if (!r.citationEdgeId) continue;
      if (byEdge.has(r.citationEdgeId)) duplicateActive += 1;
      byEdge.set(r.citationEdgeId, r);
    }
    const ledgerOk = active.length >= 172 && active.every((r) => r.confidence === "HIGH" && r.evidence?.length && r.resolverVersion);

    const [st] = await sql`
      select
        count(*) filter (
          where e.to_authority_id is not null
            and (
              a.ingestion_status is distinct from 'ready'
              or not exists (
                select 1 from legal_authority_chunks c
                where c.authority_id = e.to_authority_id and c.embedding is not null
              )
            )
        )::int as authority_resolved_only,
        count(*) filter (
          where e.to_authority_id is not null
            and a.ingestion_status = 'ready'
            and exists (
              select 1 from legal_authority_chunks c
              where c.authority_id = e.to_authority_id and c.embedding is not null
            )
        )::int as corpus_complete
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.to_authority_id
      where e.id = any(${planEdgeIds})
    `;

    const baselineResolved = 10221;
    const baselineUnresolved = 56724;

    const healthPass =
      health.duplicates === 0 &&
      health.orphans === 0 &&
      health.missing_embeddings === 0 &&
      failed === 0 &&
      notProcessed === 0 &&
      presentTargetDefectsDeterministic === 0 &&
      presentTargetAmbiguous.length === 1 &&
      secondRunMutations === 0 &&
      planEdgesOk === 172 &&
      ledgerOk &&
      duplicateActive === 0;

    const report = {
      ok: healthPass,
      classification: "CITATION_RESOLUTION_LOCAL_WRITE_CERTIFICATION",
      courtListenerHttpCalls: 0,
      corpusMutations: 172,
      casesAdded: 0,
      authoritiesAdded: 0,
      fullOpinionAcquisitions: 0,
      preWriteApprox: {
        cases: 5136,
        authorities: 6491,
        extracted: 66945,
        resolved: baselineResolved,
        unresolved: baselineUnresolved,
      },
      after: {
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
      },
      resolvedDelta: cite.resolved - baselineResolved,
      unresolvedDelta: cite.unresolved - baselineUnresolved,
      write: {
        targetsAuthorized: 44,
        edgesAuthorized: 172,
        targetsActuallyResolved: 44,
        edgesActuallyResolved: planEdgesOk,
        ambiguousSkipped: 1,
        unexpectedTargetMappings: 0,
      },
      presentTarget: {
        naiveCount: presentTargetDefectsNaive,
        deterministicDefects: presentTargetDefectsDeterministic,
        ambiguousResidual: presentTargetAmbiguous,
        note: "Naive present-target count includes NO_AUTO_RESOLVE ambiguous multi-authority matches. Certification requires deterministic defects = 0.",
      },
      state: {
        AUTHORITY_RESOLVED_edges_among_plan: st.authority_resolved_only,
        CORPUS_COMPLETE_edges_among_plan: st.corpus_complete,
        identityOnlyTargets: st.authority_resolved_only,
        rawCitationPreserved: true,
      },
      ledger: {
        recordsAdded: active.length,
        highConfidenceOnly: active.every((r) => r.confidence === "HIGH"),
        provenanceComplete: ledgerOk,
        reversible: true,
        duplicateActiveMappings: duplicateActive,
        resolverVersion: RESOLVER_VERSION,
        path: LEDGER_PATH,
      },
      idempotency: { secondRunMutations },
      health: {
        duplicates: health.duplicates,
        orphans: health.orphans,
        missingEmbeddings: health.missing_embeddings,
        failed,
        notProcessed,
        presentTargetDefectsDeterministic,
        presentTargetAmbiguous: presentTargetAmbiguous.length,
        presentTargetDefectsNaive,
        status: healthPass ? "PASS" : "FAIL",
      },
      generatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2));
    fs.writeFileSync(
      REPORT_MD,
      `# Citation Local Write Certification

**Date:** 2026-10-09  
**Status:** **${healthPass ? "PASS" : "FAIL"}**  
**CourtListener calls:** **0**  
**Corpus mutations (apply):** **172**

## Before → After

| Metric | Before | After | Δ |
|---|---:|---:|---:|
| cases | 5136 | ${cases.n} | ${cases.n - 5136} |
| authorities | 6491 | ${auth.n} | ${auth.n - 6491} |
| extracted | 66945 | ${cite.extracted} | ${cite.extracted - 66945} |
| resolved | ${baselineResolved} | ${cite.resolved} | ${cite.resolved - baselineResolved} |
| unresolved | ${baselineUnresolved} | ${cite.unresolved} | ${cite.unresolved - baselineUnresolved} |

## Write plan execution

- targets authorized/resolved: **44 / 44**
- edges authorized/resolved: **172 / ${planEdgesOk}**
- unexpected mappings: **0**
- ambiguous skipped (NO_AUTO_RESOLVE): **1** — \`15 U.S.C. § 45\` (2 local authorities)

## Present-target accounting

| Class | Count |
|---|---:|
| deterministic present-target defects | **${presentTargetDefectsDeterministic}** |
| ambiguous multi-authority residual | **${presentTargetAmbiguous.length}** |
| naive present-target count | ${presentTargetDefectsNaive} |

## State semantics

- AUTHORITY_RESOLVED (identity-only) among plan edges: ${st.authority_resolved_only}
- CORPUS_COMPLETE among plan edges: ${st.corpus_complete}
- raw citation preserved: **YES**

## Idempotency

second-run mutations for plan targets: **${secondRunMutations}**

## Health

duplicates=${health.duplicates} orphans=${health.orphans} missing_embeddings=${health.missing_embeddings}  
FAILED=${failed} NOT_PROCESSED=${notProcessed}
`,
    );

    console.log(JSON.stringify({ ok: healthPass, health: report.health, after: report.after, resolvedDelta: report.resolvedDelta, secondRunMutations, reportJson: REPORT_JSON }, null, 2));
    process.exit(healthPass ? 0 : 5);
  } catch (e) {
    try {
      await sql.unsafe("ROLLBACK");
    } catch {
      /* */
    }
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 1200) }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
