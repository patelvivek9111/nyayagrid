import { createHash } from "node:crypto";

export type CacheKeyInput = {
  revision: string;
  taskId: string;
  contentHash: string;
  provider: string;
  modelId: string;
  settingsHash: string;
  promptHashes: readonly string[];
  schemaVersion: number;
  kind: "response" | "judge";
};

export function buildCacheKey(input: CacheKeyInput): string {
  const payload = JSON.stringify({
    revision: input.revision,
    taskId: input.taskId,
    contentHash: input.contentHash,
    provider: input.provider,
    modelId: input.modelId,
    settingsHash: input.settingsHash,
    promptHashes: [...input.promptHashes].sort(),
    schemaVersion: input.schemaVersion,
    kind: input.kind,
  });
  return createHash("sha256").update(payload).digest("hex");
}

export function contentHashFromText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
