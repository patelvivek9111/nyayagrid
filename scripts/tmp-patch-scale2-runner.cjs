const fs = require("fs");
const src = "scripts/run-tmp-queue2-cite-demand-scale1.cjs";
const dest = "scripts/run-tmp-queue2-cite-demand-scale2.cjs";
let s = fs.readFileSync(src, "utf8");
s = s.replace("Adaptive Scale 1", "Adaptive Scale 2");
s = s.replaceAll("queue2-cite-demand-scale1-ops.json", "queue2-cite-demand-scale2-ops.json");
s = s.replaceAll("CITE_SCALE1_", "CITE_SCALE2_");
s = s.replaceAll("CITATION_DEMAND_ADAPTIVE_SCALE_1", "CITATION_DEMAND_ADAPTIVE_SCALE_2");
s = s.replaceAll("cite-demand-scale1-v1", "cite-demand-scale2-v1");
s = s.replaceAll("adaptiveScale1", "adaptiveScale2");
s = s.replaceAll('block: "scale1"', 'block: "scale2"');
s = s.replaceAll("=== SCALE1 ", "=== SCALE2 ");
s = s.replaceAll("CITE_SCALE1_DONE", "CITE_SCALE2_DONE");
s = s.replace("us_reports: 4.233", "us_reports: 3.500");
s = s.replace("regional_reporter: 2.192", "regional_reporter: 2.075");
s = s.replace("federal_reporter: 1.333", "federal_reporter: 1.286");
s = s.replace(
  `    w.us_reports = 0.65;
    w.regional_reporter = 0.22;
    w.federal_reporter = 0.13;`,
  `    w.us_reports = 0.70;
    w.regional_reporter = 0.30;
    w.federal_reporter = 0;`,
);
s = s.replace(
  `    if (!by[f] || f === "federal_supplement") continue;
    by[f].push(t);`,
  `    if (!by[f] || f === "federal_supplement") continue;
    // Federal tertiary: only high-demand READY (>=8 live edges)
    if (f === "federal_reporter" && Number(t.edgeDemand || 0) < 8) continue;
    by[f].push(t);`,
);
fs.writeFileSync(dest, s);
console.log(JSON.stringify({
  ok: true,
  hasScale2: s.includes("SCALE2"),
  has70: s.includes("0.70"),
  hasFedFilter: s.includes("edgeDemand || 0) < 8"),
  hasOps2: s.includes("scale2-ops.json"),
}));
