# Case Polish — P1 Task Tracker

**Goal:** Close the remaining attorney-facing Case gaps from dogfood so a lawyer can stay on *this* matter: open the original file, see both CAM sides, inspect Graph neighborhood, and click Case sections. This is Harvey roadmap **P1**. It is not Case Experience §7 and not a production go-live.

Related: [`HARVEY_LEVEL_ROADMAP.md`](./HARVEY_LEVEL_ROADMAP.md) · [`CASE_DOGFOOD_TRACKER.md`](./CASE_DOGFOOD_TRACKER.md) (walk closed; nits landed here)

Mark items `[x]` as they ship.

---

## Major

- [x] **Documents open/download** — original file from the Documents row and from a citation chip (preserve original; audit `document.download_signed`)
- [x] **Evidence contradiction detect** — golden CAM conflict (depo vs PM email) produces dual-sided cards; Timeline related IDs must not merge dates
- [x] **Graph neighborhood** — node click is not “Invalid request”; proposed edges remain Suggested until approved
- [x] **In-page Case navigation** — section links change the route (server Case layout + `router.push` on Case tabs)

## Medium

- [x] Timeline: UTC calendar-date display; reject-with-reason like Review facts
- [x] Research: 0 hits still allows notes; no fake primary/secondary labels
- [x] `synth-party-roster.txt` included in `buildGoldenFixtureDocuments()` / golden seed
- [x] Home: clearer next-action copy (no IA redesign)

## Minor

- [x] Timeline extract discoverability (copy points at Review)
- [x] Graph Propose AI empty-state copy when no edges are proposed
- [x] `LoadingState` keeps `suppressHydrationWarning`

---

## Notes

- Citation chips open the stored original via a signed URL; originals are not replaced.
- CAM detect merges a deterministic exact-date finder with the model/mock output and re-runs empty cached detections.
- Graph neighborhood now includes proposed edges, labeled Suggested.
- Agent Quality Section B (attorney review) remains open and is not part of this track.

**Close-out walked 2026-08-17:** `npm run seed:golden-matter` on `SYNTH-GOLDEN-LEASE-V1` (`3ad4246b-853d-4e18-97c0-f622781293ce`). Party roster seeded `ready`. Evidence Detect produced dual-sided **Conflicting CAM send dates** (PM email March 3, 2025 / depo February 28, 2025), Suggested, not merged. Documents Open original/Download present on all six files. Case tabs change the route. Graph Lease Commencement neighborhood loads (`supported_by` Master Lease, Verified) — no “Invalid request.”
