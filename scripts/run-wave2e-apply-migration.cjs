/**
 * Apply 0016_corpus_refresh.sql on staging via Fly (no secrets printed).
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const sha = process.argv[2] || process.env.GIT_SHA;
if (!sha) {
  console.error("Usage: node scripts/run-wave2e-apply-migration.cjs <git-sha>");
  process.exit(2);
}

const sqlUrl = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/packages/database/drizzle/0016_corpus_refresh.sql`;
const cmd = `node -e "fetch('${sqlUrl}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(async sqlText=>{const postgres=require('postgres'); const sql=postgres(process.env.DATABASE_URL,{max:1,ssl:'require'}); await sql.unsafe(sqlText); const tables=await sql\`select table_name from information_schema.tables where table_name in ('corpus_refresh_jobs','corpus_source_health') order by 1\`; console.log(JSON.stringify({ok:true,tables})); await sql.end({timeout:2})}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e).slice(0,400)}));process.exit(1)})"`;

 // Need postgres on machine — use bundled helper instead
const bundled = path.join("scripts", "staging-wave2e-apply-migration-bundled.cjs");
if (!fs.existsSync(bundled)) {
  console.error("missing bundled migration runner; build first");
  process.exit(2);
}

const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-wave2e-apply-migration-bundled.cjs`;
const run = `node -e "fetch('${url}').then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/w2e-mig.cjs',t); require('/tmp/w2e-mig.cjs')}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})"`;

const r = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "120", run],
  { encoding: "utf8", maxBuffer: 8_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 1500));
process.exit(r.status ?? 1);
