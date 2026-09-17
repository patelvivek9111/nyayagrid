const fs = require("node:fs");
const j = JSON.parse(fs.readFileSync("/tmp/cl-wave-results.json", "utf8"));
const r = j.results || [];
const last = r.length ? r[r.length - 1] : null;
console.log(
  JSON.stringify(
    {
      status: j.status,
      completed: j.completed,
      total: j.total,
      last,
      importedSum: r.reduce((s, x) => s + (Number(x.imported) || 0), 0),
      skippedSum: r.reduce((s, x) => s + (Number(x.skipped) || 0), 0),
      failedSum: r.reduce((s, x) => s + (Number(x.failed) || 0), 0),
      quarantinedSum: r.reduce((s, x) => s + (Number(x.quarantined) || 0), 0),
      apiCallsSum: r.reduce((s, x) => s + (Number(x.apiCalls) || 0), 0),
    },
    null,
    2,
  ),
);
