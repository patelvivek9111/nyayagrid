const { spawnSync } = require("node:child_process");
const sha = "756b85c793b7dea53b0ac9339ee5fb923de3e8f6";
const url = `https://raw.githubusercontent.com/patelvivek9111/nyayagrid/${sha}/scripts/staging-cl-coverage-probe-bundled.cjs`;
const cmd = `node -e "fetch(process.argv[1]).then(r=>{if(!r.ok)throw new Error('http_'+r.status);return r.text()}).then(t=>{require('fs').writeFileSync('/tmp/cl-cov.cjs',t); const {spawnSync}=require('child_process'); const r=spawnSync('node',['/tmp/cl-cov.cjs'],{encoding:'utf8',env:process.env,maxBuffer:16*1024*1024}); process.stdout.write(r.stdout||''); process.exit(r.status||0)}).catch(e=>{console.log(JSON.stringify({ok:false,err:String(e.message||e)}));process.exit(1)})" ${url}`;
const r = spawnSync(
  "flyctl",
  ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", "180", cmd],
  { encoding: "utf8", maxBuffer: 16_000_000 },
);
const out = r.stdout || "";
try {
  const j = JSON.parse(out.trim());
  console.log(
    JSON.stringify(
      {
        totals: j.totals,
        byCourt: (j.byCourt || []).map((x) => ({ id: x.court_id, n: x.n, level: x.court_level, state: x.authority_state })),
        citations: j.citations,
        chunks: j.chunks,
        treatment: j.treatment,
        present: j.courtMapping?.present,
        missingCourts: j.courtMapping?.missingCourts,
        featureAgents: j.featureAgents,
        retrieval: Object.fromEntries(
          Object.entries(j.retrieval || {}).map(([k, v]) => [k, { hits: v.hits, court: v.court }]),
        ),
      },
      null,
      2,
    ),
  );
} catch (e) {
  console.log(out.slice(0, 2000));
  console.error(String(e.message || e));
  process.exit(1);
}
