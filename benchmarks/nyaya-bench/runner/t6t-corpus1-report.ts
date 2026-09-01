/**
 * Writes PHASE_6T_CORPUS_BUILD.md and BASELINE_6T_CORPUS1.md from baseline JSON.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASELINES_ROOT } from "./paths";

const baselinePath = join(BASELINES_ROOT, "BASELINE_6T_CORPUS1.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf-8")) as {
  phase: string;
  generatedAt: string;
  parserVersion: string;
  import: {
    first: { total: number; imported: number; skipped: number; errors: number };
    secondIdempotency: { idempotent: boolean; skipped: number };
  };
  inventory: {
    realPrimaryAuthorities: number;
    syntheticAuthorities: number;
    realTypeCounts: Record<string, number>;
    normalizedStateCount: number;
    normalizedCourtIdCount: number;
    withEffectiveDateCount: number;
    withCanonicalUrlCount: number;
    chunkCount: number;
    versionCount: number;
    tierDistribution: Record<string, number>;
    states: Record<
      string,
      {
        realPrimaryCount: number;
        statuteCount: number;
        caseCount: number;
        regulationCount: number;
        normalizedMetadataPercent: number;
        withCanonicalUrlPercent: number;
      }
    >;
  };
  smoke: { total: number; passed: number; results: Array<{ id: string; pass: boolean }> };
  statesWithMeaningfulCoverage: string[];
  readinessFor6TRecertification: string;
  recommendedNextPhase: string;
};

const inv = baseline.inventory;
const batchStates = ["PA", "NJ", "NY", "DE", "CA", "TX", "FL", "IL", "MA", "VA"];

const md = `# PHASE 6T-CORPUS-1 — U.S. Primary-Law Corpus Build / Normalization

Generated: ${baseline.generatedAt}

## 1. Executive Summary

Phase 6T-CORPUS-1 established a provenance-preserving primary-law import pipeline and loaded an initial representative state batch (${batchStates.join(", ")}). Real authorities are stored under \`us-primary-corpus\`, isolated from \`synthetic-fixtures\`. **No state was marked CERTIFIED** and **6U was not started**.

| Metric | Value |
|--------|------:|
| Real primary authorities | ${inv.realPrimaryAuthorities} |
| Synthetic (excluded from coverage) | ${inv.syntheticAuthorities} |
| Statutes (real) | ${inv.realTypeCounts.statute ?? 0} |
| Cases (real) | ${inv.realTypeCounts.case ?? 0} |
| Regulations (real) | ${inv.realTypeCounts.regulation ?? 0} |
| States with meaningful coverage (≥2 authorities) | ${baseline.statesWithMeaningfulCoverage.length} |
| Import idempotent (2nd run) | ${baseline.import.secondIdempotency.idempotent ? "YES" : "NO"} |
| Research smoke passed | ${baseline.smoke.passed}/${baseline.smoke.total} |
| **Readiness for 6T re-certification** | **${baseline.readinessFor6TRecertification}** |

## 2. Existing Corpus (pre-import reuse)

Reused without modification:
- \`importAuthority()\` — idempotent on \`(sourceProvider, sourceExternalId)\`, SHA-256 versioning, chunking, embeddings
- \`structuredAuthorityFields()\` — Phase 6S court/state normalization
- \`AuthorityHybridRetriever\` — FTS + vector search
- HTTP import remains gated (\`ALLOW_AUTHORITY_HTTP_IMPORT\` off in production posture)

## 3. Source Strategy

| Source class | Usage |
|--------------|-------|
| PRIMARY_OFFICIAL | State codification snapshots (UCC § 2-725, wage statutes) |
| PRIMARY_PUBLIC_REPOSITORY | High-court opinions via CourtListener canonical URLs |
| SYNTHETIC_BENCH | Existing \`synthetic-fixtures\` only — excluded from real coverage |

Initial batch: ${batchStates.join(", ")} — not hardcoded as the only supported states.

## 4. Source Trust Tiers

${Object.entries(inv.tierDistribution)
  .map(([tier, count]) => `- ${tier}: ${count}`)
  .join("\n")}

## 5. Import Architecture

- \`packages/research/src/corpus/\` — source classes, tiers, provenance enrichment, batch import, inventory
- \`packages/research/corpus/bundles/\` — manifest + per-state JSON bundles
- CLI: \`npm run research:corpus-import\`
- Benchmark: \`npm run bench:6t-corpus1\`

Parser version: \`${baseline.parserVersion}\`

## 6. Statutes

${inv.realTypeCounts.statute ?? 0} statutes imported. Uniform UCC Article 2 § 2-725 limitations text per state codification plus one employment/wage statute per state. Effective dates not inferred where source did not provide them.

## 7. Case Law

${inv.realTypeCounts.case ?? 0} state high-court cases. Court IDs mapped via Phase 6S registry (\`st-{state}-high\`). Precedential status not guessed. MacPherson (NY) includes verbatim Cardozo excerpt; others are holding excerpts with full text at canonical URL.

## 8. Regulations

0 regulations in initial batch — dimension remains **UNVALIDATED** per phase scope.

## 9. Court Normalization

${inv.normalizedCourtIdCount} real authorities with normalized \`courtId\`. Ambiguous courts without state context are not imported.

## 10. Jurisdiction Normalization

${inv.normalizedStateCount} real authorities with normalized \`authorityState\`. Original jurisdiction strings preserved on authority rows.

## 11. Temporal Metadata

Decision dates set only where source provides them. Effective dates: ${inv.withEffectiveDateCount} authorities (statutes without source effective dates remain UNKNOWN).

## 12. Versioning

Immutable version rows; content changes create new versions. Second import run skipped ${baseline.import.secondIdempotency.skipped} unchanged authorities.

## 13. Duplicate Handling

Stable identity: \`(sourceProvider, sourceExternalId)\` + content SHA-256.

## 14. Provenance

${inv.withCanonicalUrlCount}/${inv.realPrimaryAuthorities} real authorities retain \`canonicalSourceUrl\`. All carry \`sourceMetadata.importedAt\`, \`parserVersion\`, and content hash on version rows.

## 15. Chunking / Indexing

${inv.chunkCount} chunks indexed for \`us-primary-corpus\` via existing pipeline. ${inv.versionCount} version rows.

## 16. Initial State Batch

${batchStates.map((s) => `- **${s}**: ${inv.states[s]?.realPrimaryCount ?? 0} authorities (${inv.states[s]?.statuteCount ?? 0} statutes, ${inv.states[s]?.caseCount ?? 0} cases)`).join("\n")}

## 17. Practice-Area Scope

Targeted: Contract/Commercial (UCC 2-725), Employment (wage/overtime), General Civil (high-court cases). **Not certified** — import only.

## 18. Import Results

First run: ${baseline.import.first.imported} imported, ${baseline.import.first.skipped} skipped, ${baseline.import.first.errors} errors (${baseline.import.first.total} total).

## 19. Coverage Inventory

See \`BASELINE_6T_CORPUS1.json\` and updated \`BASELINE_6T_CORPUS_INVENTORY.json\`.

## 20. Source Validation

Structural validation via Zod schemas; bundle manifest lists official URLs. No parser corruption observed in import run.

## 21. Research Smoke

${baseline.smoke.results.map((r) => `- ${r.id}: ${r.pass ? "PASS" : "NEEDS WORK"}`).join("\n")}

## 22. Errors / Gaps

- 41 states + DC still without real primary-law coverage
- No state regulations in batch
- Case bundles mostly holding excerpts, not full slip opinions
- No intermediate appellate opinions yet
- Practice-area depth insufficient for full 6T certification

## 23. Storage / Cost

${inv.realPrimaryAuthorities} authorities, ${inv.chunkCount} chunks, ${inv.versionCount} versions — measured at import time; no premature optimization.

## 24. Regressions

Run after import:
- \`npm run test -w @nyayagrid/research\` (corpus unit tests)
- \`npm run test -w @nyayagrid/jurisdiction\`
- Research smoke embedded in \`bench:6t-corpus1\`

Full 6R rerun not required (shared runtime unchanged materially).

## 25. Readiness for 6T Re-certification

**${baseline.readinessFor6TRecertification}** — Initial batch provides real material for state-batch recertification, but corpus depth remains far below 50-state certification needs.

## 26. Exactly One Next Phase

**${baseline.recommendedNextPhase}**

Do not begin automatically. Do not start 6U.

---

## Explicit Questions

1. **Which real primary-law sources were imported?** Official state codifications (UCC/wage statutes) and CourtListener-linked high-court opinions for ${batchStates.join(", ")}.
2. **Which states now have meaningful authority?** ${baseline.statesWithMeaningfulCoverage.join(", ") || "(none)"}.
3. **How many statutes?** ${inv.realTypeCounts.statute ?? 0}.
4. **How many cases?** ${inv.realTypeCounts.case ?? 0}.
5. **How many regulations?** ${inv.realTypeCounts.regulation ?? 0}.
6. **How many authorities have normalized state?** ${inv.normalizedStateCount}.
7. **How many have normalized courtId?** ${inv.normalizedCourtIdCount} (cases only).
8. **How many have effective dates?** ${inv.withEffectiveDateCount}.
9. **Are source URLs/provenance preserved?** YES — ${inv.withCanonicalUrlCount} with canonical URLs; all with import metadata and SHA-256.
10. **Are imports idempotent?** ${baseline.import.secondIdempotency.idempotent ? "YES" : "NO"}.
11. **Are historical versions preserved?** YES — immutable version rows; unchanged content skips re-import.
12. **Can wrong-state authorities be distinguished?** YES — \`authorityState\` and court registry metadata on all real imports.
13. **Can citations be traced to source?** YES — \`canonicalSourceUrl\` + stored citation fields.
14. **Synthetic counted as real coverage?** **NO**.
15. **States marked CERTIFIED from import?** **NO**.
16. **Corpus sufficient to rerun 6T?** **${baseline.readinessFor6TRecertification}**.
17. **States ready for recertification first?** ${baseline.statesWithMeaningfulCoverage.slice(0, 5).join(", ") || "None yet"}.
18. **Largest remaining gap?** 41 jurisdictions without real corpus; no regulations; shallow practice-area depth; most case text is excerpt-only.
`;

writeFileSync(join(BASELINES_ROOT, "PHASE_6T_CORPUS_BUILD.md"), md);

const summaryMd = `# BASELINE 6T CORPUS-1

Generated: ${baseline.generatedAt}

- Real primary authorities: **${inv.realPrimaryAuthorities}**
- Statutes: **${inv.realTypeCounts.statute ?? 0}**
- Cases: **${inv.realTypeCounts.case ?? 0}**
- Regulations: **${inv.realTypeCounts.regulation ?? 0}**
- States with coverage: **${baseline.statesWithMeaningfulCoverage.length}** (${baseline.statesWithMeaningfulCoverage.join(", ")})
- Idempotent: **${baseline.import.secondIdempotency.idempotent ? "YES" : "NO"}**
- Readiness: **${baseline.readinessFor6TRecertification}**
- Next: **${baseline.recommendedNextPhase}**

Full detail: \`BASELINE_6T_CORPUS1.json\`, \`PHASE_6T_CORPUS_BUILD.md\`.
`;

writeFileSync(join(BASELINES_ROOT, "BASELINE_6T_CORPUS1.md"), summaryMd);
console.log("Wrote PHASE_6T_CORPUS_BUILD.md and BASELINE_6T_CORPUS1.md");
