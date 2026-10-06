#!/usr/bin/env node
"use strict";
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("packages/intelligence/src/prosecution/suppression-holding-screen.json", "utf8"));
const noAuto = new Set([
  "Beck v. Ohio",
  "Henry v. United States",
  "Pennsylvania Board of Probation & Parole v. Scott",
]);
const attached = j.attached.map((a) => ({
  caseName: a.caseName,
  citation: a.citation,
  authorityId: a.authorityId,
  courtId: a.courtId,
  jurisdiction: a.jurisdiction,
  dimension: a.dimension,
  doctrine: a.doctrine,
  proposition: a.proposition,
  sourceSpan: a.sourceSpan,
  sourceText: a.sourceSpan,
  treatment: "UNVERIFIED",
  treatmentVerification: "unknown",
  currentnessStatus: a.currentness,
  canonicalSourceUrl: a.sourceUrl,
  persuasiveOnly: Boolean(a.persuasiveOnly),
  note: a.note,
  sourceSupported: true,
  autoAttach: !noAuto.has(a.caseName) && a.dimension !== "OTHER",
}));
const lines = [
  "/** Generated from certified Neon holding screen. Propositions are source spans only. */",
  `export const SOURCE_BACKED_SUPPRESSION_AUTHORITIES = ${JSON.stringify(attached, null, 2)} as const;`,
  "",
  `export const HOLDING_SCREEN_REJECTED = ${JSON.stringify(j.rejected, null, 2)} as const;`,
  "",
  `export const HOLDING_SCREEN_IDENTITY = ${JSON.stringify(j.identity, null, 2)} as const;`,
  "",
];
fs.writeFileSync("packages/intelligence/src/prosecution/suppression-source-backed.ts", lines.join("\n"));
console.log(JSON.stringify({ attached: attached.length, auto: attached.filter((a) => a.autoAttach).length }));
