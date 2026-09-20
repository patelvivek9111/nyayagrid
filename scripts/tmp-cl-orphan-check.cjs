/**
 * One-shot: inspect/kill orphan CL workers on Fly staging. No CourtListener HTTP.
 */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const MACHINE = "811d3e3f522648";
const APP = "nyayagrid-staging";
const doKill = process.argv.includes("--kill");
const root = path.join(__dirname, "..");
const remotePath = "/tmp/tmp-cl-orphan-check.cjs";

const remoteSrc = `
"use strict";
const {execSync}=require("child_process");
const fs=require("fs");
const doKill=${doKill ? "true" : "false"};
const out={doKill, procs:[], files:{}, actions:[]};
try {
  const ps=execSync("ps aux",{encoding:"utf8"});
  out.procs=ps.split("\\n").filter(l=>/node|cl-batch|staging-cl|wave2|courtlistener/i.test(l) && !/tmp-cl-orphan|ps aux/i.test(l));
} catch(e) { out.psErr=String(e.message||e); }
for (const f of ["/tmp/cl-batch.log","/tmp/cl-batch.err","/tmp/cl-batch-result.json","/tmp/cl-batch-status.json","/tmp/cl-batch.pid"]) {
  try {
    const st=fs.statSync(f);
    const rec={size:st.size,mtime:st.mtime.toISOString()};
    if (f.endsWith(".json") || f.endsWith(".pid")) rec.body=fs.readFileSync(f,"utf8").slice(0,2000);
    if (f.endsWith(".err") || f.endsWith(".log")) rec.tail=fs.readFileSync(f,"utf8").slice(-2000);
    out.files[f]=rec;
  } catch { out.files[f]={missing:true}; }
}
if (doKill) {
  for (const line of out.procs) {
    const m=line.trim().split(/\\s+/);
    const pid=Number(m[1]);
    if (!pid || !/staging-cl-batch-job|cl-batch/i.test(line)) continue;
    try { process.kill(pid, "SIGTERM"); out.actions.push({pid, signal:"SIGTERM"}); }
    catch(e) { out.actions.push({pid, err:String(e.message||e)}); }
  }
}
console.log(JSON.stringify(out));
`;

fs.writeFileSync(path.join(root, "scripts/tmp-cl-orphan-remote.cjs"), remoteSrc);
const b64 = Buffer.from(remoteSrc).toString("base64");
const CHUNK = 8000;
for (let i = 0; i < b64.length; i += CHUNK) {
  const part = b64.slice(i, i + CHUNK);
  const cmd =
    i === 0
      ? `node -e "require('fs').writeFileSync('${remotePath}',Buffer.from('${part}','base64'))"`
      : `node -e "require('fs').appendFileSync('${remotePath}',Buffer.from('${part}','base64'))"`;
  const w = spawnSync("flyctl", ["machine", "exec", MACHINE, "-a", APP, "--timeout", "60", cmd], {
    encoding: "utf8",
    maxBuffer: 4_000_000,
  });
  if (w.status !== 0) {
    console.log(JSON.stringify({ ok: false, step: "upload", err: (w.stderr || w.stdout || "").slice(0, 500) }));
    process.exit(1);
  }
}
const r = spawnSync("flyctl", ["machine", "exec", MACHINE, "-a", APP, "--timeout", "90", `node ${remotePath}`], {
  encoding: "utf8",
  maxBuffer: 8_000_000,
});
process.stdout.write(r.stdout || "");
process.stderr.write((r.stderr || "").slice(0, 1500));
process.exit(r.status ?? 1);
