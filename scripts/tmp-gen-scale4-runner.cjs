"use strict";
const fs = require("fs");
let s = fs.readFileSync("scripts/run-tmp-queue2-cite-demand-scale3.cjs", "utf8");

s = s.replace("Citation-demand Adaptive Scale 3", "Citation-demand Adaptive Scale 4");
s = s.replace(
  "80/20 US/regional start; P.3d regional priority; federal/F.Supp OFF",
  "US-dominant 95-100%; regional opportunistic fallback; federal/F.Supp OFF; live 10% gap",
);
s = s.replaceAll("queue2-cite-demand-scale3-ops.json", "queue2-cite-demand-scale4-ops.json");
s = s.replaceAll("CITE_SCALE3_", "CITE_SCALE4_");
s = s.replaceAll("CITATION_DEMAND_ADAPTIVE_SCALE_3", "CITATION_DEMAND_ADAPTIVE_SCALE_4");
s = s.replaceAll("adaptiveScale3", "adaptiveScale4");
s = s.replaceAll("cite-demand-scale3-v1", "cite-demand-scale4-v1");
s = s.replaceAll("SCALE3", "SCALE4");
s = s.replaceAll('block: "scale3"', 'block: "scale4"');
s = s.replaceAll('block: "adaptive_scale_3"', 'block: "adaptive_scale_4"');

s = s.replace(
  /const PILOT = \{[\s\S]*?federal_supplement:\s*0,\s*\};/,
  `const PILOT = {
  us_reports: 3.757,
  regional_reporter: 0.769,
  federal_reporter: 1.286,
  federal_supplement: 0,
};`,
);

// Starting allocation: 100% US; regional only on fallback triggers
s = s.replace(
  /if \(totalAcq < 20\) \{[\s\S]*?w\.regional_reporter \/= sGate;\s*\}/,
  `// Scale4: US-dominant. Regional only if US decay or high-demand P.3d fallback.
  {
    const usR = scores.us_reports.recent;
    const usCum = scores.us_reports.cum;
    const usAcq = ensureFam(acc, "us_reports").acquired || 0;
    const usDecay = usR != null && usAcq >= 15 && usR < 0.5 * PILOT.us_reports;
    const usWeak = usR != null && usAcq >= 20 && usR < 2.0;
    const allowRegional = Boolean(acc.forceRegionalFallback) || usDecay || usWeak;
    if (!allowRegional) {
      w.us_reports = 1;
      w.regional_reporter = 0;
      w.federal_reporter = 0;
    } else {
      w.us_reports = 0.95;
      w.regional_reporter = 0.05;
      w.federal_reporter = 0;
    }
  }`,
);

// Keep federal OFF (already in scale3)
if (!s.includes("SCALE4 routine OFF") && !s.includes("federal_reporter\") continue")) {
  s = s.replace(
    /if \(f === "federal_reporter"\) continue;[^\n]*/,
    'if (f === "federal_reporter") continue; // SCALE4 routine OFF',
  );
}

// Regional pickQueues: only P.3d by default unless edgeDemand >= 8
s = s.replace(
  /const f = t\.citationFamily;\s*if \(!by\[f\] \|\| f === "federal_supplement"\) continue;/,
  `const f = t.citationFamily;
    if (!by[f] || f === "federal_supplement") continue;
    if (f === "regional_reporter") {
      const sub = subfamilyOf(t.citation);
      const dem = Number(t.edgeDemand || 0);
      // Opportunistic fallback pool: P.3d first; other regional only if unusually high demand
      if (sub !== "P.3d" && dem < 8) continue;
    }`,
);

// Checkpoint every ~15-20 acquires + live 10% tracking fields on finalize already use endExtracted
s = s.replace(
  "([20, 35, 60].includes(acc.targetsAcquired) || (sinceAcquired > 0 && sinceAcquired % 20 === 0))",
  "(sinceAcquired > 0 && (sinceAcquired % 15 === 0 || [20, 35, 50].includes(acc.targetsAcquired)))",
);

// Enrich checkpoint with live 10% fields from reresolve
s = s.replace(
  `const integ = reresolve();
      if ((integ.json?.duplicateSourceIds || 0) > 0 || (integ.json?.orphans || 0) > 0 || (integ.json?.chunks?.missing_embeddings || 0) > 0) {
        acc.stopReason = "integrity_regression";
        break;
      }
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
      fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
    }`,
  `const integ = reresolve();
      if ((integ.json?.duplicateSourceIds || 0) > 0 || (integ.json?.orphans || 0) > 0 || (integ.json?.chunks?.missing_embeddings || 0) > 0) {
        acc.stopReason = "integrity_regression";
        break;
      }
      const liveExtracted = Number(integ.json?.extracted ?? acc.startExtracted);
      const liveResolved = Number(integ.json?.resolvedAfter ?? acc.startResolved);
      const liveTen = Math.ceil(0.1 * liveExtracted);
      const liveGap = liveTen - liveResolved;
      const cp = acc.reallocationLog[acc.reallocationLog.length - 1];
      if (cp) {
        cp.liveExtracted = liveExtracted;
        cp.liveResolved = liveResolved;
        cp.liveResolutionPct = liveExtracted ? +((liveResolved / liveExtracted) * 100).toFixed(2) : null;
        cp.liveTenPercentTarget = liveTen;
        cp.liveRemainingTo10 = liveGap;
        cp.usCumulative = famEdgesPerCl(ensureFam(acc, "us_reports"));
        cp.usRecent = recentEdgesPerCl(ensureFam(acc, "us_reports"), 10);
        if (liveGap <= 0 && !acc.tenPercentMilestone) {
          acc.tenPercentMilestone = {
            reached: true,
            at: new Date().toISOString(),
            checkpoint: cp.checkpoint,
            extracted: liveExtracted,
            resolved: liveResolved,
            resolutionPct: cp.liveResolutionPct,
          };
          process.stdout.write("TEN_PERCENT_MILESTONE_REACHED " + JSON.stringify(acc.tenPercentMilestone) + "\\n");
        }
      }
      // Regional fallback trigger on US weakness
      const usRecentNow = recentEdgesPerCl(ensureFam(acc, "us_reports"), 10);
      if (usRecentNow != null && ensureFam(acc, "us_reports").acquired >= 15 && usRecentNow < 2.0) {
        acc.forceRegionalFallback = true;
        acc.notes.push({ at: new Date().toISOString(), note: "regional_fallback_trigger_us_weak", usRecent: usRecentNow });
      }
      fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
      fs.writeFileSync(OUT, JSON.stringify(acc, null, 2));
    }`,
);

// Add startingGap and US window metrics at end
s = s.replace(
  "acc.integrityFinal = {",
  `const usRows = acc.targetRows.filter((r) => r.family === "us_reports" && r.ingested);
  const windowEpcl = (rows) => {
    if (!rows.length) return null;
    const e = rows.reduce((a, r) => a + Number(r.oldUnresolvedEdgesResolved || 0), 0);
    const c = rows.reduce((a, r) => a + Number(r.totalCLRequests || 0), 0);
    return c ? +(e / c).toFixed(3) : null;
  };
  acc.usWindows = {
    first10: windowEpcl(usRows.slice(0, 10)),
    last10: windowEpcl(usRows.slice(-10)),
    last20: windowEpcl(usRows.slice(-20)),
  };
  acc.startingGapTo10 = Math.ceil(0.1 * sessionStartExtracted) - sessionStartResolved;
  acc.liveTenPercentTarget = Math.ceil(0.1 * endExtracted);
  acc.liveRemainingTo10 = acc.liveTenPercentTarget - endResolved;
  if (acc.liveRemainingTo10 <= 0 && !acc.tenPercentMilestone) {
    acc.tenPercentMilestone = {
      reached: true,
      at: new Date().toISOString(),
      checkpoint: "end",
      extracted: endExtracted,
      resolved: endResolved,
      resolutionPct: +((endResolved / endExtracted) * 100).toFixed(2),
    };
  }
  acc.integrityFinal = {`,
);

if (!s.includes("US-dominant")) throw new Error("header not applied");
if (!s.includes("queue2-cite-demand-scale4-ops.json")) throw new Error("ops path missing");
if (!s.includes("liveTenPercentTarget")) throw new Error("live 10% tracking missing");
if (!s.includes("CITE_SCALE4_BUDGET")) throw new Error("budget env missing");

fs.writeFileSync("scripts/run-tmp-queue2-cite-demand-scale4.cjs", s);
console.log(JSON.stringify({ ok: true, bytes: s.length }, null, 2));
