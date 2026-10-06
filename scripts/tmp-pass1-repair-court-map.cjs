#!/usr/bin/env node
/**
 * Repair court mapping for recently ingested authorities with Unknown Court
 * by fetching CourtListener cluster records (citation-verified cluster IDs only).
 */
"use strict";
const postgres = require("postgres");

const CL_BASE = "https://www.courtlistener.com/api/rest/v4";
const CIRCUIT_MAP = {
  scotus: { courtId: "us-scotus", courtLevel: "scotus", authorityState: "US", courtName: "Supreme Court of the United States", federalCircuit: null },
  ca1: { courtId: "us-ca-1", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the First Circuit", federalCircuit: "1" },
  ca2: { courtId: "us-ca-2", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Second Circuit", federalCircuit: "2" },
  ca3: { courtId: "us-ca-3", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Third Circuit", federalCircuit: "3" },
  ca4: { courtId: "us-ca-4", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fourth Circuit", federalCircuit: "4" },
  ca5: { courtId: "us-ca-5", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Fifth Circuit", federalCircuit: "5" },
  ca6: { courtId: "us-ca-6", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Sixth Circuit", federalCircuit: "6" },
  ca7: { courtId: "us-ca-7", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Seventh Circuit", federalCircuit: "7" },
  ca8: { courtId: "us-ca-8", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eighth Circuit", federalCircuit: "8" },
  ca9: { courtId: "us-ca-9", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Ninth Circuit", federalCircuit: "9" },
  ca10: { courtId: "us-ca-10", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Tenth Circuit", federalCircuit: "10" },
  ca11: { courtId: "us-ca-11", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Eleventh Circuit", federalCircuit: "11" },
  cadc: { courtId: "us-ca-dc", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the District of Columbia Circuit", federalCircuit: "dc" },
  cafc: { courtId: "us-ca-fed", courtLevel: "circuit", authorityState: "US", courtName: "United States Court of Appeals for the Federal Circuit", federalCircuit: "fed" },
  paed: { courtId: "us-d-paed", courtLevel: "district", authorityState: "US", courtName: "United States District Court for the Eastern District of Pennsylvania", federalCircuit: "3" },
  pahigh: { courtId: "st-pa-high", courtLevel: "state_high", authorityState: "PA", courtName: "Supreme Court of Pennsylvania", federalCircuit: null },
  pasuperct: { courtId: "st-pa-super", courtLevel: "state_appellate", authorityState: "PA", courtName: "Superior Court of Pennsylvania", federalCircuit: null },
  pasuperiorct: { courtId: "st-pa-super", courtLevel: "state_appellate", authorityState: "PA", courtName: "Superior Court of Pennsylvania", federalCircuit: null },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function mapClCourt(raw) {
  let key = String(raw || "").toLowerCase();
  if (key.includes("/")) key = key.split("/").filter(Boolean).pop() || key;
  key = key.replace(/[^a-z0-9]/g, "");
  if (CIRCUIT_MAP[key]) return { ...CIRCUIT_MAP[key], clCourt: key };
  if (/^pa/.test(key) && /super/.test(key)) return { ...CIRCUIT_MAP.pasuperct, clCourt: key };
  if (/^pa/.test(key) && /(high|supreme)/.test(key)) return { ...CIRCUIT_MAP.pahigh, clCourt: key };
  if (key === "pa") return { ...CIRCUIT_MAP.pahigh, clCourt: key };
  return null;
}

async function main() {
  const clKey = process.env.COURTLISTENER_API_KEY?.trim();
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const ids = String(process.argv[2] || "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!clKey || !databaseUrl || !ids.length) {
    console.log(JSON.stringify({ ok: false, reason: "missing_env_or_ids", courtListenerHttpCalls: 0 }));
    process.exit(2);
  }
  const sql = postgres(databaseUrl, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 30 });
  let apiCalls = 0;
  const results = [];
  try {
    const rows = await sql`
      select id, citation, court, court_id, metadata, canonical_source_url
      from legal_authorities
      where id in ${sql(ids)}
    `;
    for (const row of rows) {
      const meta = row.metadata && typeof row.metadata === "object" ? row.metadata : {};
      let clusterId = meta.clusterId || null;
      if (!clusterId && row.canonical_source_url) {
        const m = String(row.canonical_source_url).match(/\/opinion\/(\d+)\//);
        // URL uses opinion/cluster interchangeably in our writer; prefer metadata later
        clusterId = m ? m[1] : null;
      }
      // Prefer cluster id from ingest results stored in metadata if present
      if (meta && meta.a2TargetCitation && !clusterId) clusterId = null;
      const fromMetaCluster = meta.clusterId || meta.clClusterId;
      if (fromMetaCluster) clusterId = String(fromMetaCluster);

      // Fall back: parse from source_external path via results file is external; use URL opinion id as cluster fetch candidate
      if (!clusterId && row.canonical_source_url) {
        const m = String(row.canonical_source_url).match(/\/opinion\/(\d+)\//);
        clusterId = m ? m[1] : null;
      }
      if (!clusterId) {
        results.push({ id: row.id, citation: row.citation, status: "skipped", reason: "no_cluster_id" });
        continue;
      }

      await sleep(Math.max(Number(process.env.CL_RATE_MS || 5000), 400));
      apiCalls += 1;
      const res = await fetch(`${CL_BASE}/clusters/${clusterId}/`, {
        headers: { Authorization: `Token ${clKey}`, Accept: "application/json" },
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        results.push({ id: row.id, citation: row.citation, status: "failed", reason: `cluster_http_${res.status}`, clusterId });
        if (res.status === 429) break;
        continue;
      }
      const cluster = await res.json();
      let clCourtRaw = cluster.court_id || cluster.court || null;
      let docketId = cluster.docket_id || null;
      if (!clCourtRaw && typeof cluster.docket === "string") {
        const dm = cluster.docket.match(/dockets\/(\d+)/);
        if (dm) docketId = dm[1];
      }
      if (!clCourtRaw && docketId) {
        await sleep(Math.max(Number(process.env.CL_RATE_MS || 5000), 400));
        apiCalls += 1;
        const dRes = await fetch(`${CL_BASE}/dockets/${docketId}/`, {
          headers: { Authorization: `Token ${clKey}`, Accept: "application/json" },
          signal: AbortSignal.timeout(45000),
        });
        if (dRes.status === 429) {
          results.push({ id: row.id, citation: row.citation, status: "failed", reason: "rate_limited", clusterId });
          break;
        }
        if (dRes.ok) {
          const docket = await dRes.json();
          clCourtRaw = docket.court_id || docket.court || null;
        }
      }
      const mapped = mapClCourt(clCourtRaw);
      if (!mapped) {
        results.push({
          id: row.id,
          citation: row.citation,
          status: "unmapped",
          clusterId,
          docketId,
          clCourt: clCourtRaw,
          caseName: cluster.case_name || null,
        });
        continue;
      }
      const nextMeta = {
        ...meta,
        clCourt: mapped.clCourt,
        courtRepairedAt: new Date().toISOString(),
        courtRepairSource: "courtlistener-cluster",
        clusterId: String(cluster.id || clusterId),
      };
      await sql`
        update legal_authorities set
          court = ${mapped.courtName},
          court_id = ${mapped.courtId},
          court_level = ${mapped.courtLevel},
          authority_state = ${mapped.authorityState},
          federal_circuit = ${mapped.federalCircuit},
          jurisdiction = ${mapped.authorityState === "US" ? "United States" : mapped.authorityState},
          metadata = ${sql.json(nextMeta)},
          updated_at = now()
        where id = ${row.id}
      `;
      results.push({
        id: row.id,
        citation: row.citation,
        status: "repaired",
        clusterId: String(cluster.id || clusterId),
        courtId: mapped.courtId,
        court: mapped.courtName,
        clCourt: mapped.clCourt,
        title: cluster.case_name || null,
      });
    }
    console.log(
      JSON.stringify({
        ok: true,
        classification: "PASS1_COURT_MAP_REPAIR",
        courtListenerHttpCalls: apiCalls,
        repaired: results.filter((r) => r.status === "repaired").length,
        results,
      }),
    );
  } catch (e) {
    console.log(
      JSON.stringify({
        ok: false,
        err: String(e.message || e).slice(0, 500),
        courtListenerHttpCalls: apiCalls,
      }),
    );
    process.exit(1);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main();
