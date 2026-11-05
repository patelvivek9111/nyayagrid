#!/usr/bin/env node
/**
 * WP-05 deploy preflight — validates environment boundaries without printing secrets.
 *
 * Usage:
 *   npm run ops:deploy-preflight
 *   APP_ENV=staging npm run ops:deploy-preflight -- --strict
 *
 * Exit 0 = no blockers; 1 = blockers; 2 = warnings under --strict.
 */
const strict = process.argv.includes("--strict");

function read(env, key) {
  return String(env[key] ?? "").trim();
}

function isTruthy(raw) {
  const v = raw.toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function hostHint(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname}:${u.port || "(default)"}`;
  } catch {
    return "unparseable";
  }
}

function evaluateEnvironmentBoundaries(env) {
  const findings = [];
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
  // Physical identity collision even when strings differ (user/password/pooler variants).
  if (productUrl && corpusUrl && productUrl !== corpusUrl) {
    try {
      const p = new URL(productUrl);
      const c = new URL(corpusUrl);
      const pDb = (p.pathname.replace(/^\//, "").split("?")[0] || "").toLowerCase();
      const cDb = (c.pathname.replace(/^\//, "").split("?")[0] || "").toLowerCase();
      if (
        p.hostname.toLowerCase() === c.hostname.toLowerCase() &&
        (p.port || "5432") === (c.port || "5432") &&
        pDb === cDb
      ) {
        findings.push({
          code: "PRODUCT_CORPUS_SAME_PHYSICAL_DATABASE",
          severity: "blocker",
          message:
            "DATABASE_URL and CORPUS_DATABASE_URL resolve to the same host/port/database (physical overlap).",
        });
      }
    } catch {
      /* URL parse errors handled elsewhere */
    }
  }
  if (
    (appEnv === "production" || appEnv === "staging") &&
    productUrl &&
    !corpusUrl &&
    !isTruthy(read(env, "PRODUCT_CORPUS_SHARED_DB_ACK"))
  ) {
    findings.push({
      code: "CORPUS_DATABASE_URL_UNDECLARED",
      severity: "warning",
      message:
        "CORPUS_DATABASE_URL unset in staging/production. Treat product/corpus as shared-risk until a separate corpus URL is declared. Set PRODUCT_CORPUS_SHARED_DB_ACK=1 only to acknowledge the open isolation blocker.",
    });
  }
  if (
    (appEnv === "production" || appEnv === "staging") &&
    !read(env, "GIT_SHA") &&
    !read(env, "GITHUB_SHA")
  ) {
    findings.push({
      code: "RELEASE_IDENTITY_MISSING",
      severity: isTruthy(read(env, "STRICT_RELEASE_IDENTITY")) ? "blocker" : "warning",
      message:
        "GIT_SHA/GITHUB_SHA unset. Bake GIT_SHA as a Docker build-arg into the image (and release-identity.json) so Fly image rollbacks retain identity. Ephemeral fly --env alone is not durable.",
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
        "FEATURE_NEON_CORPUS_RESEARCH is ON. Confirm SELECT-only corpus credentials before live research.",
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

const findings = evaluateEnvironmentBoundaries(process.env);
const blockers = findings.filter((f) => f.severity === "blocker");
const warnings = findings.filter((f) => f.severity === "warning");

const report = {
  ok: blockers.length === 0,
  appEnv: process.env.APP_ENV ?? "(unset)",
  gitSha: process.env.GIT_SHA ?? process.env.GITHUB_SHA ?? null,
  blockers: blockers.map((b) => ({ code: b.code, message: b.message })),
  warnings: warnings.map((w) => ({ code: w.code, message: w.message })),
  featureNeonCorpusResearch: process.env.FEATURE_NEON_CORPUS_RESEARCH ?? "0",
  note: "WP-03E remains deferred; FEATURE_NEON_CORPUS_RESEARCH should stay OFF until credentials approved.",
  strict,
};

console.log(JSON.stringify(report, null, 2));
if (blockers.length > 0) process.exit(1);
if (strict && warnings.length > 0) process.exit(2);
process.exit(0);
