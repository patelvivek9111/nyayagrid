# WP-05 — Audit retention, secrets rotation, version provenance, emergency rollback

## Audit retention

| Event class                         | Retention intent                                      | Notes                                      |
| ----------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Application `audit_events`          | Retain through matter/case lifecycle + legal hold     | Schema supports litigation holds           |
| Deploy / ops evidence JSON          | Keep under `packages/research/corpus/reports/wp05-*`  | Do not rewrite historical PASS evidence    |
| AI job provenance                   | Store model, prompt hash, tools, sources              | Never log privileged document bodies       |
| Access to sensitive files           | Record accessor + document id                         | Required for tenant investigations         |

Destructive deletes of audit narrative require explicit dual approval. Prefer redact-in-place over destroy.

## Secrets rotation

| Class                    | Staging practice (verified pattern)                         | Production                         |
| ------------------------ | ------------------------------------------------------------- | ---------------------------------- |
| Product DB runtime role  | New least-privilege role → Fly secret stage → same-image deploy → revoke old | Separate approval; not performed |
| SMTP / monitor           | Repo Actions secrets; avoid inbox spam                        | Separate                          |
| Clerk / AI providers     | Rotate in provider console; update Fly secrets                | Separate                          |

Rules:

- Never print passwords or connection strings in CI logs or tickets.
- Wipe temporary secret files after cutover.
- Staging rotation evidence (sanitized): `wp05-product-runtime-rotation-final.json` (historical).

## Version provenance

| Mechanism                         | Requirement                                                                 |
| --------------------------------- | --------------------------------------------------------------------------- |
| Baked `GIT_SHA` / `BUILD_ID`      | Pass `--build-arg GIT_SHA` on image build; write `/app/release-identity.json` |
| Ready probe                       | Expose `checks.gitSha` matching deployed commit                             |
| Rollback durability               | Image rollback must retain baked identity (staging PASS historically)       |

Do **not** rely solely on ephemeral `fly deploy --env GIT_SHA=...`.

Historical evidence: `packages/research/corpus/reports/wp05-staging-identity-rollback.json`.

## Emergency rollback

1. Prefer previous known-good **image** (`fly deploy --image … --strategy immediate`).
2. Do **not** auto-run DB migrations as part of rollback.
3. Confirm ready + baked `gitSha`.
4. Schema rollback is a separate approved migration plan — not routine.
5. Production rollback: **NOT VERIFIED** (no production Fly app).

Full procedures: `docs/operations/WP05_INCIDENT_RUNBOOKS.md` §§7–8, `docs/operations/WP05_OPS_RUNBOOK.md`.
