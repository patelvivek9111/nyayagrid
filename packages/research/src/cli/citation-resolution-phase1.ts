/**
 * Citation Resolution Engine — Phase 1 dry-run / write-plan / mock CL batch.
 *
 * Default: READ-ONLY against DATABASE_URL. Zero CourtListener. Zero mutations.
 * Env:
 *   DATABASE_URL (required for live corpus dry-run)
 *   CITATION_RESOLUTION_APPLY=1  → blocked unless CITATION_LOCAL_WRITE_AUTHORIZED=1
 *   CITATION_LOCAL_WRITE_AUTHORIZED=1 → allow apply (still not default)
 *   CITATION_RESOLUTION_CL_QUOTA=1 → optional single quota probe (off by default)
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  CL_LOOKUP_TEXTS_PER_REQUEST,
  CL_QUOTA_DEFAULTS,
  buildUnresolvedTargetQueue,
  dryRunLocalHighResolver,
  emptyCheckpoint,
  LocalAuthorityIndex,
  planGlobalBackfill,
  runIdentityBatch,
  selectDemandFullTextTargets,
  writeJsonAtomic,
  type AuthorityIndexRow,
  type UnresolvedEdgeRow,
} from "../corpus/citation-resolution/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(__dirname, "../../corpus/resolution");
const REPORT_MD = join(
  __dirname,
  "../../corpus/reports/citation-resolution-engine-phase1-2026-10-09.md",
);

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    console.log(JSON.stringify({ ok: false, reason: "DATABASE_URL missing", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  if (/localhost|127\.0\.0\.1|:5433/i.test(url) && process.env.CITATION_RESOLUTION_ALLOW_LOCALHOST !== "1") {
    console.log(JSON.stringify({ ok: false, reason: "refusing localhost; set CITATION_RESOLUTION_ALLOW_LOCALHOST=1 to override" }));
    process.exit(3);
  }

  const applyRequested = process.env.CITATION_RESOLUTION_APPLY === "1";
  const writeAuthorized = process.env.CITATION_LOCAL_WRITE_AUTHORIZED === "1";
  const clQuota = process.env.CITATION_RESOLUTION_CL_QUOTA === "1";

  if (applyRequested && !writeAuthorized) {
    console.log("CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED");
    console.log(JSON.stringify({ ok: false, reason: "write not authorized", courtListenerHttpCalls: 0, corpusMutations: 0 }));
    process.exit(4);
  }

  const sql = postgres(url, { max: 1, ssl: "require", idle_timeout: 20, connect_timeout: 60 });
  const t0 = Date.now();
  let courtListenerHttpCalls = 0;
  let corpusMutations = 0;

  try {
    await sql.unsafe("BEGIN READ ONLY");

    const edges = (await sql`
      select e.id, e.from_authority_id, e.raw_citation, e.normalized_citation, e.created_at,
             a.court_id as from_court_id, a.court as from_court
      from legal_authority_citations e
      left join legal_authorities a on a.id = e.from_authority_id
      where e.to_authority_id is null
    `) as Array<{
      id: string;
      from_authority_id: string;
      raw_citation: string | null;
      normalized_citation: string | null;
      created_at: Date | null;
      from_court_id: string | null;
      from_court: string | null;
    }>;

    const authorities = (await sql`
      select id, citation, normalized_citation, title, short_title, court, court_id, decision_date,
             source_provider, source_external_id, authority_type, ingestion_status, metadata,
             exists(
               select 1 from legal_authority_chunks c
               where c.authority_id = legal_authorities.id and c.embedding is not null
               limit 1
             ) as has_embeddings
      from legal_authorities
    `) as Array<Record<string, unknown>>;

    await sql.unsafe("COMMIT");

    const indexMs0 = Date.now();
    const authRows: AuthorityIndexRow[] = authorities.map((a) => ({
      id: String(a.id),
      citation: (a.citation as string) ?? null,
      normalizedCitation: (a.normalized_citation as string) ?? null,
      title: (a.title as string) ?? null,
      shortTitle: (a.short_title as string) ?? null,
      court: (a.court as string) ?? null,
      courtId: (a.court_id as string) ?? null,
      decisionDate: (a.decision_date as string) ?? null,
      sourceProvider: (a.source_provider as string) ?? null,
      sourceExternalId: (a.source_external_id as string) ?? null,
      authorityType: (a.authority_type as string) ?? null,
      ingestionStatus: (a.ingestion_status as string) ?? null,
      metadata: (a.metadata as Record<string, unknown>) ?? {},
      corpusComplete: Boolean(a.has_embeddings) && a.ingestion_status === "ready",
    }));
    const index = new LocalAuthorityIndex(authRows);
    const indexMs = Date.now() - indexMs0;

    const edgeRows: UnresolvedEdgeRow[] = edges.map((e) => ({
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

    // Mock external identity simulation on a representative sample (no live calls)
    const sample = queue.targets
      .filter((t) => t.lookupSuitable && t.localCandidateStatus === "NO_LOCAL_MATCH")
      .slice(0, 12);
    const fixtures: Record<string, unknown> = {};
    for (const t of sample.slice(0, 4)) {
      fixtures[t.normalizedCitation] = [
        {
          status: 200,
          clusters: [{ id: 1000 + sample.indexOf(t), citations: [t.normalizedCitation], case_name: "Fixture Case" }],
        },
      ];
    }
    // Force one ambiguous + one miss in the sample set
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

    mkdirSync(REPORT_DIR, { recursive: true });
    const writePlan = {
      generatedAt: new Date().toISOString(),
      gate: "CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED",
      courtListenerHttpCalls: 0,
      corpusMutations: 0,
      diagnosticBaseline: { highTargets: 44, highEdges: 172 },
      reproduced: { highTargets: dry.highTargets, highEdges: dry.highEdges, ambiguousAutoResolved: dry.ambiguousSkipped },
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
        liveCalls: courtListenerHttpCalls,
      },
      schema: {
        sharedProductMigrationRequired: false,
        edgeIdentityColumn: "legal_authority_citations.to_authority_id",
        provenance: "packages/research/corpus/resolution/ledger (JSONL)",
        aliases: "legal_authorities.metadata.citationAliases|parallelCitations",
        corpusComplete: "ingestion_status + legal_authority_chunks.embedding",
      },
    };

    writeJsonAtomic(join(REPORT_DIR, "local-high-write-plan-2026-10-09.json"), writePlan);

    const md = `# Citation Resolution Engine — Phase 1

**Date:** 2026-10-09  
**Classification:** \`CITATION_RESOLUTION_ENGINE_PHASE1\`  
**CourtListener calls:** **${courtListenerHttpCalls}**  
**Corpus mutations:** **${corpusMutations}**  

## Gate

\`\`\`
CITATION_LOCAL_WRITE_AUTHORIZATION_REQUIRED
\`\`\`

Local HIGH dry-run reproduced **${dry.highTargets}** targets / **${dry.highEdges}** edges  
(diagnostic baseline: 44 / 172). Ambiguous auto-resolved: **${dry.ambiguousSkipped}** (must be 0).

Write plan: \`packages/research/corpus/resolution/local-high-write-plan-2026-10-09.json\`

## Queue

| Metric | Value |
|---|---:|
| unresolved edges | ${queue.unresolvedEdges} |
| unique targets | ${queue.uniqueTargets} |
| dedup ratio | ${queue.dedupRatio.toFixed(3)} |
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
Provenance ledger: corpus-owned JSONL under \`packages/research/corpus/resolution/\`  
Identity on edges: existing \`to_authority_id\`  
Aliases: \`metadata.citationAliases\` / \`parallelCitations\`  
CORPUS_COMPLETE: embeddings present + ingestion ready (separate from AUTHORITY_RESOLVED)

## CL identity client

Implemented (live disabled). Texts/request: **${CL_LOOKUP_TEXTS_PER_REQUEST}** (verified from existing ingest).  
Mock sample: resolved=${sim.checkpoint.resolved} ambiguous=${sim.checkpoint.ambiguous} not_found=${sim.checkpoint.notFound}

## Next

Authorize local HIGH write with \`CITATION_LOCAL_WRITE_AUTHORIZED=1\` before any mutation.  
Do not start live identity batch until separately authorized.
`;
    writeFileSync(REPORT_MD, md, "utf8");

    // Optional single quota probe — off by default (liveCalls must stay 0 until live gate)
    if (clQuota) {
      console.log(JSON.stringify({ note: "CITATION_RESOLUTION_CL_QUOTA requested but skipped in this runner default path; use dedicated quota probe script when authorizing CL batch" }));
    }

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
          ambiguousAutoResolved: dry.ambiguousSkipped,
          uniqueTargets: queue.uniqueTargets,
          unresolvedEdges: queue.unresolvedEdges,
          backfillEdges: backfill.edgesPlanned,
          indexMs,
          queueMs,
          writePlan: join(REPORT_DIR, "local-high-write-plan-2026-10-09.json"),
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
    console.log(JSON.stringify({ ok: false, err: String((e as Error).message || e).slice(0, 1200), courtListenerHttpCalls, corpusMutations }));
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
