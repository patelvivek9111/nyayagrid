import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const IntegrityManifestEntrySchema = z.object({
  relativePath: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
  source: z.string().optional(),
  revision: z.string().optional(),
});

export const IntegrityManifestSchema = z.object({
  version: z.number().int().optional(),
  generatedAt: z.string().optional(),
  entries: z.array(IntegrityManifestEntrySchema),
});

export type IntegrityManifestEntry = z.infer<typeof IntegrityManifestEntrySchema>;
export type IntegrityManifest = z.infer<typeof IntegrityManifestSchema>;

export type ManifestVerificationResult = {
  ok: boolean;
  missing: string[];
  sizeMismatch: string[];
  hashMismatch: string[];
};

export function loadIntegrityManifest(manifestPath: string): IntegrityManifest {
  const raw = readFileSync(manifestPath, "utf8");
  return IntegrityManifestSchema.parse(JSON.parse(raw));
}

export function sha256File(filePath: string): string {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function verifyIntegrityManifest(
  manifest: IntegrityManifest,
  rootDir: string,
): ManifestVerificationResult {
  const missing: string[] = [];
  const sizeMismatch: string[] = [];
  const hashMismatch: string[] = [];

  for (const entry of manifest.entries) {
    const fullPath = path.join(rootDir, entry.relativePath);
    if (!existsSync(fullPath)) {
      missing.push(entry.relativePath);
      continue;
    }
    const buf = readFileSync(fullPath);
    if (buf.byteLength !== entry.size) {
      sizeMismatch.push(entry.relativePath);
    }
    const hash = createHash("sha256").update(buf).digest("hex");
    if (hash !== entry.sha256) {
      hashMismatch.push(entry.relativePath);
    }
  }

  return {
    ok: missing.length === 0 && sizeMismatch.length === 0 && hashMismatch.length === 0,
    missing,
    sizeMismatch,
    hashMismatch,
  };
}
