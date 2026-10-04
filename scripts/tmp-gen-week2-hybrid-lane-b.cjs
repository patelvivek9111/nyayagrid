"use strict";
const fs = require("fs");
let s = fs.readFileSync("scripts/run-tmp-queue2-cite-demand-scale4.cjs", "utf8");

s = s.replace("Citation-demand Adaptive Scale 4", "Week2 Hybrid Lane B — U.S. citation-demand");
s = s.replaceAll("queue2-cite-demand-scale4-ops.json", "week2-hybrid-closeout-lane-b-ops.json");
s = s.replaceAll("CITE_SCALE4_", "WEEK2_HYBRID_LANEB_");
s = s.replace(
  /const BUDGET = Math\.min\(Math\.max\(Number\(process\.env\.WEEK2_HYBRID_LANEB_BUDGET \|\| 100\), 20\), 150\);/,
  `const BUDGET = Math.min(Math.max(Number(process.argv[2] || process.env.WEEK2_HYBRID_LANEB_BUDGET || 100), 20), 150);`,
);
s = s.replaceAll("CITATION_DEMAND_ADAPTIVE_SCALE_4", "WEEK2_HYBRID_LANE_B_CITATION");
s = s.replaceAll("adaptiveScale4", "week2HybridLaneB");
s = s.replaceAll("SCALE4", "HYBRID_B");
s = s.replaceAll('block: "scale4"', 'block: "week2_hybrid_lane_b"');
s = s.replaceAll('block: "adaptive_scale_4"', 'block: "week2_hybrid_lane_b"');

// Force US-only weights always
s = s.replace(
  /\/\/ Scale4: US-dominant[\s\S]*?w\.federal_reporter = 0;\s*\}/,
  `// Hybrid Lane B: always US-only
  {
    w.us_reports = 1;
    w.regional_reporter = 0;
    w.federal_reporter = 0;
  }`,
);

// Live 12.5 tracking alongside 10%
s = s.replace(
  "acc.liveTenPercentTarget = Math.ceil(0.1 * endExtracted);",
  `acc.liveTenPercentTarget = Math.ceil(0.1 * endExtracted);
  acc.live12_5Target = Math.ceil(0.125 * endExtracted);
  acc.liveRemainingTo12_5 = acc.live12_5Target - endResolved;`,
);

// Do not resume Scale4 history — wipe prior if classification mismatch
s = s.replace(
  "if (fs.existsSync(OUT)) {\n    try { prior = JSON.parse(fs.readFileSync(OUT, \"utf8\")); } catch { prior = null; }\n  }",
  `if (fs.existsSync(OUT)) {
    try {
      prior = JSON.parse(fs.readFileSync(OUT, "utf8"));
      if (prior?.classification !== "WEEK2_HYBRID_LANE_B_CITATION") prior = null;
    } catch { prior = null; }
  }`,
);

fs.writeFileSync("scripts/run-tmp-week2-hybrid-lane-b-cite.cjs", s);
console.log(JSON.stringify({
  ok: true,
  bytes: s.length,
  out: s.includes("week2-hybrid-closeout-lane-b-ops.json"),
  env: s.includes("WEEK2_HYBRID_LANEB_BUDGET"),
  usOnly: s.includes("always US-only"),
}, null, 2));
