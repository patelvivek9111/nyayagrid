import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";

/**
 * Reject archive member paths that escape the destination root.
 * Does not execute archive contents.
 */
export function assertSafeArchiveEntry(destinationRoot: string, entryPath: string): string {
  const normalizedEntry = entryPath.replace(/\\/g, "/");
  if (
    normalizedEntry.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalizedEntry) ||
    normalizedEntry.split("/").includes("..")
  ) {
    throw new Error(`Unsafe archive path rejected: ${entryPath}`);
  }
  const resolvedRoot = path.resolve(destinationRoot);
  const resolvedTarget = path.resolve(destinationRoot, normalizedEntry);
  const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
    throw new Error(`Path traversal rejected: ${entryPath}`);
  }
  return resolvedTarget;
}

export async function writeStreamToSafePath(
  destinationRoot: string,
  relativePath: string,
  source: Readable,
  options?: { gunzip?: boolean },
): Promise<string> {
  const target = assertSafeArchiveEntry(destinationRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  const out = createWriteStream(target);
  if (options?.gunzip) {
    await pipeline(source, createGunzip(), out);
  } else {
    await pipeline(source, out);
  }
  return target;
}
