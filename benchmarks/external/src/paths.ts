import path from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

/** Package root (`benchmarks/external`). */
export function getPackageRoot(): string {
  return path.resolve(moduleDir, "..");
}

export function getCacheDir(): string {
  return path.join(getPackageRoot(), "cache");
}

export function getFixturesDir(): string {
  return path.join(getPackageRoot(), "fixtures");
}

export function getRegistryDir(): string {
  return path.join(getPackageRoot(), "registry");
}

export function resolveFromPackageRoot(...segments: string[]): string {
  return path.join(getPackageRoot(), ...segments);
}
