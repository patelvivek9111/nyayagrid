import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import path from "node:path";

// Next.js only auto-loads `.env*` from `apps/web/`. This monorepo keeps a single
// `.env` at the repo root (see README / `.env.example`), so load that first.
// `apps/web/.env*` still wins for any overlapping keys if present.
// `process.cwd()` is `apps/web` when running `next dev` / `next build` via the workspace.
const appDir = process.cwd();
loadEnvConfig(path.resolve(appDir, "../.."));
loadEnvConfig(appDir);

/**
 * Security headers, applied to every route.
 *
 * - Content-Security-Policy: `script-src`/`style-src` include `'unsafe-inline'` because Next.js
 *   App Router injects inline hydration bootstrap scripts and Tailwind-generated inline styles
 *   without a nonce in this setup; tighten to a per-request nonce (via middleware) before this
 *   app handles untrusted user-rendered HTML. `frame-ancestors 'none'` plus `X-Frame-Options: DENY`
 *   together block this app from being framed by any origin, including this app's own origin.
 *   `script-src` additionally allows `'unsafe-eval'` in non-production only: `next dev`'s webpack
 *   dev-mode module runtime and React Fast Refresh load every module through `eval()`, so without
 *   this the browser throws `EvalError: ... violates ... script-src` for every module — the app
 *   never finishes hydrating (confirmed via a Playwright trace: `pageError` events showing this
 *   exact EvalError from `react-refresh-utils/runtime.js`), so no client-side event handler ever
 *   attaches and every click/submit silently falls through to the browser's native, broken
 *   default action instead of React's. Production serves a prebuilt, non-`eval` bundle and does
 *   not need `unsafe-eval`, so it stays out of the production CSP.
 * - Strict-Transport-Security is only sent in production: sending it in local dev (plain HTTP)
 *   would make browsers force HTTPS for localhost, breaking `next dev`.
 * - X-Content-Type-Options/Referrer-Policy/Permissions-Policy are conservative, low-risk defaults.
 */
function buildSecurityHeaders() {
  const isProd = process.env.NODE_ENV === "production";
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
    // Google Fonts: CSS from fonts.googleapis.com, font files from fonts.gstatic.com
    // (used by apps/web/src/app/layout.tsx for Fraunces + Source Sans 3).
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
    },
    { key: "X-Frame-Options", value: "DENY" },
    ...(isProd
      ? [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ]
      : []),
  ];
}

const nextConfig: NextConfig = {
  // Traces only the node_modules this app actually needs into `.next/standalone`, which is what
  // the production Dockerfile copies into its runtime image — without this, the image would need
  // the full monorepo `node_modules` (including devDependencies of every workspace).
  output: "standalone",
  // `src/instrumentation.ts`'s `register()` (the production configuration gate) is picked up
  // automatically — `instrumentation.js/ts` has been stable since Next.js 15 and no longer needs
  // `experimental.instrumentationHook`. See https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation.
  transpilePackages: [
    "@nyayagrid/ai",
    "@nyayagrid/auth",
    "@nyayagrid/database",
    "@nyayagrid/documents",
    "@nyayagrid/jobs",
    "@nyayagrid/observability",
    "@nyayagrid/permissions",
    "@nyayagrid/platform",
    "@nyayagrid/search",
    "@nyayagrid/ui",
    "@nyayagrid/validation",
    "@nyayagrid/workspaces",
  ],
  // `@nyayagrid/documents` (in transpilePackages above, since it ships untranspiled TS) imports
  // `pdf-parse`/`mammoth`, which are plain Node.js CJS libraries. Left to webpack's default
  // behavior, transpiling the *importing* workspace package also pulls these into the RSC bundle,
  // which crashes at module-evaluation time in `next dev` (`TypeError: Object.defineProperty
  // called on non-object` inside the bundled `extract.ts`). Declaring them here keeps them as real
  // `require()` calls resolved by Node at runtime instead of being bundled.
  serverExternalPackages: [
    "pdf-parse",
    "pdfjs-dist",
    "mammoth",
    "inngest",
    "@clerk/backend",
    "@aws-sdk/client-s3",
    "@aws-sdk/s3-request-presigner",
  ],
  experimental: {
    externalDir: true,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: buildSecurityHeaders(),
      },
    ];
  },
  async redirects() {
    return [
      { source: "/app/matters", destination: "/app/cases", permanent: false },
      {
        source: "/app/matters/:matterId/:path*",
        destination: "/app/cases/:matterId/:path*",
        permanent: false,
      },
      { source: "/app/matters/:matterId", destination: "/app/cases/:matterId", permanent: false },
    ];
  },
};

export default nextConfig;
