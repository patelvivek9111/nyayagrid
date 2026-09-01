import type { Database } from "@nyayagrid/database";
import type { EmbeddingProvider } from "@nyayagrid/ai";
import { importAuthority, type ImportAuthorityInput } from "../ingest";
import type { ImportFailure } from "./failure-taxonomy";
import { enrichCorpusAuthority } from "./provenance";
import type { SourceClass } from "./source-classes";
import type { QualityTier } from "./quality-tier";

export type CorpusBundleAuthority = ImportAuthorityInput & {
  bundleSourceClass?: SourceClass;
  bundleQualityTier?: QualityTier;
  bundlePracticeAreas?: string[];
};

export type BatchImportResult = {
  sourceExternalId: string;
  title: string;
  status: "imported" | "new_version" | "skipped" | "error";
  authorityId?: string;
  versionNumber?: number;
  chunkCount?: number;
  error?: string;
  failure?: ImportFailure;
};

export type BatchImportSummary = {
  total: number;
  imported: number;
  newVersions: number;
  skipped: number;
  errors: number;
  results: BatchImportResult[];
  failures: ImportFailure[];
};

function classifyImportError(error: unknown, input: CorpusBundleAuthority): ImportFailure {
  const message = error instanceof Error ? error.message : String(error);
  let code: ImportFailure["code"] = "B_parser_failure";
  if (message.includes("citation") || message.includes("docket")) code = "E_citation_missing";
  if (message.includes("court") && message.includes("ambiguous")) code = "D_ambiguous_court";
  if (message.includes("jurisdiction")) code = "C_ambiguous_jurisdiction";
  if (message.includes("embedding") || message.includes("chunk")) code = "L_indexing_failure";
  return {
    code,
    message,
    sourceExternalId: input.sourceExternalId,
    state: input.authorityState ?? undefined,
  };
}

export async function batchImportCorpusAuthorities(params: {
  db: Database;
  embeddings: EmbeddingProvider;
  authorities: CorpusBundleAuthority[];
  importedAt?: string;
}): Promise<BatchImportSummary> {
  const results: BatchImportResult[] = [];
  const failures: ImportFailure[] = [];

  for (const raw of params.authorities) {
    try {
      const enriched = enrichCorpusAuthority(raw, {
        sourceClass: raw.bundleSourceClass ?? "PRIMARY_OFFICIAL",
        qualityTier: raw.bundleQualityTier,
        practiceAreas: raw.bundlePracticeAreas,
        importedAt: params.importedAt,
      });
      const result = await importAuthority({
        db: params.db,
        embeddings: params.embeddings,
        input: enriched,
        actor: { userId: null, organizationId: null },
      });
      results.push({
        sourceExternalId: raw.sourceExternalId,
        title: raw.title,
        status: result.skipped
          ? "skipped"
          : result.version.versionNumber > 1
            ? "new_version"
            : "imported",
        authorityId: result.authority.id,
        versionNumber: result.version.versionNumber,
        chunkCount: result.chunkCount,
      });
    } catch (error) {
      const failure = classifyImportError(error, raw);
      failures.push(failure);
      results.push({
        sourceExternalId: raw.sourceExternalId,
        title: raw.title,
        status: "error",
        error: failure.message,
        failure,
      });
    }
  }

  return {
    total: results.length,
    imported: results.filter((r) => r.status === "imported").length,
    newVersions: results.filter((r) => r.status === "new_version").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
    failures,
  };
}
