import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { sha256File } from "../integrity/hash.js";
import type { IntegrityManifestEntry } from "../integrity/manifest.js";

export async function downloadToFile(
  url: string,
  destPath: string,
  options?: { force?: boolean },
): Promise<{ path: string; bytes: number; skipped: boolean }> {
  await mkdir(path.dirname(destPath), { recursive: true });
  if (!options?.force && existsSync(destPath) && statSync(destPath).size > 0) {
    return {
      path: destPath,
      bytes: statSync(destPath).size,
      skipped: true,
    };
  }
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "nyayagrid-external-bench/0.1" },
  });
  if (!res.ok || !res.body) {
    throw new Error(`Download failed ${res.status} ${url}`);
  }
  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(destPath));
  return { path: destPath, bytes: statSync(destPath).size, skipped: false };
}

export async function recordAsset(input: {
  relativePath: string;
  absolutePath: string;
  source: string;
  revision: string;
}): Promise<IntegrityManifestEntry> {
  const size = statSync(input.absolutePath).size;
  const sha256 = await sha256File(input.absolutePath);
  return {
    relativePath: input.relativePath.replace(/\\/g, "/"),
    size,
    sha256,
    source: input.source,
    revision: input.revision,
  };
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
