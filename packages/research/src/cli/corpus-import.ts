#!/usr/bin/env node
/**
 * Phase 6T-CORPUS-1 batch import CLI.
 *
 * Usage:
 *   npm run research:corpus-import -w @nyayagrid/research
 *   npm run research:corpus-import -w @nyayagrid/research -- --batch initial
 *   npm run research:corpus-import -w @nyayagrid/research -- path/to/bundle.json
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createDb } from "@nyayagrid/database";
import { createEmbeddingProviderFromEnv } from "@nyayagrid/ai";
import {
  batchImportCorpusAuthorities,
  loadInitialBatchAuthorities,
  redactDatabaseUrl,
  intendedCertificationTarget,
  CERTIFICATION_DATABASE_FALLBACK,
  type CorpusBundleAuthority,
} from "../corpus";
import { importAuthorityInputSchema } from "../ingest";
import { loadRootEnv } from "./load-root-env";

async function loadFromFile(path: string): Promise<CorpusBundleAuthority[]> {
  const raw = await readFile(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Import file must be a JSON array");
  return parsed.map((entry) => importAuthorityInputSchema.parse(entry)) as CorpusBundleAuthority[];
}

async function main() {
  const researchEnv = resolve(dirname(fileURLToPath(import.meta.url)), "../../.env");
  loadRootEnv(researchEnv);

  const argv = process.argv.slice(2);
  let authorities: CorpusBundleAuthority[];
  let label = "custom";

  if (argv.includes("--batch") && argv.includes("initial")) {
    const loaded = await loadInitialBatchAuthorities();
    authorities = loaded.authorities;
    label = `initial-batch:${loaded.manifest.states.map((s) => s.code).join(",")}`;
  } else {
    const filePath = argv.find((arg) => !arg.startsWith("--"));
    if (!filePath) {
      const loaded = await loadInitialBatchAuthorities();
      authorities = loaded.authorities;
      label = `initial-batch:${loaded.manifest.states.map((s) => s.code).join(",")}`;
    } else {
      authorities = await loadFromFile(filePath);
      label = filePath;
    }
  }

  const databaseUrl = process.env.DATABASE_URL ?? CERTIFICATION_DATABASE_FALLBACK;
  const intended = intendedCertificationTarget();
  console.error(
    JSON.stringify({
      command: "research:corpus-import",
      APP_ENV: process.env.APP_ENV ?? null,
      cwd: process.cwd(),
      database: redactDatabaseUrl(databaseUrl),
      intendedCertification: intended,
    }),
  );
  const db = createDb(databaseUrl);
  const embeddings = createEmbeddingProviderFromEnv();
  const importedAt = new Date().toISOString();

  const summary = await batchImportCorpusAuthorities({
    db,
    embeddings,
    authorities,
    importedAt,
  });

  console.log(
    JSON.stringify(
      {
        label,
        importedAt,
        ...summary,
      },
      null,
      2,
    ),
  );
  process.exitCode = summary.errors > 0 ? 1 : 0;
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
