import { z } from "zod";
import type { ImportAuthorityInput } from "../ingest";
import { SOURCE_CLASSES, type SourceClass } from "./source-classes";
import { QUALITY_TIERS, defaultQualityTierForSourceClass, type QualityTier } from "./quality-tier";

export const CORPUS_PARSER_VERSION = "corpus1-v1";

export const corpusAuthorityMetadataSchema = z.object({
  sourceClass: z.enum(SOURCE_CLASSES),
  qualityTier: z.enum(QUALITY_TIERS).optional(),
  practiceAreas: z.array(z.string()).optional(),
  corpusPhase: z.string().optional(),
  synthetic: z.literal(false).optional(),
});

export type CorpusAuthorityMetadata = z.infer<typeof corpusAuthorityMetadataSchema>;

export type EnrichedCorpusInput = ImportAuthorityInput & {
  metadata: CorpusAuthorityMetadata & Record<string, unknown>;
  sourceMetadata: Record<string, unknown>;
};

/** Attach provenance fields without inferring dates, courts, or citations. */
export function enrichCorpusAuthority(
  input: ImportAuthorityInput,
  options: {
    sourceClass: SourceClass;
    qualityTier?: QualityTier;
    practiceAreas?: string[];
    importedAt?: string;
  },
): EnrichedCorpusInput {
  const qualityTier = options.qualityTier ?? defaultQualityTierForSourceClass(options.sourceClass);
  const importedAt = options.importedAt ?? new Date().toISOString();
  return {
    ...input,
    metadata: {
      ...(input.metadata ?? {}),
      sourceClass: options.sourceClass,
      qualityTier,
      practiceAreas: options.practiceAreas ?? [],
      corpusPhase: "6T-CORPUS-1",
      synthetic: false,
    },
    sourceMetadata: {
      ...(input.sourceMetadata ?? {}),
      importedAt,
      parserVersion: CORPUS_PARSER_VERSION,
      retrievalMethod: input.sourceMetadata?.retrievalMethod ?? "bundled_snapshot",
      originalJurisdictionString: input.jurisdiction ?? null,
      originalCourtString: input.court ?? null,
    },
  };
}
