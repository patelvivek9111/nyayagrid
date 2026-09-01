/**
 * Explicit source classes for the U.S. primary-law corpus.
 * Synthetic benchmark authorities must use SYNTHETIC_BENCH and stay out of coverage counts.
 */
export const SOURCE_CLASSES = [
  "PRIMARY_OFFICIAL",
  "PRIMARY_PUBLIC_REPOSITORY",
  "SECONDARY_PUBLIC_REFERENCE",
  "SYNTHETIC_BENCH",
] as const;

export type SourceClass = (typeof SOURCE_CLASSES)[number];

/** Provider string for Phase 6T-CORPUS-1 bundled primary law (not synthetic fixtures). */
export const US_PRIMARY_CORPUS_PROVIDER = "us-primary-corpus";

export function isRealPrimarySourceProvider(sourceProvider: string): boolean {
  return sourceProvider === US_PRIMARY_CORPUS_PROVIDER;
}

export function isSyntheticBenchSource(
  sourceProvider: string,
  metadata?: Record<string, unknown> | null,
): boolean {
  if (sourceProvider === "synthetic-fixtures") return true;
  if (metadata?.synthetic === true) return true;
  if (metadata?.sourceClass === "SYNTHETIC_BENCH") return true;
  return false;
}
