# NYAYAGRID BETA UX — CASE CONTEXT / JURISDICTION (UX-JURIS-1)

Presentation and interaction only. Phase 6S (`@nyayagrid/jurisdiction`) owns structured jurisdiction schema, court registry, federal circuit derivation, coverage, and matter updates. No Ask/Research/Draft/Agent reasoning, document ingest, or Review semantics were modified.

No AI calls. No LLM court detection. No hardcoded court lists in the frontend.

---

## 1. Existing Case Header

**Before:** Shared `CaseHeader` (`apps/web/src/components/ux/case-chrome.tsx`) showed only:

- “CASE” label
- `{matterNumber} — {title}`
- Optional subtitle + status

**Chrome API** (`GET .../chrome`) returned title, status, review badge counts, and `canUpload` only — no client or jurisdiction.

**Case Home** duplicated client/jurisdiction/court in a read-only panel using legacy free-text `matter.jurisdiction` / `matter.court`, ignoring `jurisdictionContext` from the full matter GET.

**New Case** used free-text jurisdiction and court fields; structured Phase 6S fields were not sent.

**Shared shell:** `CaseLayoutClient` → `MatterChromeProvider` → `CaseWorkspaceChrome` wraps all Case tab routes (Home, Chats, Documents, Review, Timeline, Work surfaces, etc.).

**Mobile:** Existing horizontal tab scroll unchanged; header uses truncation/wrap for long titles and jurisdiction lines.

---

## 2. Phase 6S Backend Contract

Used as-is:

| Surface | Role |
| --- | --- |
| `resolveMatterJurisdictionContext` + `uiJurisdictionContract` | Resolved Case context for display |
| `formatJurisdictionSummary` (via contract `summary`) | Header jurisdiction line — not rebuilt in UI |
| `GET /api/v1/jurisdiction/options` | Searchable state + filtered court lists |
| `PATCH /api/v1/matters/{matterId}` | Save structured fields via `updateMatterSchema` |
| `listCourts({ state, forumType })` | Dependent court dropdown (server-side filter) |
| `federalCircuitLabel` on court rows | Read-only circuit display |

Structured matter fields: `primaryState`, `forumType`, `courtId`, `governingLawState`, `choiceOfLawStatus`, `asOfDate`, `relatedJurisdictions`, legacy `jurisdiction`/`court` preserved.

Coverage: `supported` | `limited` | `unvalidated` — UI never says “Certified”.

---

## 3. New Header Design

Persistent Case identity in `CaseHeader`:

1. Case title (strongest): `{matterNumber} — {title}`
2. Client name + understated “Client” label
3. One concise jurisdiction line from `jurisdictionContext.summary` (+ related count when present)
4. **Case details** button (side panel)
5. Subtle **Add jurisdiction** link when context is unset
6. Status/subtitle row unchanged

Not oversized; no badge clutter.

---

## 4. Client Context

Chrome API joins `clients.displayName`. Header shows client immediately for permitted users.

---

## 5. Jurisdiction Summary

Uses backend `summary` via `compactJurisdictionHeaderLine()` — appends `+N related` only from stored `relatedJurisdictions`, without inventing legal mappings.

---

## 6. Case Details Interaction

**Case details** opens a right-side panel (`CaseDetailsPanel`) from any Case tab. Loads full matter GET + jurisdiction options; saves via existing PATCH. Unsaved-close confirms when dirty.

View-only users see all fields but cannot Save (`matters.edit` required).

---

## 7. State Dropdown

Searchable combobox populated from jurisdiction options API. Stores stable `primaryState` codes. Supports “Not set”. Type-ahead matches name and code.

---

## 8. Court Type

Simple select: State, Federal, Administrative, Other — only types Phase 6S exposes.

---

## 9. Court Dropdown

Dependent on selected state + court type via filtered options API. Searchable. Empty: “Court not listed”.

---

## 10. Federal Circuit Derivation Display

Read-only **Federal circuit** from court `federalCircuitLabel` — “Derived from selected court”.

---

## 11. Practice Area

Free-text field reusing existing matter `practiceArea`.

---

## 12. Forum vs Governing Law

Separate Forum block and Governing / choice of law field with helper copy.

---

## 13. As-of Date

**Law as of** date input with brief authority-evaluation explanation.

---

## 14. Related Jurisdictions

Optional **+ Add another jurisdiction** list.

---

## 15. Multi-Jurisdiction UX

Header one line + `+N related`; full detail in panel.

---

## 16. Unknown Jurisdiction

Not set allowed. Header: `Jurisdiction not set` + **Add jurisdiction**.

---

## 17. Coverage Status

Panel line: validated / limited / supported wording — never “Certified”.

---

## 18. Permissions

`canEdit` from `matters.edit`. View-only cannot Save.

---

## 19. Legacy Cases

Legacy free-text shown when present; structured fields replace on save without guessing.

---

## 20. Case Creation Integration

Required: name + client. Optional structured state, court type, court on create form.

---

## 21. Responsive / Accessibility

Labeled controls, searchable dropdowns, dialog panel, date input, readable derived circuit.

---

## 22. Tests

`apps/web/src/lib/case-jurisdiction-ux.test.ts`

---

## 23. Synthetic Dogfood

Open Case → header context → Case details → PA/Federal/E.D. Pa. → DE governing → NJ related → Save → Documents/Review header stable → view-only → missing jurisdiction CTA.

---

## 24. Remaining Case UX Gaps

- Judge field still unstructured on Home
- Research inline coverage warning not wired
- Case list has no jurisdiction column

---

## 25. Controlled-Beta Assessment

Ready for controlled beta: identity, client, jurisdiction visible and editable via Phase 6S contracts with honest coverage messaging.

---

## 26. Exactly One Next UX Recommendation

**Ask-surface simplification** — default “ask about this Case” with jurisdiction nudge when missing.

---

## Explicit Questions

| # | Answer |
| --- | --- |
| 1 Identify Case? | Yes |
| 2 Client visible? | Yes |
| 3 Jurisdiction visible? | Yes |
| 4 Editable easily? | Yes — Case details |
| 5 State searchable? | Yes |
| 6 Court type narrows courts? | Yes |
| 7 Court searchable? | Yes |
| 8 Circuit derived? | Yes |
| 9 Forum vs governing separate? | Yes |
| 10 As-of editable? | Yes |
| 11 Related jurisdictions? | Yes |
| 12 Multi-state without clutter? | Yes |
| 13 Unknown allowed? | Yes |
| 14 Missing discoverable? | Yes |
| 15 Coverage honest? | Yes |
| 16 UNVALIDATED as Certified? | **NO** |
| 17 View-only can edit? | **NO** |
| 18 Frontend legal hierarchy? | **NO** |
| 19 Ask/Research/Draft/Agent changed? | **NO** |
| 20 Documents/Review changed? | **NO** (shared header only) |
