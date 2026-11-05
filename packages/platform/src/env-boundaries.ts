/**
 * WP-05 — environment boundary checks.
 *
 * Separates product DATABASE_URL from CORPUS_DATABASE_URL and refuses unsafe
 * production stand-ins. Never logs secret values — only presence / equality flags.
 */

export type EnvBoundaryFinding = {
  code: string;
  severity: "blocker" | "warning";
  message: string;
};

function read(env: NodeJS.ProcessEnv | Record<string, string | undefined>, key: string): string {
  return String(env[key] ?? "").trim();
}

function isTruthy(raw: string): boolean {
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function hostHint(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port || "(default)"}`;
  } catch {
    return "unparseable";
  }
}

/**
 * Detects product/corpus DB confusion and Neon research flag misuse.
 * Safe for health endpoints and deploy preflight (no secret material).
 */
export function evaluateEnvironmentBoundaries(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): EnvBoundaryFinding[] {
  const findings: EnvBoundaryFinding[] = [];
  const appEnv = read(env, "APP_ENV").toLowerCase() || "development";
  const productUrl = read(env, "DATABASE_URL");
  const corpusUrl = read(env, "CORPUS_DATABASE_URL");
  const neonFlag = isTruthy(read(env, "FEATURE_NEON_CORPUS_RESEARCH"));

  if (!productUrl) {
    findings.push({
      code: "PRODUCT_DB_MISSING",
      severity: "blocker",
      message: "DATABASE_URL is required for the product database.",
    });
  }

  if (neonFlag && !corpusUrl) {
    findings.push({
      code: "NEON_CORPUS_FLAG_WITHOUT_URL",
      severity: "blocker",
      message:
        "FEATURE_NEON_CORPUS_RESEARCH=1 requires CORPUS_DATABASE_URL (WP-03E credential still deferred).",
    });
  }

  if (productUrl && corpusUrl && productUrl === corpusUrl) {
    findings.push({
      code: "PRODUCT_CORPUS_URL_COLLISION",
      severity: "blocker",
      message:
        "DATABASE_URL and CORPUS_DATABASE_URL are identical. Product and corpus must remain separate.",
    });
  }

  if (
    (appEnv === "production" || appEnv === "staging") &&
    productUrl &&
    /localhost|127\.0\.0\.1/i.test(productUrl)
  ) {
    findings.push({
      code: "PRODUCT_DB_LOCALHOST_IN_DEPLOYED_ENV",
      severity: "blocker",
      message: `${appEnv} DATABASE_URL appears to target localhost (${hostHint(productUrl)}).`,
    });
  }

  if ((appEnv === "production" || appEnv === "staging") && neonFlag) {
    findings.push({
      code: "NEON_CORPUS_RESEARCH_ENABLED",
      severity: "warning",
      message:
        "FEATURE_NEON_CORPUS_RESEARCH is ON. Confirm SELECT-only corpus credentials and WP-03E approval before relying on live research.",
    });
  }

  if (appEnv === "production" && isTruthy(read(env, "CLAMAV_FIXTURE"))) {
    findings.push({
      code: "CLAMAV_FIXTURE_IN_PRODUCTION",
      severity: "blocker",
      message: "CLAMAV_FIXTURE cannot be used in production.",
    });
  }

  if (
    (appEnv === "production" || appEnv === "staging") &&
    read(env, "MALWARE_SCANNER").toLowerCase() === "development"
  ) {
    findings.push({
      code: "MALWARE_DEVELOPMENT_SCANNER",
      severity: "blocker",
      message: "MALWARE_SCANNER=development is forbidden in staging/production.",
    });
  }

  if (
    (appEnv === "production" || appEnv === "staging") &&
    read(env, "AUTH_PROVIDER").toLowerCase() === "dev" &&
    !isTruthy(read(env, "ALLOW_STAGING_DEV_AUTH"))
  ) {
    findings.push({
      code: "DEV_AUTH_IN_DEPLOYED_ENV",
      severity: "blocker",
      message:
        "AUTH_PROVIDER=dev is forbidden in staging/production without ALLOW_STAGING_DEV_AUTH.",
    });
  }

  if (appEnv === "production" && !isTruthy(read(env, "PRODUCTION_DEPLOY_APPROVED"))) {
    findings.push({
      code: "PRODUCTION_DEPLOY_NOT_APPROVED",
      severity: "blocker",
      message:
        "APP_ENV=production requires PRODUCTION_DEPLOY_APPROVED=1 from a separate human approval. WP-05 workflows never set this automatically.",
    });
  }

  if (
    appEnv === "production" &&
    /nyayagrid-staging/i.test(read(env, "FLY_APP") || read(env, "FLY_APP_NAME"))
  ) {
    findings.push({
      code: "STAGING_FLY_APP_IN_PRODUCTION_ENV",
      severity: "blocker",
      message: "APP_ENV=production must not target Fly app nyayagrid-staging.",
    });
  }

  if (
    (appEnv === "production" || appEnv === "staging") &&
    read(env, "OCR_PROVIDER").toLowerCase() === "fixture"
  ) {
    findings.push({
      code: "OCR_FIXTURE_IN_DEPLOYED_ENV",
      severity: "blocker",
      message: "OCR_PROVIDER=fixture is forbidden in staging/production.",
    });
  }

  return findings;
}

export function environmentBoundaryBlockers(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): EnvBoundaryFinding[] {
  return evaluateEnvironmentBoundaries(env).filter((f) => f.severity === "blocker");
}
