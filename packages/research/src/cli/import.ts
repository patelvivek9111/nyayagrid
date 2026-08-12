#!/usr/bin/env node
/**
 * Legal authority import CLI.
 *
 * Usage:
 *   npm run research:import -w @nyayagrid/research -- path/to/authorities.json
 *   npm run research:import -w @nyayagrid/research -- --fixtures
 *
 * The JSON file must contain an array of authority objects matching
 * `importAuthorityInputSchema` from ./ingest.ts — explicit metadata is always required; nothing
 * is inferred from a filename. Requires DATABASE_URL. Uses MockEmbeddingProvider unless
 * EMBEDDING_PROVIDER (or AI_PROVIDER) is set to "openai" — no paid API is required by default.
 */
import { readFile } from "node:fs/promises";
import { createDb } from "@nyayagrid/database";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import { importAuthority, type ImportAuthorityInput } from "../ingest";
import { syntheticAuthorityFixtures } from "../fixtures";

type CliResult = {
  sourceExternalId: string;
  title: string;
  status: "imported" | "new_version" | "skipped" | "error";
  error?: string;
};

async function loadInputs(argv: string[]): Promise<ImportAuthorityInput[]> {
  if (argv.includes("--fixtures")) {
    return syntheticAuthorityFixtures;
  }
  const filePath = argv.find((arg) => !arg.startsWith("--"));
  if (!filePath) {
    throw new Error(
      "Usage: research:import <path-to-authorities.json> | research:import --fixtures",
    );
  }
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Import file must contain a JSON array of authority objects");
  }
  return parsed as ImportAuthorityInput[];
}

async function main() {
  const argv = process.argv.slice(2);
  const inputs = await loadInputs(argv);
  if (inputs.length === 0) {
    console.log(JSON.stringify({ message: "No authorities to import", results: [] }));
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to import legal authorities");
  }
  const db = createDb(databaseUrl);
  const embeddings = createEmbeddingProviderFromEnv();

  const results: CliResult[] = [];
  for (const input of inputs) {
    try {
      const result = await importAuthority({
        db,
        embeddings,
        input,
        actor: { userId: null, organizationId: null },
      });
      results.push({
        sourceExternalId: input.sourceExternalId,
        title: input.title,
        status: result.skipped
          ? "skipped"
          : result.version.versionNumber > 1
            ? "new_version"
            : "imported",
      });
    } catch (error) {
      results.push({
        sourceExternalId: input.sourceExternalId,
        title: input.title,
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const summary = {
    total: results.length,
    imported: results.filter((r) => r.status === "imported").length,
    newVersions: results.filter((r) => r.status === "new_version").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    errors: results.filter((r) => r.status === "error").length,
    results,
  };
  console.log(JSON.stringify(summary, null, 2));
  process.exitCode = summary.errors > 0 ? 1 : 0;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
