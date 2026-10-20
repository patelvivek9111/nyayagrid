const { spawnSync } = require("node:child_process");
const r = spawnSync(
  "flyctl",
  [
    "machine",
    "exec",
    "811d3e3f522648",
    "-a",
    "nyayagrid-staging",
    "--timeout",
    "90",
    `node -e "const k=process.env.COURTLISTENER_API_KEY; if(!k){console.log(JSON.stringify({ok:false,reason:'no_key'}));process.exit(2)} const t0=Date.now(); fetch('https://www.courtlistener.com/api/rest/v4/opinions/?cluster__docket__court=ca11&page_size=1',{headers:{Authorization:'Token '+k,Accept:'application/json'},signal:AbortSignal.timeout(20000)}).then(async r=>{const j=await r.json(); console.log(JSON.stringify({ok:r.ok,status:r.status,retryAfter:r.headers.get('retry-after'),ms:Date.now()-t0,count:(j.results||[]).length,id:j.results&&j.results[0]&&j.results[0].id}))}).catch(e=>console.log(JSON.stringify({ok:false,err:String(e.name||e),ms:Date.now()-t0})))"`,
  ],
  { encoding: "utf8", maxBuffer: 4_000_000 },
);
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 600));
process.exit(r.status ?? 1);
