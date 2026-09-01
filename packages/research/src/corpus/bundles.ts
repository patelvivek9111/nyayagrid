import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { importAuthorityInputSchema, type ImportAuthorityInput } from "../ingest";
import { SOURCE_CLASSES } from "./source-classes";
import { QUALITY_TIERS } from "./quality-tier";
import type { CorpusBundleAuthority } from "./batch-import";

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), "../../corpus/bundles");

const bundleExtraSchema = z.object({
  bundleSourceClass: z.enum(SOURCE_CLASSES).optional(),
  bundleQualityTier: z.enum(QUALITY_TIERS).optional(),
  bundlePracticeAreas: z.array(z.string()).optional(),
});

const manifestSchema = z.object({
  phase: z.string(),
  parserVersion: z.string(),
  states: z.array(
    z.object({
      code: z.string().length(2),
      bundleFile: z.string(),
      practiceAreas: z.array(z.string()).optional(),
    }),
  ),
});

export type CorpusManifest = z.infer<typeof manifestSchema>;

export async function loadCorpusManifest(): Promise<CorpusManifest> {
  const raw = await readFile(join(corpusDir, "manifest.json"), "utf-8");
  return manifestSchema.parse(JSON.parse(raw));
}

export async function loadCorpusBundle(relativePath: string): Promise<CorpusBundleAuthority[]> {
  const raw = await readFile(join(corpusDir, relativePath), "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Bundle ${relativePath} must be a JSON array`);
  }
  return parsed.map((entry) => {
    importAuthorityInputSchema.parse(entry);
    bundleExtraSchema.parse(entry);
    return entry as CorpusBundleAuthority;
  });
}

export async function loadInitialBatchAuthorities(): Promise<{
  manifest: CorpusManifest;
  authorities: CorpusBundleAuthority[];
}> {
  const manifest = await loadCorpusManifest();
  const authorities: CorpusBundleAuthority[] = [];
  for (const state of manifest.states) {
    const bundle = await loadCorpusBundle(state.bundleFile);
    authorities.push(
      ...bundle.map((entry) => ({
        ...entry,
        bundlePracticeAreas: entry.bundlePracticeAreas ?? state.practiceAreas,
      })),
    );
  }
  return { manifest, authorities };
}

export function corpusBundlesRoot(): string {
  return corpusDir;
}

/** UCC Article 2 § 2-725 uniform body text (Delaware official codification snapshot). */
export const UCC_2725_BODY = [
  "§ 2-725. Statute of limitations in contracts for sale.",
  "",
  "(1) An action for breach of any contract for sale must be commenced within 4 years after the cause of action has accrued. By the original agreement the parties may reduce the period of limitations to not less than one year but may not extend it.",
  "",
  "(2) A cause of action accrues when the breach occurs, regardless of the aggrieved party's lack of knowledge of the breach. A breach of warranty occurs when tender of delivery is made, except that where a warranty explicitly extends to future performance of the goods and discovery of the breach must await the time of such performance the cause of action accrues when the breach is or should have been discovered.",
  "",
  "(3) Where an action commenced within the time limited by subsection (1) is so terminated as to leave available a remedy by another action for the same breach such other action may be commenced after the expiration of the time limited and within 6 months after the termination of the first action unless the termination resulted from voluntary discontinuance or from dismissal for failure or neglect to prosecute.",
  "",
  "(4) This section does not alter the law on tolling of the statute of limitations nor does it apply to causes of action which have accrued before this subtitle becomes effective.",
].join("\n");

export type UccStatuteConfig = {
  state: string;
  stateName: string;
  citation: string;
  title: string;
  shortTitle: string;
  sourceExternalId: string;
  canonicalSourceUrl: string;
  hierarchyPath: ImportAuthorityInput["hierarchyPath"];
};

export function buildUcc2725Authority(config: UccStatuteConfig): CorpusBundleAuthority {
  return {
    title: config.title,
    shortTitle: config.shortTitle,
    authorityType: "statute",
    jurisdiction: config.stateName,
    authorityState: config.state,
    citation: config.citation,
    sourceProvider: "us-primary-corpus",
    sourceExternalId: config.sourceExternalId,
    canonicalSourceUrl: config.canonicalSourceUrl,
    hierarchyPath: config.hierarchyPath,
    bundleSourceClass: "PRIMARY_OFFICIAL",
    bundlePracticeAreas: ["contract", "commercial", "civil"],
    content: [config.citation, "", UCC_2725_BODY].join("\n"),
    sections: [
      {
        sectionRef: "2-725",
        subsectionRef: "1",
        content:
          "An action for breach of any contract for sale must be commenced within 4 years after the cause of action has accrued. By the original agreement the parties may reduce the period of limitations to not less than one year but may not extend it.",
      },
      {
        sectionRef: "2-725",
        subsectionRef: "2",
        content:
          "A cause of action accrues when the breach occurs, regardless of the aggrieved party's lack of knowledge of the breach. A breach of warranty occurs when tender of delivery is made, except that where a warranty explicitly extends to future performance of the goods and discovery of the breach must await the time of such performance the cause of action accrues when the breach is or should have been discovered.",
      },
    ],
    sourceMetadata: {
      retrievalMethod: "official_codification_snapshot",
      statuteTopic: "ucc_article_2_limitations",
    },
  };
}
