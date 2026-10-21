# NyayaGrid Build Guide

Developer setup and build reference for the NyayaGrid monorepo.

NyayaGrid is one platform. Nyaya, Nyaya Graph, Nyaya Memory, Nyaya Timeline, Nyaya Research, Nyaya Draft, Nyaya Professor, and Nyaya Guide are capabilities inside NyayaGrid — not separate apps, auth systems, or domains.

Authoritative companions: [`.cursorrules`](.cursorrules), [`NYAYAGRID_PRODUCT_SPEC.md`](NYAYAGRID_PRODUCT_SPEC.md), [`README.md`](README.md).

## Prerequisites

- Node.js **≥ 20** (repo `engines.node`)
- npm **10.x** (package manager pinned in root `package.json`)
- Docker Desktop (Postgres + MinIO via Compose)

## Local quick start

```bash
cp .env.example .env
npm install
npm run docker:up
npm run db:migrate
npm run dev
```

Open http://localhost:3000

| Service | Local default |
| --- | --- |
| Web app | http://localhost:3000 (`apps/web`) |
| Postgres + pgvector | `localhost:5433` → `postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid` |
| MinIO (S3-compatible) | http://localhost:9000 |

Default local providers (from `.env.example`): `AUTH_PROVIDER=dev`, `AI_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock`, `STORAGE_PROVIDER=minio`.

Optional worker process (document/jobs pipeline):

```bash
npm run dev:worker
```

## Monorepo layout

```
apps/
  web/          Next.js professional/student/public surfaces
  worker/       Background job worker
packages/
  ai/           Provider-agnostic AI + evals
  agents/       Nyaya Agents orchestration
  auth/         Auth adapters (dev / Clerk)
  database/     Drizzle schema + SQL migrations
  documents/    Upload, OCR, chunking, embeddings pipeline
  intelligence/ Matter intelligence / analysis helpers
  jobs/         Job definitions (Inngest-backed)
  jurisdiction/ US jurisdiction awareness
  permissions/  Capability + matter authorization
  platform/     Config gate, feature flags, models
  research/     Legal authority corpus + research
  search/       Retrieval
  ui/           Shared UI
  validation/   Shared schemas
  workspaces/   Student / public workspace helpers
  observability/
benchmarks/
  nyaya-bench/  Reliability / jurisdiction benches
scripts/
  certification/  Beta / release certification helpers
  corpus/         CourtListener queue, staging, reconciliation, generation
  dev/            Local developer utilities
  maintenance/    Ops rehearsals (backup, ClamAV)
  migrations/     One-off migration helpers
```

Workspaces are declared in root `package.json` (`apps/*`, `packages/*`, selected benchmarks).

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Web app |
| `npm run dev:worker` | Worker |
| `npm run build` | Build web |
| `npm run typecheck` | Typecheck workspaces |
| `npm run test` | Unit/integration tests (workspaces) |
| `npm run test:e2e` | Playwright |
| `npm run db:generate` | Drizzle generate (`@nyayagrid/database`) |
| `npm run db:migrate` | Apply SQL migrations |
| `npm run db:studio` | Drizzle Studio |
| `npm run eval:ai` | Mock AI evals (CI-safe) |
| `npm run eval:ai:live` | Opt-in live evals — see [`docs/AI_EVAL_LIVE.md`](docs/AI_EVAL_LIVE.md) |
| `npm run seed:golden-matter` | Seed SYNTH golden matter fixtures |
| `npm run docker:up` / `docker:down` | Local Postgres + MinIO |
| `npm run ops:backup-rehearse` | Backup/restore rehearsal |
| `npm run ops:verify-clamav` | ClamAV verification helper |
| `npm run research:import` | Import research fixtures (`--fixtures` for SYNTH) |

Corpus / CourtListener worker tooling (ops only; never required for local app boot):

| Command | Purpose |
| --- | --- |
| `npm run queue2:preflight` | Queue2 preflight |
| `npm run queue2:worker:once` | Dual-lane worker once |
| `npm run queue2:validate` | Queue2 / CL controller unit tests |

See [`packages/research/corpus/QUEUE2_WORKER_OPERATIONS.md`](packages/research/corpus/QUEUE2_WORKER_OPERATIONS.md).

## Environment

Copy [`.env.example`](.env.example). Do not invent production secrets in docs.

Load-bearing categories:

- `APP_ENV` — `development` \| `test` \| `staging` \| `production` (production config gate)
- `DATABASE_URL`
- `AUTH_PROVIDER` (`dev` \| `clerk`) + Clerk keys when clerk
- Storage (`STORAGE_PROVIDER`, S3/MinIO vars)
- AI (`AI_PROVIDER`, `EMBEDDING_PROVIDER`, optional OpenAI/Anthropic/Google keys)
- Optional: ClamAV, SMTP, Stripe, Inngest, feature flags

`APP_ENV=production` refuses unsafe local providers — see [`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md) and `packages/platform`.

## Database

- ORM / schema: **Drizzle** in `packages/database`
- SQL migrations: `packages/database/drizzle/` (current tip includes `0024_citation_target_classification.sql`)
- Apply: `npm run db:migrate`

Authorization is application-layer (permissions + matter membership), not Postgres RLS — see [`docs/SECURITY.md`](docs/SECURITY.md).

## First vertical slice (smoke)

Prove one matter-centric loop, not disconnected mock pages:

1. Sign in (dev auth locally)
2. Create/join organization → client → matter
3. Upload a PDF → wait until document is `ready`
4. Ask Nyaya a question → receive cited answer
5. Propose/approve a timeline event → create a task

## Testing priorities

- Tenant and matter isolation (`@nyayagrid/permissions`)
- Citation / quote validation (`@nyayagrid/ai`)
- Upload + document processing
- Human approval gates (memory, graph edges, agent proposals, privilege)
- Audit logging
- Professional vs Professor vs Guide isolation

DB-backed tests often need:

```bash
# PowerShell
$env:RUN_DB_TESTS="1"
$env:DATABASE_URL="postgresql://nyayagrid:nyayagrid@localhost:5433/nyayagrid"
```

## Demo / fixture rules

Use clearly synthetic names and fictional authorities. Never invent realistic-looking case citations that could be mistaken for real authority.

## Related docs

- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md)
- [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
- [`docs/AI_EVALUATIONS.md`](docs/AI_EVALUATIONS.md)
