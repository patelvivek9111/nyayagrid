/**
 * WP-05 — durable release identity.
 *
 * Prefer identity baked into the container image (ENV + release-identity.json) so
 * Fly image rollbacks retain the Git SHA. Ephemeral `fly deploy --env GIT_SHA=...`
 * alone is not durable across image switches.
 */

import { readFileSync, existsSync } from "node:fs";

export type ReleaseIdentity = {
  gitSha: string | null;
  buildId: string | null;
  appEnv: string;
  source: "env" | "file" | "none";
};

const DEFAULT_IDENTITY_PATH = "/app/release-identity.json";

export type ReleaseIdentityFile = {
  gitSha?: string;
  buildId?: string;
  builtAt?: string;
};

function nonEmpty(value: unknown): string | null {
  const s = String(value ?? "").trim();
  return s.length > 0 ? s : null;
}

export function readReleaseIdentityFile(
  path: string = process.env.RELEASE_IDENTITY_FILE?.trim() || DEFAULT_IDENTITY_PATH,
): ReleaseIdentityFile | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as ReleaseIdentityFile;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Resolve release identity without inventing a SHA.
 * Order: process env → baked release-identity.json → none.
 */
export function resolveBuildIdentity(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
  options: { identityFilePath?: string; readFile?: boolean } = {},
): ReleaseIdentity {
  const appEnv = nonEmpty(env.APP_ENV) ?? nonEmpty(env.NODE_ENV) ?? "development";

  const envSha =
    nonEmpty(env.GIT_SHA) ??
    nonEmpty(env.GITHUB_SHA) ??
    nonEmpty(env.VERCEL_GIT_COMMIT_SHA) ??
    nonEmpty(env.FLY_IMAGE_REF); // not a git sha; ignored below if not hex-like
  const envBuild = nonEmpty(env.BUILD_ID) ?? nonEmpty(env.GITHUB_RUN_ID);

  const gitShaFromEnv = envSha && /^[0-9a-f]{7,40}$/i.test(envSha) ? envSha : null;
  if (gitShaFromEnv || envBuild) {
    return {
      gitSha: gitShaFromEnv,
      buildId: envBuild,
      appEnv,
      source: "env",
    };
  }

  if (options.readFile === false) {
    return { gitSha: null, buildId: null, appEnv, source: "none" };
  }

  const file = readReleaseIdentityFile(options.identityFilePath);
  const fileSha = nonEmpty(file?.gitSha);
  const fileBuild = nonEmpty(file?.buildId);
  if (fileSha || fileBuild) {
    return {
      gitSha: fileSha && /^[0-9a-f]{7,40}$/i.test(fileSha) ? fileSha : null,
      buildId: fileBuild,
      appEnv,
      source: "file",
    };
  }

  return { gitSha: null, buildId: null, appEnv, source: "none" };
}

/** True when a deployed staging/production process should have a baked SHA. */
export function releaseIdentityMissingInDeployedEnv(identity: ReleaseIdentity): boolean {
  const deployed = identity.appEnv === "staging" || identity.appEnv === "production";
  return deployed && !identity.gitSha;
}
