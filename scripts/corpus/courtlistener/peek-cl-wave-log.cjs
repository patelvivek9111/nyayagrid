const { spawnSync } = require("node:child_process");

function fly(cmd, timeout = 90) {
  return spawnSync(
    "flyctl",
    ["machine", "exec", "811d3e3f522648", "-a", "nyayagrid-staging", "--timeout", String(timeout), cmd],
    { encoding: "utf8", maxBuffer: 16_000_000 },
  );
}

const log = fly(
  `node -e "const fs=require('fs'); const log=fs.existsSync('/tmp/cl-wave.log')?fs.readFileSync('/tmp/cl-wave.log','utf8'):''; const err=fs.existsSync('/tmp/cl-wave.err')?fs.readFileSync('/tmp/cl-wave.err','utf8'):''; console.log(JSON.stringify({logLen:log.length,errLen:err.length,logTail:log.slice(-4000),errTail:err.slice(-2000)}))"`,
  90,
);
process.stdout.write(log.stdout || "");
process.stderr.write((log.stderr || "").slice(0, 500));
