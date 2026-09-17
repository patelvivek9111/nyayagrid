import { listUsStates } from "@nyayagrid/jurisdiction";
import {
  classifyJurisdictionCoverage,
  type CorpusCoverageClass,
  type CorpusInventory,
} from "./inventory";
import { loadInitialBatchAuthorities, type CorpusManifest } from "./bundles";
import type { CorpusBundleAuthority } from "./batch-import";

export type JurisdictionCoverageRow = {
  jurisdiction: string;
  kind: "federal" | "state";
  statutesPresent: boolean;
  highCourtCasesPresent: boolean;
  intermediateAppellateCasesPresent: boolean;
  trialCasesPresent: boolean;
  regulationsPresent: boolean;
  constitutionPresent: boolean;
  courtHierarchyMetadataPresent: boolean;
  canonicalProvenancePresent: boolean;
  currentnessMetadataPresent: boolean;
  authorityCount: number;
  coverageClass: CorpusCoverageClass;
  sourceBundleFiles: string[];
  notes: string[];
};

export type CorpusCoverageMatrix = {
  generatedAt: string;
  parserVersion: string;
  phase: string;
  bundleAuthorityCount: number;
  federal: JurisdictionCoverageRow;
  states: JurisdictionCoverageRow[];
  summary: {
    statesWithCorpus: number;
    statesNoCorpus: number;
    seed: number;
    limited: number;
    broader: number;
    regulationsAnywhere: boolean;
    circuitCourtsPresent: boolean;
    districtCourtsPresent: boolean;
    cfrPresent: boolean;
  };
  honestClaims: string[];
};

function emptyStateRow(code: string): JurisdictionCoverageRow {
  return {
    jurisdiction: code,
    kind: "state",
    statutesPresent: false,
    highCourtCasesPresent: false,
    intermediateAppellateCasesPresent: false,
    trialCasesPresent: false,
    regulationsPresent: false,
    constitutionPresent: false,
    courtHierarchyMetadataPresent: false,
    canonicalProvenancePresent: false,
    currentnessMetadataPresent: false,
    authorityCount: 0,
    coverageClass: "no_corpus",
    sourceBundleFiles: [],
    notes: ["No authorities in curated seed bundles."],
  };
}

function summarizeAuthorities(
  jurisdiction: string,
  kind: "federal" | "state",
  authorities: CorpusBundleAuthority[],
  bundleFiles: string[],
): JurisdictionCoverageRow {
  const statutes = authorities.filter((a) => a.authorityType === "statute");
  const cases = authorities.filter((a) => a.authorityType === "case");
  const regulations = authorities.filter((a) => a.authorityType === "regulation");
  const constitution = authorities.filter((a) => a.authorityType === "constitution");
  const high = cases.filter(
    (a) => a.courtLevel === "state_high" || a.courtLevel === "scotus",
  );
  const appellate = cases.filter((a) => a.courtLevel === "state_appellate" || a.courtLevel === "circuit");
  const trial = cases.filter((a) => a.courtLevel === "state_trial" || a.courtLevel === "district");
  const hierarchy = authorities.filter((a) => a.courtId || a.courtLevel);
  const provenance = authorities.filter((a) => a.canonicalSourceUrl);
  const currentness = authorities.filter((a) => a.effectiveDate || a.decisionDate);
  const coverageClass = classifyJurisdictionCoverage({
    authorityCount: authorities.length,
    statuteCount: statutes.length,
    caseCount: cases.length,
    regulationCount: regulations.length,
  });
  const notes: string[] = [];
  if (authorities.length > 0 && authorities.length <= 5) {
    notes.push("Seed corpus only — not meaningful full-jurisdiction coverage.");
  }
  if (regulations.length === 0) notes.push("No regulations in seed.");
  if (kind === "federal" && !cases.some((a) => a.courtLevel === "circuit")) {
    notes.push("No U.S. Courts of Appeals opinions in seed.");
  }
  if (kind === "federal" && !cases.some((a) => a.courtLevel === "district")) {
    notes.push("No U.S. District Court opinions in seed.");
  }
  return {
    jurisdiction,
    kind,
    statutesPresent: statutes.length > 0,
    highCourtCasesPresent: high.length > 0,
    intermediateAppellateCasesPresent: appellate.length > 0,
    trialCasesPresent: trial.length > 0,
    regulationsPresent: regulations.length > 0,
    constitutionPresent: constitution.length > 0,
    courtHierarchyMetadataPresent: hierarchy.length > 0,
    canonicalProvenancePresent: provenance.length === authorities.length && authorities.length > 0,
    currentnessMetadataPresent: currentness.length > 0,
    authorityCount: authorities.length,
    coverageClass,
    sourceBundleFiles: bundleFiles,
    notes,
  };
}

export async function buildBundleCoverageMatrix(): Promise<CorpusCoverageMatrix> {
  const { manifest, authorities } = await loadInitialBatchAuthorities();
  return buildCoverageMatrixFromAuthorities(manifest, authorities);
}

export function buildCoverageMatrixFromAuthorities(
  manifest: CorpusManifest,
  authorities: CorpusBundleAuthority[],
): CorpusCoverageMatrix {
  const federalAuth = authorities.filter((a) => (a.authorityState ?? "").toUpperCase() === "US");
  const federalBundles = (manifest.federalBundles ?? []).map((b) => b.bundleFile);
  const federal = summarizeAuthorities("US", "federal", federalAuth, federalBundles);

  const stateCodes = listUsStates().map((s) => s.code);
  // DC is already in US_STATES; do not double-count.
  const states: JurisdictionCoverageRow[] = stateCodes.map((code) => {
    const bundle = manifest.states.find((s) => s.code === code);
    const stateAuth = authorities.filter((a) => (a.authorityState ?? "").toUpperCase() === code);
    if (!bundle && stateAuth.length === 0) return emptyStateRow(code);
    return summarizeAuthorities(code, "state", stateAuth, bundle ? [bundle.bundleFile] : []);
  });

  const withCorpus = states.filter((s) => s.coverageClass !== "no_corpus");
  return {
    generatedAt: new Date().toISOString(),
    parserVersion: manifest.parserVersion,
    phase: manifest.phase,
    bundleAuthorityCount: authorities.length,
    federal,
    states,
    summary: {
      statesWithCorpus: withCorpus.length,
      statesNoCorpus: states.length - withCorpus.length,
      seed: [...states, federal].filter((r) => r.coverageClass === "seed_corpus").length,
      limited: [...states, federal].filter((r) => r.coverageClass === "limited_corpus").length,
      broader: [...states, federal].filter((r) => r.coverageClass === "broader_corpus").length,
      regulationsAnywhere: [...states, federal].some((r) => r.regulationsPresent),
      circuitCourtsPresent: federal.intermediateAppellateCasesPresent,
      districtCourtsPresent: federal.trialCasesPresent,
      cfrPresent: federal.regulationsPresent,
    },
    honestClaims: [
      "Curated public primary-law seed — not exhaustive 50-state coverage.",
      "No Shepard's/KeyCite-equivalent negative-treatment system.",
      "Currentness metadata is partial; missing dates remain UNKNOWN.",
      "No paid Westlaw/Lexis content.",
    ],
  };
}

/** Merge live DB inventory counts into bundle matrix notes (optional post-import). */
export function annotateMatrixWithInventory(
  matrix: CorpusCoverageMatrix,
  inventory: CorpusInventory,
): CorpusCoverageMatrix {
  const states = matrix.states.map((row) => {
    const live = inventory.states[row.jurisdiction];
    if (!live) return row;
    return {
      ...row,
      authorityCount: Math.max(row.authorityCount, live.authorityCount),
      coverageClass: live.coverageClass,
      notes: [
        ...row.notes,
        `Live DB real primary count: ${live.realPrimaryCount}.`,
      ],
    };
  });
  return {
    ...matrix,
    states,
    federal: {
      ...matrix.federal,
      authorityCount: Math.max(matrix.federal.authorityCount, inventory.federal.authorityCount),
      coverageClass: inventory.federal.coverageClass,
      notes: [
        ...matrix.federal.notes,
        `Live DB federal real primary count: ${inventory.federal.authorityCount}.`,
      ],
    },
  };
}

export type CorpusRoadmapWave = {
  id: string;
  name: string;
  jurisdictions: string[];
  focus: string[];
  status: "in_progress" | "planned";
};

export function buildFiftyStateRoadmap(matrix: CorpusCoverageMatrix): {
  waves: CorpusRoadmapWave[];
  perJurisdictionStatus: Array<{
    jurisdiction: string;
    coverageClass: CorpusCoverageClass;
    importerStatus: "repeatable_import" | "not_started";
    normalizationStatus: "seed_normalized" | "absent";
    hierarchyStatus: "partial" | "absent";
    currentnessStatus: "partial_unknown_ok" | "absent";
    benchmarkStatus: "seed_validation_set" | "not_started";
    sourceCandidates: string[];
  }>;
} {
  const wave1 = ["US", ...matrix.states.filter((s) => s.coverageClass !== "no_corpus").map((s) => s.jurisdiction)];
  const remaining = matrix.states
    .filter((s) => s.coverageClass === "no_corpus")
    .map((s) => s.jurisdiction);
  const wave2 = remaining.slice(0, 10);
  const wave3 = remaining.slice(10, 30);
  const wave4 = remaining.slice(30);

  const waves: CorpusRoadmapWave[] = [
    {
      id: "wave1",
      name: "Harden existing federal + 10-state seed",
      jurisdictions: wave1,
      focus: [
        "idempotent import",
        "citation normalization",
        "jurisdiction-aware retrieval",
        "honest corpus-miss copy",
        "hierarchy ranking seeds",
      ],
      status: "in_progress",
    },
    {
      id: "wave2",
      name: "Next high-priority design-partner states",
      jurisdictions: wave2,
      focus: ["official statute snapshots", "high-court opinions", "provenance URLs"],
      status: "planned",
    },
    {
      id: "wave3",
      name: "Remaining state primary-law seed",
      jurisdictions: wave3,
      focus: ["statutes + high court", "normalized authorityState/courtId"],
      status: "planned",
    },
    {
      id: "wave4",
      name: "Regulations + deeper appellate / federal circuit-district",
      jurisdictions: ["US", ...wave4],
      focus: ["eCFR / state regs", "circuit opinions", "refreshability metadata"],
      status: "planned",
    },
  ];

  const perJurisdictionStatus = [
    {
      jurisdiction: "US",
      coverageClass: matrix.federal.coverageClass,
      importerStatus: "repeatable_import" as const,
      normalizationStatus: "seed_normalized" as const,
      hierarchyStatus: "partial" as const,
      currentnessStatus: "partial_unknown_ok" as const,
      benchmarkStatus: "seed_validation_set" as const,
      sourceCandidates: [
        "uscode.house.gov",
        "archives.gov founding documents",
        "courtlistener.com (public SCOTUS)",
        "govinfo.gov (future)",
        "ecfr.gov (future)",
      ],
    },
    ...matrix.states.map((row) => ({
      jurisdiction: row.jurisdiction,
      coverageClass: row.coverageClass,
      importerStatus:
        row.coverageClass === "no_corpus"
          ? ("not_started" as const)
          : ("repeatable_import" as const),
      normalizationStatus:
        row.coverageClass === "no_corpus"
          ? ("absent" as const)
          : ("seed_normalized" as const),
      hierarchyStatus:
        row.highCourtCasesPresent || row.intermediateAppellateCasesPresent
          ? ("partial" as const)
          : ("absent" as const),
      currentnessStatus:
        row.currentnessMetadataPresent
          ? ("partial_unknown_ok" as const)
          : ("absent" as const),
      benchmarkStatus:
        row.coverageClass === "no_corpus"
          ? ("not_started" as const)
          : ("seed_validation_set" as const),
      sourceCandidates:
        row.coverageClass === "no_corpus"
          ? ["official legislature site", "official judiciary opinions", "courtlistener public"]
          : row.sourceBundleFiles,
    })),
  ];

  return { waves, perJurisdictionStatus };
}
