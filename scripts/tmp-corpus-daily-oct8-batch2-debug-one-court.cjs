#!/usr/bin/env node
"use strict";
const postgres = require("postgres");
const CL_BASE = "https://www.courtlistener.com/api/rest/v4";

async function main() {
  const apiKey = process.env.COURTLISTENER_API_KEY?.trim();
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", idle_timeout: 10, connect_timeout: 40 });
  try {
    const [row] = await sql`
      select id, citation, source_external_id, metadata
      from legal_authorities
      where court_id='us-circuit-unspecified' and citation ~* 'F\\.(2d|3d|4th)'
      order by created_at desc limit 1
    `;
    const opinionId = (String(row.source_external_id || "").match(/cl-opinion-(\d+)/) || [])[1];
    const oRes = await fetch(`${CL_BASE}/opinions/${opinionId}/`, {
      headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
    });
    const opinion = await oRes.json();
    const clusterField = opinion.cluster;
    let clusterId = null;
    if (typeof clusterField === "string") {
      const m = clusterField.match(/\/clusters\/(\d+)/);
      clusterId = m ? m[1] : null;
    } else if (typeof clusterField === "number") clusterId = String(clusterField);
    else if (clusterField && typeof clusterField === "object") clusterId = String(clusterField.id);

    let cluster = null;
    if (clusterId) {
      const cRes = await fetch(`${CL_BASE}/clusters/${clusterId}/`, {
        headers: { Authorization: `Token ${apiKey}`, Accept: "application/json" },
      });
      cluster = await cRes.json();
    }

    console.log(
      JSON.stringify(
        {
          citation: row.citation,
          opinionId,
          opinionStatus: oRes.status,
          clusterField,
          clusterId,
          clusterCourt: cluster?.court,
          clusterCourtId: cluster?.court_id,
          clusterKeys: cluster ? Object.keys(cluster).slice(0, 30) : null,
          courtListenerHttpCalls: clusterId ? 2 : 1,
        },
        null,
        2,
      ),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
main();
