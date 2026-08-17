# Retention and legal hold (P7 design)

Spec: design now; full records-management product later. The load-bearing control already in code is **legal hold blocks deletion**.

## What a hold covers

A `legal_holds` row is organization-wide (no matter/document), matter-scoped, or document-scoped. `released_at` null means active. `assertNotOnLegalHold` must run before irreversible deletion.

Holds outrank user deletion requests and any future retention job. Spoliation is sanctionable.

## Deletion today

- There is no silent purge job.
- `requestDataDeletion` records intent (`pending` / `scheduled` / `rejected` / `cancelled` / `completed`).
- If a hold covers the scope, the request is stored as **`rejected`** with the hold reason — not queued as if it could run.
- Original uploaded files remain in object storage until an operator-executed deletion (out of this slice) re-checks holds.

## Intended retention (not auto-enforced)

| Record | Intent | Notes |
| --- | --- | --- |
| Original documents / versions | Keep until hold-cleared deletion request completes | Immutable originals |
| Audit events | Keep for the life of the organization and any active hold | Attorney-exportable per matter; no document bodies |
| AI usage events | Tokens and identifiers only | `sanitizeUsageMetadata` drops prompt/content keys |
| Conversations / AI artifacts | Matter-scoped work product | Same hold rules as the matter |
| Guide / Professor user data | User-scoped; no legal-hold table | Export via personal data export |

Do not auto-delete audit events or originals on a calendar in this version.

## UI

Organization owners use **Compliance** (`/app/compliance`) to place/release holds and file deletion requests. Matter Home can export that matter’s audit log.
