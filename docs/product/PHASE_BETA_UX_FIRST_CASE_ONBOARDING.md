# NYAYAGRID BETA UX — FIRST CASE ONBOARDING (UX-ONBOARD-1)

Navigation, empty states, and first-run routing only. Frozen AI, Review, ingest, Agents, and reliability semantics were not modified. No sample Cases or documents are created.

---

## 1. Existing First-Run Architecture (before this phase)

| Step | Behavior |
| --- | --- |
| Sign-in | Clerk Account Portal or `/sign-in` stub. Default professional entry is `/app`. |
| `/app` | Generic Ask Nyaya. Case files are optional via a chip. Easy to ask without a Case. |
| `/app/onboarding` | Created a firm, then showed “Created {name} ({id})” and **stopped**. |
| After org exists | `GET /api/v1/organizations` + localStorage active org. Invited users already have a membership. |
| Zero Cases | Cases list empty state; sidebar “No cases yet”; `/app` still generic Ask. |
| One / many Cases | List + sidebar recents. No auto-open. `/app/cases/new` already `router.push` into the Case after create. |
| New Case form | Required: title + existing `clientId`. Optional: practice, jurisdiction, court, description. **No clients → cannot submit** (sent to Clients). |
| Documents / Chats / Review | Documents had processing copy; Home listed next steps; Review already a primary tab. |

---

## 2. User Types

| Type | First-run |
| --- | --- |
| New owner (no org) | `/app` → `/app/onboarding` → create firm → `/app/cases/new` → Case Home |
| Existing org, zero Cases | Skip firm form. Owner/lawyer → Case creation. Staff → Cases list without create. |
| Existing Cases | `/app/cases` list. Generic `/app` Ask remains available. No forced new Case. |
| Invited lawyer | Skip firm creation. Cases list (or new Case if none). |
| Staff | No Create Case. Empty Cases copy explains a lawyer must create one. |
| Client guest | `/portal`. Not professional onboarding. |

---

## 3. Firm Creation

POST `/api/v1/organizations` is unchanged (no duplicate on GET/refresh). The form POSTs only on submit; the button disables while pending. Slug auto-fills from the name (editable). After success: `selectOrganization` + `reloadOrganizations` + **`/app/cases/new`**.

If the user already has an organization, the create form is skipped (`continueHref`). Refresh on `/app/onboarding` with an org does not POST again.

---

## 4. First Case Creation

Required now: Case name + client (existing select, or inline name if the firm has no clients). Can add later: practice area, jurisdiction, court, description. Backend schema unchanged.

No automatic Case. `matters.create` required; otherwise a permission message and link to the Cases list.

---

## 5. Post-Case Destination

**Case Home** (`/app/cases/{id}`), already the create success route. User sees Case title, client, and the start panel.

---

## 6. Empty Case Guidance

When there are no documents:

- “Start by adding the documents for this Case.”
- Primary: **Upload documents**
- Secondary: **Ask about this Case** (Case Chats, not `/app`)
- Short derived checklist (not persisted): firm, Case, documents, Ask, Review

---

## 7. First Document Upload

Documents empty state points at upload. After upload, existing async processing remains. Message: processing is in the background; keep working; Ask when ready; suggestions appear in Review. No auto-jump to Review. No exact ETA.

---

## 8. Case-Scoped Ask

Home and Chats CTAs use `/app/cases/{id}/chats` (“Ask about this Case”). `/app` with **zero Cases** redirects to `/app/cases` so a new lawyer cannot start generic Ask before a Case exists. Returning users with Cases still use `/app`. Ask reasoning unchanged.

---

## 9. Review Handoff

Review tab, counts, and semantics unchanged. Home still shows the Review card when items are pending. Documents still links to Review after processing. Onboarding does not call Review APIs.

---

## 10. Returning Users

Org + Cases → Cases list or `/app` Ask. One Case is **not** auto-opened. Onboarding form is skipped.

---

## 11. Invited Users

Memberships from `GET /organizations` skip firm creation. Accept-invite continues to `/app/cases` (guests then redirect to `/portal`). No second organization is created.

---

## 12. Guests

`roleKey === client_guest` → `/portal` from `/app`, Cases list, and New Case. Create Case / Create firm are not the guest path. Portal UI was not expanded.

---

## 13. Error / Retry Behavior

Firm and Case create surfaces show API error text. Submit buttons disable while pending. Failed create does not navigate. Duplicate slug on retry is an API error, not a silent second firm. Refresh does not re-POST.

---

## 14. Time to First Value

In-app actions after authentication (owner, empty firm):

1. Create firm (name; slug auto-filled; type)
2. Create Case (name + client name)
3. Upload a document (one file)

**Three meaningful decisions** to first upload. Case workspace is reached after step 2.

---

## 15. Tests

- `apps/web/src/lib/first-run.test.ts`
- `apps/web/src/lib/first-case-onboarding.test.ts`

---

## 16. Manual Dogfood (synthetic)

**New lawyer:** sign in → onboarding → firm → new Case → Case Home → upload → processing copy → Case Chats (matter Ask) → Review tab visible → reload does not recreate firm/Case.

**Invited lawyer:** org+Case exist → skip firm form → Cases list → open Case.

**Zero Cases:** Cases empty state **Create Case**.

**Guest:** professional `/app` → `/portal`.

---

## 17. Remaining P1 UX Issues

- Document list has no search/filter (hard at 50–100 files)
- One-file upload only
- Three Ask surfaces remain for users who already have Cases
- Case chrome still omits client in the tab header
- Capability-aware hiding is incomplete outside this first-run path
- Long-job progress for Draft/Analysis still thin

---

## 18. Controlled-Beta Assessment

**Ready as first-run continuation:** firm → first Case → Case Home → documents → Case Ask, with guests and invited lawyers not forced through create-firm.

---

## 19. Exactly one next UX recommendation

**Document search/filter on the Case Documents list.** After onboarding, the first real work is files; the list still has no find-in-list and the API already supports a cursor. Do not start that work in this phase.

---

## Explicit answers

1. **New professional user?** `/app`, then `/app/onboarding` if they have no firm.
2. **Firm creation continues to first Case?** Yes → `/app/cases/new`.
3. **Existing-org skip firm creation?** Yes.
4. **Invited lawyer reach Cases?** Yes (`/app/cases`).
5. **Zero Cases?** Create Case is the empty-state action (if permitted).
6. **After first Case?** Case Home.
7. **Upload obvious?** Yes.
8. **First-use Ask Case-scoped?** Yes (Chats). `/app` blocked until a Case exists.
9. **Onboarding trigger AI?** No.
10. **Sample data?** No.
11. **Guest in professional onboarding?** No — `/portal`.
12. **Refresh/back duplicate firm/Case?** No (POST only on submit).
13. **Actions to first Case?** Two in-app (firm + Case), then upload.
14. **Largest remaining onboarding friction?** Finding files once a Case has many documents (search/filter).
15. **Frozen AI or Review semantics modified?** **NO.**
