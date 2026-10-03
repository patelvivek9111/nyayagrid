"use strict";
const fs = require("fs");
let s = fs.readFileSync("scripts/run-tmp-queue2-cite-demand-scale2.cjs", "utf8");

s = s.replace("Citation-demand Adaptive Scale 2", "Citation-demand Adaptive Scale 3");
s = s.replace(
  "US primary / regional secondary / federal tertiary / F.Supp paused",
  "80/20 US/regional start; P.3d regional priority; federal/F.Supp OFF",
);
s = s.replaceAll("queue2-cite-demand-scale2-ops.json", "queue2-cite-demand-scale3-ops.json");
s = s.replaceAll("CITE_SCALE2_", "CITE_SCALE3_");
s = s.replaceAll("CITATION_DEMAND_ADAPTIVE_SCALE_2", "CITATION_DEMAND_ADAPTIVE_SCALE_3");
s = s.replaceAll("adaptiveScale2", "adaptiveScale3");
s = s.replaceAll("cite-demand-scale2-v1", "cite-demand-scale3-v1");
s = s.replaceAll("SCALE2", "SCALE3");
s = s.replaceAll('block: "scale2"', 'block: "scale3"');
s = s.replaceAll('block: "adaptive_scale_1"', 'block: "adaptive_scale_3"');

s = s.replace(
  /const PILOT = \{[\s\S]*?federal_supplement:\s*0,\s*\};/,
  `const PILOT = {
  us_reports: 4.505,
  regional_reporter: 1.946,
  federal_reporter: 1.286,
  federal_supplement: 0,
};`,
);

s = s.replace(
  /if \(totalAcq < 15\) \{[\s\S]*?w\.federal_reporter = 0;\s*\}/,
  `if (totalAcq < 20) {
    w.us_reports = 0.80;
    w.regional_reporter = 0.20;
    w.federal_reporter = 0;
  } else {
    const usR = scores.us_reports.recent;
    const regR = scores.regional_reporter.recent;
    const regAcq = ensureFam(acc, "regional_reporter").acquired || 0;
    if (regR != null && regR < 1.75 && regAcq >= 5) {
      w.us_reports = Math.max(w.us_reports, 0.85);
      w.regional_reporter = Math.min(w.regional_reporter, 0.15);
    }
    if (regR != null && regR < 1.5 && regAcq >= 8) {
      w.us_reports = Math.max(w.us_reports, 0.90);
      w.regional_reporter = Math.min(w.regional_reporter, 0.10);
    }
    if (usR != null && regR != null && regR >= usR * 0.85 && regAcq >= 8) {
      w.regional_reporter = Math.max(w.regional_reporter, 0.25);
    }
    w.federal_reporter = 0;
    const sGate = (w.us_reports || 0) + (w.regional_reporter || 0) || 1;
    w.us_reports /= sGate;
    w.regional_reporter /= sGate;
  }`,
);

s = s.replace(
  /if \(f === "federal_reporter" && Number\(t\.edgeDemand \|\| 0\) < 8\) continue;/,
  'if (f === "federal_reporter") continue; // SCALE3 routine OFF',
);

s = s.replace(
  /if \(s === "S\.E\.2d"\) return 3;\s*if \(s === "P\.3d"\) return 2;\s*if \(s === "F\.2d"\) return 2;\s*return 1;/,
  `if (s === "P.3d") return 5;
        if (s === "P.2d") return 3;
        if (s === "S.E.2d") return 2;
        return 1;`,
);

s = s.replace(
  "sinceAcquired % 15 === 0",
  "([20, 35, 60].includes(acc.targetsAcquired) || (sinceAcquired > 0 && sinceAcquired % 20 === 0))",
);

s = s.replace(
  /const s2 = ACTIVE\.reduce\(\(a, f\) => a \+ w\[f\], 0\) \|\| 1;\s*for \(const f of ACTIVE\) w\[f\] \/= s2;\s*return \{ \.\.\.w, scores \};\s*\}/,
  `w.federal_reporter = 0;
  w.federal_supplement = 0;
  const s2 = (w.us_reports || 0) + (w.regional_reporter || 0) || 1;
  w.us_reports = (w.us_reports || 0) / s2;
  w.regional_reporter = (w.regional_reporter || 0) / s2;
  return { ...w, scores };
}`,
);

if (!s.includes("0.80")) throw new Error("80/20 not applied");
if (!s.includes("SCALE3 routine OFF")) throw new Error("federal off not applied");
if (!s.includes('if (s === "P.3d") return 5')) throw new Error("P.3d priority not applied");
if (!s.includes("queue2-cite-demand-scale3-ops.json")) throw new Error("ops path not applied");

fs.writeFileSync("scripts/run-tmp-queue2-cite-demand-scale3.cjs", s);
console.log(JSON.stringify({
  ok: true,
  bytes: s.length,
  budgetEnv: s.includes("CITE_SCALE3_BUDGET"),
  eighty: true,
  p3d: true,
  fedOff: true,
}, null, 2));
