import type { SourceClass } from "./source-classes";

export const QUALITY_TIERS = [
  "TIER_1_OFFICIAL",
  "TIER_2_TRUSTED_PUBLIC",
  "TIER_3_REFERENCE_ONLY",
] as const;

export type QualityTier = (typeof QUALITY_TIERS)[number];

/** Deterministic tier from source class; callers may override when source metadata is explicit. */
export function defaultQualityTierForSourceClass(sourceClass: SourceClass): QualityTier {
  switch (sourceClass) {
    case "PRIMARY_OFFICIAL":
      return "TIER_1_OFFICIAL";
    case "PRIMARY_PUBLIC_REPOSITORY":
      return "TIER_2_TRUSTED_PUBLIC";
    case "SECONDARY_PUBLIC_REFERENCE":
      return "TIER_3_REFERENCE_ONLY";
    case "SYNTHETIC_BENCH":
      return "TIER_3_REFERENCE_ONLY";
    default:
      return "TIER_3_REFERENCE_ONLY";
  }
}
