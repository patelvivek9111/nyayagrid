/**
 * Citation Resolution Engine Phase 1 — Neon dry-run + write plan.
 * READ-ONLY by default. Zero CourtListener. Zero mutations.
 *
 * Env: DATABASE_URL, NODE_PATH (for postgres)
 * Gate: prints CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const postgres = require("postgres");
const {
  LocalAuthorityIndex,
  buildUnresolvedTargetQueue,
  dryRunLocalHighResolver,
  planGlobalBackfill,
  selectDemandFullTextTargets,
  runIdentityBatch,
  emptyCheckpoint,
  CL_LOOKUP_TEXTS_PER_REQUEST,
  CL_QUOTA_DEFAULTS,
  writeJsonAtomic,
} = require("../packages/research/src/corpus/citation-resolution/cjs-bridge.cjs");

const REPORT_DIR = path.join(__dirname, "..", "packages/research/corpus/resolution");
const REPORT_MD = path.join(
  __dirname,
  "..",
  "packages/research/corpus/reports/citation-resolution-engine-phase1-2026-10-09.md",
);

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  if (/localhost|127\.0\.0\.1|:5433/i.test(url) && process.env.CITATION_RESOLUTION_ALLOW_LOCALHOST !== "1") {
    console.log(JSON.stringify({ ok: false, reason: "refusing localhost" }));
    process.exit(3);
  }
  if (process.env.CITATION_RESOLUTION_APPLY === "1" && process.env.CITATION_LOCAL_WRITE_AUTHORIZED !== "1") {
    console.log("CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED");
    console.log(JSON.stringify({ ok: false, reason: "write not authorized", courtListenerHttpCalls: 0, corpusMutations: 0 }));
    process.exit(4);
  }

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 20, connect_timeout: 60 });
  const t0 = Date.now();
  const courtListenerHttpCalls = 0;
  const corpusMutations = 0;

  try {
    await sql.unsafe("BEGIN READ ONLY");
    const edges = await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `;
    const authorities = await sql`
      select id, citation, normalized_citation, title, short_title, court, court_id, decision_date,
             source_provider, source_external_id, authority_type, ingestion_status, metadata,
             exists(
               select 1 from legal_authority_chunks c
               where c.authority_id = legal_authorities.id and c.embedding is not null
               limit 1
             ) as has_embeddings
      from legal_authorities
    `;
    await sql.unsafe("COMMIT");

    const indexMs0 = Date.now();
    const authRows = authorities.map((a) => ({
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
      corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
    }));
    const index = new LocalAuthorityIndex(authRows);
    const indexMs = Date.now() - indexMs0;

    const edgeRows = edges.map((e) => ({
      id: e.id,
      fromAuthorityId: e.from_authority_id,
      rawCitation: e.raw_citation,
      normalizedCitation: e.normalized_citation,
      createdAt: e.created_at,
      fromCourtId: e.from_court_id,
      fromCourt: e.from_court,
    }));

    const queueMs0 = Date.now();
    const queue = buildUnresolvedTargetQueue(edgeRows, index);
    const queueMs = Date.now() - queueMs0;

    const dry = dryRunLocalHighResolver(queue.targets, index);
    const backfill = planGlobalBackfill(
      edgeRows,
      dry.proposals.map((p) => ({
        targetKey: p.targetKey,
        toAuthorityId: p.toAuthorityId,
        method: p.method,
      })),
    );
    const fullTextKeys = selectDemandFullTextTargets(queue.targets);

    const sample = queue.targets
      .filter((t) => t.lookupSuitable && t.localCandidateStatus === "NO_LOCAL_MATCH")
      .slice(0, 12);
    const fixtures = {};
    for (let i = 0; i < Math.min(4, sample.length); i++) {
      fixtures[sample[i].normalizedCitation] = [
        { status: 200, clusters: [{ id: 1000 + i, citations: [sample[i].normalizedCitation], case_name: "Fixture Case" }] },
      ];
    }
    if (sample[4]) {
      fixtures[sample[4].normalizedCitation] = [
        {
          status: 200,
          clusters: [
            { id: 1, citations: [sample[4].normalizedCitation] },
            { id: 2, citations: [sample[4].normalizedCitation] },
          ],
        },
      ];
    }
    const sim = await runIdentityBatch({
      texts: sample.map((t) => t.normalizedCitation),
      checkpoint: emptyCheckpoint(),
      fixtures,
      maxRequests: sample.length,
    });

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const writePlan = {
      generatedAt: new Date().toISOString(),
      gate: "CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED",
      courtListenerHttpCalls,
      corpusMutations,
      diagnosticBaseline: { highTargets: 44, highEdges: 172 },
      reproduced: {
        highTargets: dry.highTargets,
        highEdges: dry.highEdges,
        ambiguousSkipped: dry.ambiguousSkipped,
        ambiguousAutoResolved: 0,
      },
      proposals: dry.proposals.map((p) => ({
        targetKey: p.targetKey,
        toAuthorityId: p.toAuthorityId,
        method: p.method,
        confidence: p.confidence,
        edgeCount: p.edgeCount,
        edgeIds: p.edgeIds,
        rawCitation: p.rawCitation,
        normalizedCitation: p.normalizedCitation,
        evidence: p.evidence,
      })),
      backfill: { edgesPlanned: backfill.edgesPlanned, uniqueTargets: backfill.uniqueTargets },
      queue: {
        unresolvedEdges: queue.unresolvedEdges,
        uniqueTargets: queue.uniqueTargets,
        dedupRatio: queue.dedupRatio,
        lookupSuitable: queue.lookupSuitable,
      },
      performance: { indexMs, queueMs, totalMs: Date.now() - t0, indexStats: index.stats },
      fullTextDemandTargets: fullTextKeys.length,
      clClient: {
        textsPerRequest: CL_LOOKUP_TEXTS_PER_REQUEST,
        quotaDefaults: CL_QUOTA_DEFAULTS,
        mockBatch: {
          requests: sim.checkpoint.requestsConsumed,
          resolved: sim.checkpoint.resolved,
          ambiguous: sim.checkpoint.ambiguous,
          notFound: sim.checkpoint.notFound,
        },
        liveCalls: 0,
      },
      schema: {
        sharedProductMigrationRequired: false,
        edgeIdentityColumn: "legal_authority_citations.to_authority_id",
        provenance: "packages/research/corpus/resolution/ledger (JSONL)",
        aliases: "legal_authorities.metadata.citationAliases|parallelCitations",
        corpusComplete: "ingestion_status + legal_authority_chunks.embedding",
      },
    };

    const planPath = path.join(REPORT_DIR, "local-high-write-plan-2026-10-09.json");
    writeJsonAtomic(planPath, writePlan);

    const md = `# Citation Resolution Engine — Phase 1

**Date:** 2026-10-09  
**Classification:** \`CITATION_RESOLUTION_ENGINE_PHASE1\`  
**CourtListener calls:** **0**  
**Corpus mutations:** **0**  

## Gate

\`\`\`
CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED
\`\`\`

Local HIGH dry-run: **${dry.highTargets}** targets / **${dry.highEdges}** edges  
(diagnostic baseline: 44 / 172). Ambiguous auto-resolved: **${dry.ambiguousSkipped}**.

Write plan: \`packages/research/corpus/resolution/local-high-write-plan-2026-10-09.json\`

## Queue

| Metric | Value |
|---|---:|
| unresolved edges | ${queue.unresolvedEdges} |
| unique targets | ${queue.uniqueTargets} |
| dedup ratio | ${Number(queue.dedupRatio).toFixed(3)} |
| lookup-suitable | ${queue.lookupSuitable} |
| demand full-text candidates | ${fullTextKeys.length} |

## Performance

| Step | ms |
|---|---:|
| index | ${indexMs} |
| queue | ${queueMs} |
| total | ${Date.now() - t0} |

## Schema

Shared product migration required: **NO**

## CL identity client

Implemented (live disabled). Texts/request: **${CL_LOOKUP_TEXTS_PER_REQUEST}**.  
Mock: resolved=${sim.checkpoint.resolved} ambiguous=${sim.checkpoint.ambiguous} not_found=${sim.checkpoint.notFound}
`;
    fs.writeFileSync(REPORT_MD, md, "utf8");

    console.log("CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED");
    console.log(
      JSON.stringify(
        {
          ok: true,
          gate: "CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED",
          courtListenerHttpCalls,
          corpusMutations,
          highTargets: dry.highTargets,
          highEdges: dry.highEdges,
          ambiguousSkipped: dry.ambiguousSkipped,
          ambiguousAutoResolved: 0,
          uniqueTargets: queue.uniqueTargets,
          unresolvedEdges: queue.unresolvedEdges,
          backfillEdges: backfill.edgesPlanned,
          indexMs,
          queueMs,
          writePlan: planPath,
          reportMd: REPORT_MD,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    try {
      await sql.unsafe("ROLLBACK");
    } catch {
      /* */
    }
    console.log(JSON.stringify({ ok: false, err: String(e.message || e).slice(0, 1200), courtListenerHttpCalls, corpusMutations }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
