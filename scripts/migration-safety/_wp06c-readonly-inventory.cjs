/* WP-06C read-only inventory — never prints URLs/passwords. Bundle with esbuild for Fly. */
const crypto = require("crypto");
const postgres = require("postgres");

function fingerprint(url) {
  const u = new URL(url);
  const ep = (u.hostname.match(/^(ep-[a-z0-9-]+)/i) || [])[1] || null;
  return {
    dbName: u.pathname.replace(/^\//, "").split("?")[0] || null,
    role: decodeURIComponent(u.username || "") || null,
    hostHash: crypto.createHash("sha256").update(u.hostname).digest("hex").slice(0, 16),
    neonEndpointId: ep,
    isNeon: /neon\.tech$/i.test(u.hostname),
  };
}

function endpointBase(ep) {
  return (ep || "").replace(/-pooler$/i, "");
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_missing");

  const expected = {
    projectId: process.env.EXPECTED_NEON_PROJECT_ID || null,
    branchId: process.env.EXPECTED_NEON_BRANCH_ID || null,
    endpointId: process.env.EXPECTED_NEON_ENDPOINT_ID || null,
    dbName: process.env.EXPECTED_MIGRATE_DB_NAME || null,
  };

  const fp = fingerprint(url);
  const blockers = [];
  if (expected.dbName && fp.dbName !== expected.dbName) blockers.push("DB_NAME_MISMATCH");
  if (
    expected.endpointId &&
    endpointBase(fp.neonEndpointId) !== endpointBase(expected.endpointId)
  ) {
    blockers.push("ENDPOINT_MISMATCH");
  }
  if (/corpus/i.test(fp.role || "")) blockers.push("CORPUS_ROLE");

  const out = {
    classification: "NYAYAGRID_WP06C_READONLY_INVENTORY",
    mode: "READ_ONLY",
    appEnv: process.env.APP_ENV || null,
    expected,
    fingerprint: fp,
    blockers,
  };

  if (blockers.length) {
    out.result = "BLOCKED";
    console.log(JSON.stringify(out, null, 2));
    process.exit(2);
  }

  const sql = postgres(url, { max: 1, ssl: "require", prepare: false });
  try {
    const id = await sql`select current_database() as db, current_user as usr, version() as v`;
    out.live = {
      database: id[0].db,
      user: id[0].usr,
      pgMajor: String(id[0].v).split(" ")[1] || null,
    };

    const journalExists = await sql`select to_regclass('drizzle.__drizzle_migrations') as r`;
    if (!journalExists[0].r) {
      out.journal = { present: false };
    } else {
      const rows = await sql`
        select id, hash, created_at
        from drizzle.__drizzle_migrations
        order by created_at
      `;
      out.journal = {
        present: true,
        count: rows.length,
        createdAtValues: rows.map((r) => String(r.created_at)),
        hashes: rows.map((r) => String(r.hash)),
        maxCreatedAt: rows.length ? String(rows[rows.length - 1].created_at) : null,
        atOrAfter17883: rows.filter((r) => Number(r.created_at) >= 1788300000000).length,
      };
    }

    const want = [
      "organizations",
      "users",
      "clients",
      "matters",
      "documents",
      "invoices",
      "time_entries",
      "criminal_cases",
      "contacts",
      "client_contacts",
      "document_folders",
      "prosecution_case_memories",
      "prosecution_graph_nodes",
      "prosecution_graph_edges",
      "student_cases",
      "guide_documents",
      "legal_authorities",
      "prosecution_discovery_items",
    ];
    const tables = await sql`
      select table_name from information_schema.tables
      where table_schema='public' and table_name = any(${want})
      order by 1
    `;
    const present = new Set(tables.map((t) => t.table_name));
    out.tables = {
      present: want.filter((t) => present.has(t)),
      missing: want.filter((t) => !present.has(t)),
    };

    const pubCount = await sql`
      select count(*)::int as n from information_schema.tables where table_schema='public'
    `;
    out.publicTableCount = pubCount[0].n;

    async function cols(table) {
      if (!present.has(table)) return null;
      const rows = await sql`
        select column_name from information_schema.columns
        where table_schema='public' and table_name=${table}
        order by ordinal_position
      `;
      return rows.map((r) => r.column_name);
    }
    out.columns = {
      time_entries: await cols("time_entries"),
      invoices: await cols("invoices"),
    };

    const counts = {};
    for (const t of [
      "organizations",
      "users",
      "clients",
      "matters",
      "documents",
      "invoices",
      "time_entries",
    ]) {
      if (present.has(t)) {
        const r = await sql.unsafe(`select count(*)::int as n from ${t}`);
        counts[t] = r[0].n;
      }
    }
    out.rowCounts = counts;
    out.corpusMarkers = { legal_authorities: present.has("legal_authorities") };
    out.result = "OK";
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  const msg = String(err && err.message ? err.message : err).replace(
    /[a-z][a-z0-9+.-]*:\/\/[^\s'"]+/gi,
    "[redacted]",
  );
  console.error(JSON.stringify({ result: "BLOCKED", error: msg }));
  process.exit(2);
});
