/**
 * WP-03A: read-only identity verification + live corpus census.
 * ZERO CourtListener / ZERO paid AI / ZERO mutations / ZERO migrations.
 *
 * Usage:
 *   node scripts/corpus/wp03a-identity-and-census.cjs
 *
 * Connects to CERTIFICATION_DATABASE_FALLBACK (localhost:5433/nyayagrid)
 * unless DATABASE_URL is already set. Never prints credentials.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const postgres = require("postgres");

const FALLBACK = "postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid";
const REPORT_DIR = path.join("packages", "research", "corpus", "reports");
const REPORT_PATH = path.join(REPORT_DIR, "wp03a-corpus-access-recovery.json");

function redactUrl(url) {
  try {
    const u = new URL(url);
    return {
      protocol: u.protocol.replace(":", ""),
      host: u.hostname,
      port: u.port || "(default)",
      database: u.pathname.replace(/^\//, "").split("?")[0] || "",
      hasUser: Boolean(u.username),
      hasPassword: Boolean(u.password),
    };
  } catch {
    return { parseError: true };
  }
}

function num(v) {
  return v == null ? null : Number(v);
}

async function main() {
  const databaseUrl =
    process.env.DATABASE_URL && process.env.DATABASE_URL.trim()
      ? process.env.DATABASE_URL.trim()
      : FALLBACK;
  const usedFallback = !(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());

  const sql = postgres(databaseUrl, {
    max: 1,
    connect_timeout: 15,
    idle_timeout: 10,
    connection: { application_name: "wp03a-readonly-census" },
  });

  const out = {
    ok: false,
    classification: "NYAYAGRID_WP03A_CORPUS_DATABASE_ACCESS_RECOVERY",
    generatedAt: new Date().toISOString(),
    mutations: 0,
    courtListenerHttpCalls: 0,
    paidAiCalls: 0,
    connection: {
      usedFallback,
      redacted: redactUrl(databaseUrl),
      intended: {
        label: "persistent-local-docker-nyayagrid",
        host: "localhost",
        port: "5433",
        database: "nyayagrid",
      },
    },
    docker: {
      container: "nyayagrid-postgres",
      volume: "nyayagrid_nyayagrid_postgres_data",
      portMapping: "5433:5432",
    },
  };

  try {
    await sql`SET default_transaction_read_only = on`;
    await sql`SET statement_timeout = '120s'`;

    const identity = await sql.begin("READ ONLY", async (tx) => {
      const [srv] = await tx`
        SELECT
          current_database() AS db,
          current_user AS usr,
          current_schema() AS schema,
          inet_server_port() AS server_port,
          current_setting('transaction_read_only') AS txn_ro,
          current_setting('default_transaction_read_only') AS default_ro,
          version() AS version
      `;

      const tableRows = await tx`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name IN (
            'legal_authorities',
            'legal_authority_citations',
            'legal_authority_chunks',
            'legal_authority_embeddings',
            '_prisma_migrations',
            'schema_migrations'
          )
        ORDER BY table_name
      `;
      const tables = tableRows.map((r) => r.table_name);

      let prismaMigrationCount = null;
      if (tables.includes("_prisma_migrations")) {
        const [p] = await tx`SELECT count(*)::int AS n FROM _prisma_migrations`;
        prismaMigrationCount = p.n;
      }

      const identityMatch =
        srv.db === "nyayagrid" &&
        String(out.connection.redacted.port) === "5433" &&
        tables.includes("legal_authorities") &&
        tables.includes("legal_authority_citations");

      return {
        server: {
          db: srv.db,
          usr: srv.usr,
          schema: srv.schema,
          server_port: srv.server_port,
          txn_ro: srv.txn_ro,
          default_ro: srv.default_ro,
          version: String(srv.version).slice(0, 120),
        },
        tables,
        prismaMigrationCount,
        identityMatch,
        readOnlyVerified: String(srv.txn_ro) === "on",
      };
    });

    out.identity = identity;

    if (!identity.identityMatch) {
      out.result = "WP03A_CORPUS_DATABASE_IDENTITY_BLOCKED";
      out.ok = false;
      fs.mkdirSync(REPORT_DIR, { recursive: true });
      fs.writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2) + "\n");
      console.log(JSON.stringify(out, null, 2));
      process.exitCode = 2;
      return;
    }

    const census = await sql.begin("READ ONLY", async (tx) => {
      const [totals] = await tx`
        SELECT
          count(*)::int AS authorities,
          count(*) FILTER (WHERE authority_type = 'case')::int AS cases,
          count(*) FILTER (WHERE authority_type = 'statute')::int AS statutes,
          count(*) FILTER (WHERE authority_type = 'regulation')::int AS regulations,
          count(*) FILTER (WHERE authority_type = 'rule')::int AS rules,
          count(*) FILTER (WHERE authority_type = 'constitution')::int AS constitutions,
          count(*) FILTER (WHERE authority_type = 'administrative_decision')::int AS administrative_decisions,
          count(*) FILTER (WHERE authority_type = 'other')::int AS other_types,
          count(*) FILTER (
            WHERE authority_type = 'case'
              AND (
                authority_state IS NULL
                OR btrim(authority_state) = ''
                OR upper(authority_state) IN ('US', 'FEDERAL', 'FED')
              )
          )::int AS federal_cases,
          count(*) FILTER (
            WHERE authority_type = 'case'
              AND authority_state IS NOT NULL
              AND btrim(authority_state) <> ''
              AND upper(authority_state) NOT IN ('US', 'FEDERAL', 'FED')
          )::int AS state_dc_cases,
          count(*) FILTER (
            WHERE authority_type = 'case' AND lower(coalesce(court_level, '')) = 'scotus'
          )::int AS scotus,
          count(*) FILTER (
            WHERE authority_type = 'case' AND lower(coalesce(court_level, '')) IN ('circuit', 'federal_appellate')
          )::int AS circuits,
          count(*) FILTER (
            WHERE authority_type = 'case' AND lower(coalesce(court_level, '')) IN ('district', 'state_trial', 'federal_district')
          )::int AS district_or_trial,
          count(*) FILTER (
            WHERE authority_type = 'case' AND lower(coalesce(court_level, '')) IN ('state_high', 'high_court')
          )::int AS state_high,
          count(*) FILTER (
            WHERE authority_type = 'case' AND lower(coalesce(court_level, '')) IN ('state_appellate', 'intermediate', 'state_intermediate')
          )::int AS state_intermediate,
          count(*) FILTER (
            WHERE authority_type = 'case'
              AND decision_date IS NOT NULL
              AND extract(year FROM decision_date) < 2000
          )::int AS pre_2000,
          count(*) FILTER (
            WHERE authority_type = 'case'
              AND decision_date IS NOT NULL
              AND extract(year FROM decision_date) < 1980
          )::int AS pre_1980,
          count(DISTINCT court_id) FILTER (WHERE authority_type = 'case')::int AS unique_courts,
          count(DISTINCT authority_state) FILTER (
            WHERE authority_type = 'case' AND authority_state IS NOT NULL AND btrim(authority_state) <> ''
          )::int AS jurisdiction_count,
          min(created_at) AS oldest_created,
          max(created_at) AS newest_created
        FROM legal_authorities
      `;

      const [chunkMeta] = await tx`
        SELECT
          count(*)::int AS chunks,
          count(*) FILTER (WHERE opinion_part IS NOT NULL AND btrim(opinion_part) <> '')::int AS opinion_parts,
          count(DISTINCT authority_id)::int AS authorities_with_chunks,
          count(*) FILTER (WHERE embedding IS NOT NULL)::int AS chunks_with_embedding,
          count(*) FILTER (WHERE search_vector IS NOT NULL AND btrim(search_vector) <> '')::int AS chunks_with_search_vector
        FROM legal_authority_chunks
      `;

      const courtLevels = await tx`
        SELECT coalesce(court_level::text, '(null)') AS court_level, count(*)::int AS n
        FROM legal_authorities
        WHERE authority_type = 'case'
        GROUP BY 1
        ORDER BY n DESC
      `;

      const providers = await tx`
        SELECT coalesce(source_provider, '(null)') AS source_provider, count(*)::int AS n
        FROM legal_authorities
        GROUP BY 1
        ORDER BY n DESC
      `;

      const jurisdictions = await tx`
        SELECT
          coalesce(nullif(btrim(authority_state), ''), 'US') AS j,
          count(*)::int AS authorities,
          count(*) FILTER (WHERE authority_type = 'case')::int AS cases
        FROM legal_authorities
        GROUP BY 1
        ORDER BY cases DESC, j
      `;

      const citeCols = await tx`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'legal_authority_citations'
      `;
      const citeColSet = new Set(citeCols.map((c) => c.column_name));

      const [cites] = await tx`
        SELECT
          count(*)::int AS total_edges,
          count(*) FILTER (WHERE to_authority_id IS NOT NULL)::int AS resolved,
          count(*) FILTER (WHERE to_authority_id IS NULL)::int AS unresolved,
          count(*) FILTER (
            WHERE to_authority_id IS NULL
              AND normalized_citation IS NOT NULL
              AND length(normalized_citation) > 4
          )::int AS target_absent
        FROM legal_authority_citations
      `;

      let ambiguous_status = null;
      let malformed_status = null;
      let out_of_scope_status = null;
      let target_absent_classified = null;
      let resolutionBreakdown = null;
      if (citeColSet.has("citation_target_classification")) {
        const [st] = await tx`
          SELECT
            count(*) FILTER (
              WHERE citation_target_classification ILIKE '%ambiguous%'
            )::int AS ambiguous_status,
            count(*) FILTER (
              WHERE citation_target_classification ILIKE '%malformed%'
            )::int AS malformed_status,
            count(*) FILTER (
              WHERE citation_target_classification ILIKE '%out_of_scope%'
            )::int AS out_of_scope_status,
            count(*) FILTER (
              WHERE citation_target_classification ILIKE '%target_absent%'
                 OR citation_target_classification ILIKE '%TARGET_ABSENT%'
            )::int AS target_absent_classified
          FROM legal_authority_citations
        `;
        ambiguous_status = num(st.ambiguous_status);
        malformed_status = num(st.malformed_status);
        out_of_scope_status = num(st.out_of_scope_status);
        target_absent_classified = num(st.target_absent_classified);
        resolutionBreakdown = await tx`
          SELECT coalesce(citation_target_classification, '(null)') AS status, count(*)::int AS n
          FROM legal_authority_citations
          GROUP BY 1
          ORDER BY n DESC
        `;
      }

      const [dupCases] = await tx`
        SELECT count(*)::int AS n FROM (
          SELECT source_provider, source_external_id
          FROM legal_authorities
          WHERE authority_type = 'case' AND source_external_id IS NOT NULL
          GROUP BY 1, 2
          HAVING count(*) > 1
        ) d
      `;

      const [dupEdges] = await tx`
        SELECT count(*)::int AS n FROM (
          SELECT from_authority_id, coalesce(to_authority_id::text, ''), coalesce(normalized_citation, '')
          FROM legal_authority_citations
          GROUP BY 1, 2, 3
          HAVING count(*) > 1
        ) d
      `;

      const [orphanChunks] = await tx`
        SELECT count(*)::int AS n
        FROM legal_authority_chunks c
        LEFT JOIN legal_authorities a ON a.id = c.authority_id
        WHERE a.id IS NULL
      `;

      const [missingEmb] = await tx`
        SELECT count(*)::int AS n
        FROM legal_authorities a
        WHERE NOT EXISTS (
          SELECT 1 FROM legal_authority_chunks c
          WHERE c.authority_id = a.id AND c.embedding IS NOT NULL
        )
      `;

      const [failedIngest] = await tx`
        SELECT count(*)::int AS n
        FROM legal_authorities
        WHERE ingestion_status::text ILIKE '%fail%'
      `;

      // Keyword retrieval smoke (bounded) — no external calls
      let keywordSample = null;
      try {
        const rows = await tx`
          SELECT id, title, authority_state, court_level, citation
          FROM legal_authorities
          WHERE authority_type = 'case'
            AND (
              title ILIKE '%miranda%'
              OR title ILIKE '%fourth amendment%'
              OR citation ILIKE '%384 U.S. 436%'
              OR normalized_citation ILIKE '%384 us 436%'
            )
          ORDER BY decision_date DESC NULLS LAST
          LIMIT 5
        `;
        keywordSample = { ok: true, hits: rows.length, sampleTitles: rows.map((r) => r.title) };
      } catch (e) {
        keywordSample = { ok: false, err: String(e.message || e).slice(0, 200) };
      }

      // FTS / search_vector smoke if populated
      let ftsSample = null;
      try {
        const [sv] = await tx`
          SELECT count(*)::int AS n
          FROM legal_authority_chunks
          WHERE search_vector IS NOT NULL AND btrim(search_vector) <> ''
        `;
        ftsSample = { chunksWithSearchVector: num(sv.n) };
      } catch (e) {
        ftsSample = { ok: false, err: String(e.message || e).slice(0, 200) };
      }

      // Citation lookup smoke
      let citationLookup = null;
      try {
        const rows = await tx`
          SELECT id, normalized_citation, to_authority_id IS NOT NULL AS resolved,
                 citation_target_classification
          FROM legal_authority_citations
          WHERE normalized_citation IS NOT NULL
          ORDER BY id
          LIMIT 5
        `;
        citationLookup = {
          ok: true,
          sample: rows.length,
          resolvedInSample: rows.filter((r) => r.resolved).length,
        };
      } catch (e) {
        citationLookup = { ok: false, err: String(e.message || e).slice(0, 200) };
      }

      // Semantic index health only (no embedding generation, no vector query requiring query embedding)
      const semantic = {
        attempted: true,
        mode: "index_health_only",
        chunks_with_embedding: num(chunkMeta.chunks_with_embedding),
        authorities_missing_embeddings: num(missingEmb.n),
        note: "Did not run vector similarity queries (would require query embedding / paid or local model).",
      };

      const cases = num(totals.cases) || 0;
      const totalEdges = num(cites.total_edges) || 0;
      const resolved = num(cites.resolved) || 0;

      return {
        definitions: {
          cases: "legal_authorities WHERE authority_type = 'case'",
          authorities: "all rows in legal_authorities",
          opinions:
            "legal_authority_chunks.opinion_part non-empty (no authority_type=opinion enum)",
          clusters: "unavailable — no cluster table in this schema",
          federal_cases: "case rows with null/empty/US/FEDERAL/FED authority_state",
          state_dc_cases: "case rows with non-federal authority_state",
          citation_resolved: "legal_authority_citations.to_authority_id IS NOT NULL",
          target_absent_structural: "to_authority_id IS NULL AND normalized_citation length > 4",
          target_absent_classified: "citation_target_classification ILIKE target_absent",
        },
        totals: {
          authorities: num(totals.authorities),
          cases,
          statutes: num(totals.statutes),
          regulations: num(totals.regulations),
          rules: num(totals.rules),
          constitutions: num(totals.constitutions),
          administrative_decisions: num(totals.administrative_decisions),
          other_types: num(totals.other_types),
          opinion_parts: num(chunkMeta.opinion_parts),
          clusters: null,
          federal_cases: num(totals.federal_cases),
          state_dc_cases: num(totals.state_dc_cases),
          scotus: num(totals.scotus),
          circuits: num(totals.circuits),
          district_or_trial: num(totals.district_or_trial),
          state_high: num(totals.state_high),
          state_intermediate: num(totals.state_intermediate),
          pre_2000: num(totals.pre_2000),
          pre_1980: num(totals.pre_1980),
          unique_courts: num(totals.unique_courts),
          jurisdiction_count: num(totals.jurisdiction_count),
          oldest_created: totals.oldest_created,
          newest_created: totals.newest_created,
          remaining_to_10k: Math.max(0, 10000 - cases),
        },
        courtLevels,
        providers,
        jurisdictions,
        citations: {
          total_edges: totalEdges,
          resolved,
          unresolved: num(cites.unresolved),
          target_absent_structural: num(cites.target_absent),
          target_absent_classified,
          ambiguous_status,
          malformed_status,
          out_of_scope_status,
          resolution_rate: totalEdges > 0 ? Number((resolved / totalEdges).toFixed(4)) : null,
          resolutionBreakdown,
          citeColumns: [...citeColSet].sort(),
        },
        integrity: {
          duplicate_case_source_ids: num(dupCases.n),
          duplicate_citation_edges: num(dupEdges.n),
          orphan_chunks: num(orphanChunks.n),
          chunk_count: num(chunkMeta.chunks),
          authorities_with_chunks: num(chunkMeta.authorities_with_chunks),
          embedding_count: num(chunkMeta.chunks_with_embedding),
          authorities_missing_embeddings: num(missingEmb.n),
          failed_ingestions: num(failedIngest.n),
        },
        retrieval: {
          keyword: keywordSample,
          fts: ftsSample,
          citationLookup,
          semantic,
          hybrid: { attempted: false, reason: "verification-only; no hybrid runner invoked" },
        },
      };
    });

    out.census = census;
    out.ok = true;
    out.result = "WP03A_CORPUS_ACCESS_RECOVERED";
    out.readOnlyVerified = identity.readOnlyVerified;
    out.databaseIdentityVerified = true;
    out.liveCensusComplete = true;

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2) + "\n");
    console.log(JSON.stringify(out, null, 2));
  } catch (e) {
    out.ok = false;
    out.result = "WP03A_CORPUS_ACCESS_ENVIRONMENT_BLOCKED";
    out.error = String(e.message || e).slice(0, 500);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(REPORT_PATH, JSON.stringify(out, null, 2) + "\n");
    console.log(JSON.stringify(out, null, 2));
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
