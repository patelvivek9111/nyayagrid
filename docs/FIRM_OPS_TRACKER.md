# Firm Operations — P6 Task Tracker

**Goal:** SYNTH/dev firm-ops screens so a lawyer can track time, draft an invoice from posted time, see a calendar of deadlines/tasks, file a pasted email to a matter (human confirm), invite a Client Guest, and let that guest see documents + limited Ask. This is Harvey roadmap **P6**. It is **not** Microsoft Graph, Google Calendar sync, live SMTP, or a payment processor.

NyayaGrid is not go-live. P2 live Clerk/S3 remain BLOCKER for real client data. These screens run on the local/dev stack with `AUTH_PROVIDER=dev` and `ConsoleEmailProvider`.

---

## In scope (this track)

- [x] Email **file-to-matter** (paste subject/from/body → confirm → Case document). No autonomous send.
- [x] Firm calendar over verified deadlines + task due dates (timezone already on deadlines). No Outlook/Google sync.
- [x] Time-entry assistance: suggest from a chat title/description; human posts or rejects.
- [x] Basic billing: draft invoice from **posted** time. Not trust accounting.
- [x] Client Guest role + `/portal` (documents + limited Ask). No mixing with student/public tables.
- [x] In-app notifications (deadline, invite, time suggestion). Invite create UI on Settings. SMTP still console in development.

## Out of scope

- Graph / Outlook / Gmail mailbox sync
- Push to an external calendar
- Stripe / payment collection
- Complex accounting
- Autonomous send, file, or sign

---

## Notes

- `client_portal` entitlement remains on the **firm** plan; development billing still grants extras.
- Send-email stays blocked in agents.

**Close-out:** `npm run seed:golden-matter` + Evidence Detect on `SYNTH-GOLDEN-LEASE-V1`.
