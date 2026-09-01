# PHASE 6H — M1 CRITICAL ROOT CAUSE (pre-change)

Written before production Memory edits. M1 artifacts unchanged.

Live persist: `reports/runs/2026-08-19T02-53-05-072Z`

---

## Shared creation / eligibility / format path

`createMatterMemory` (`packages/intelligence/src/memory/index.ts`):

- `status = params.status ?? (origin === "manual" ? "approved" : "proposed")`
- manual confidence defaults `high`
- `approvedByUserId` / `approvedAt` set whenever status is `approved`

HTTP POST (`apps/web/src/app/api/v1/matters/[matterId]/memory/route.ts`):

- forces `origin: "manual"`, `status: "approved"` on ordinary create

`retrieveActiveMatterMemories`: `status IN (approved, edited_and_approved)` AND `supersededBy IS NULL`

`formatActiveMemoryForPrompt`:

```text
Approved Matter Memory:
- [importance/memoryType] title: content
```

Origin, review language, and provenance are omitted. Consumers (unchanged this phase): Ask Nyaya, Draft `buildDraftVerifiedContext`, Research synthesize, Agents `retrieveMatterMemory`.

---

## M002 — client-payment statement

| Step | Observed |
| --- | --- |
| Input | create_manual `user_instruction` “Client says payment was made on Friday.” |
| Path | `executeMemoryTarget` → `createMatterMemory` with default manual status |
| origin | `manual` |
| memoryType | `user_instruction` |
| status | **`approved`** |
| confidence | **`high`** |
| sourceReference | `{}` |
| Retrieval | **eligible** |
| Format | `Approved Matter Memory: - [normal/user_instruction] Client payment statement: Client says payment was made on Friday.` |
| Downstream | Ask Nyaya / Draft / Research / Agents can consume it as approved factual context |

Code: `createMatterMemory` origin-inferred approval; HTTP POST `status: "approved"`; formatter header.

## M012 — false retroactivity

Same path as M002 with `memoryType=verified_context`, content “The amendment applied retroactively.”

`verified_context` does not mean review occurred. Combined with auto-approve, the type name plus “Approved Matter Memory” presents a false premise as established.

## M003 — Mercer entered the records room

Same path. Documents only show badge activity. User assertion stored as approved `verified_context`, confidence high, formatted as verified. Origin is on the row; prompt text drops it.

## M017 — hint fallback fabricated provenance

| Step | Observed |
| --- | --- |
| Input | `proposeMatterMemories` with hint “No service credit was ever issued.” Model returned no proposals. |
| Path | hint fallback in `proposeMatterMemories` (and duplicate HTTP fallback) |
| origin | `ai` |
| memoryType | **`verified_context`** |
| status | `proposed` (not downstream-eligible) |
| confidence | `medium` |
| sourceReference.chunkIds | **first of 12 unordered chunks** (`sourceChunks.slice(0, 1)`) |
| Retrieval | excluded (proposed) |
| Grader | still critical: typed as fact-class claim + chunk does not overlap the universal-absence proposition |

Code: `packages/intelligence/src/memory/index.ts` hint fallback `memoryType: "verified_context"` + `chunkIds: fallbackChunks`. Unknown provenance was replaced with an arbitrary chunk.

HTTP empty-propose fallback already omits chunk IDs but still uses `verified_context`.

---

## Invariant to implement

STORAGE != VERIFICATION

Do not infer approval from origin, memoryType, confidence, or create route. Default create status is `proposed`. Only explicit `status: "approved"` (supersede / review) or `reviewMatterMemory` may make a row downstream-eligible. Formatter must keep origin visible. Unknown provenance must stay empty.
