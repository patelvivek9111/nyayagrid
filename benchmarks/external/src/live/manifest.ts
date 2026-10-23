import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ensureRunDir, runArtifactsDir } from "./persistence.js";

export type RunManifest = {
  runId: string;
  configHash: string;
  frozenAt: string;
  immutable: boolean;
  suite: unknown;
  models: unknown;
  budgetMaxUsd: number;
};

const MANIFEST_NAME = "manifest.json";

export function hashRunConfig(config: unknown): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

export function manifestPath(runId: string): string {
  return path.join(runArtifactsDir(runId), MANIFEST_NAME);
}

export function freezeRunManifest(
  runId: string,
  manifest: Omit<RunManifest, "immutable" | "frozenAt">,
): RunManifest {
  ensureRunDir(runId);
  const filePath = manifestPath(runId);
  if (existsSync(filePath)) {
    throw new Error(`Run manifest already frozen for ${runId}; mutation refused.`);
  }
  const frozen: RunManifest = {
    ...manifest,
    frozenAt: new Date().toISOString(),
    immutable: true,
  };
  writeFileSync(filePath, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  return frozen;
}

export function loadRunManifest(runId: string): RunManifest {
  const filePath = manifestPath(runId);
  if (!existsSync(filePath)) {
    throw new Error(`Missing run manifest for ${runId}`);
  }
  return JSON.parse(readFileSync(filePath, "utf8")) as RunManifest;
}

export function assertManifestImmutable(runId: string, attemptedConfigHash: string): void {
  const manifest = loadRunManifest(runId);
  if (!manifest.immutable) {
    throw new Error(`Run manifest for ${runId} is not marked immutable.`);
  }
  if (manifest.configHash !== attemptedConfigHash) {
    throw new Error(
      `Config hash mismatch for ${runId}; refuse mutation or resume with changed config.`,
    );
  }
}
