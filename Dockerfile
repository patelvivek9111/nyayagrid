# syntax=docker/dockerfile:1

# NyayaGrid web app (apps/web) — multi-stage build producing a minimal, non-root runtime image.
#
# This does NOT run database migrations, seed data, or connect to Postgres/S3 at build time — the
# app's static pages fetch their data client-side, and `next build` has been verified to succeed
# with no DATABASE_URL set at all. Migrations are a separate, explicit operational step (see
# docs/DEPLOYMENT.md) — never run implicitly by starting this container, so a deploy can never
# accidentally apply a schema change to the wrong database.
#
# Build:  docker build -t nyayagrid-web .
# Run:    docker run -p 3000:3000 --env-file .env.production nyayagrid-web
#
# `npm run dev` never needs Docker at all — this image is for staging/production deployment only.

FROM node:20-alpine AS base
WORKDIR /app
# glibc compatibility shim required by some native deps (e.g. sharp's prebuilt binaries) on alpine.
RUN apk add --no-cache libc6-compat

# ---- deps: install once, cached as long as lockfiles/package.json don't change ----
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/agents/package.json packages/agents/package.json
COPY packages/ai/package.json packages/ai/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/documents/package.json packages/documents/package.json
COPY packages/intelligence/package.json packages/intelligence/package.json
COPY packages/jobs/package.json packages/jobs/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY packages/permissions/package.json packages/permissions/package.json
COPY packages/platform/package.json packages/platform/package.json
COPY packages/research/package.json packages/research/package.json
COPY packages/search/package.json packages/search/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/validation/package.json packages/validation/package.json
COPY packages/workspaces/package.json packages/workspaces/package.json
RUN npm ci

# ---- builder: full source + `next build` (output: "standalone", see apps/web/next.config.ts) ----
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
# npm workspaces sometimes nests a package (e.g. inngest) under an individual workspace's own
# node_modules instead of hoisting it to the root, when different workspaces need different
# versions — so the whole /app tree from `deps` (root node_modules + any per-workspace
# node_modules) must be copied, not just the root node_modules directory.
COPY --from=deps /app ./
COPY . .
# Ensure the standalone-copy step below always has a source directory, even though this repo does
# not currently ship a public/ folder.
RUN mkdir -p apps/web/public
RUN npm run build -w @nyayagrid/web

# ---- runner: minimal runtime image, non-root user ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 --ingroup nodejs nyayagrid

# `next build`'s standalone output traces only the node_modules this app actually needs, so the
# runtime image never contains devDependencies, other workspaces' test files, or the full monorepo
# node_modules tree.
COPY --from=builder --chown=nyayagrid:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nyayagrid:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nyayagrid:nodejs /app/apps/web/public ./apps/web/public

USER nyayagrid
EXPOSE 3000

# Matches /api/health/live and /api/health/ready (see apps/web/src/app/api/health/*).
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
