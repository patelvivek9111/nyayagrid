# Nyaya Guide — P5 Task Tracker

**Goal:** Make Nyaya Guide a dogfood-complete public workspace: spec navigation, always-visible no-privilege copy, jurisdiction asked before jurisdiction-dependent answers, court-notice dates only as written, high-stakes escalation, isolation tests, Playwright past smoke. This is Harvey roadmap **P5**. It is not licensed research and not a production go-live.

Source: [`NYAYA_GUIDE.md`](./NYAYA_GUIDE.md) · [`HARVEY_LEVEL_ROADMAP.md`](./HARVEY_LEVEL_ROADMAP.md)

`FEATURE_GUIDE` stays **off** in staging/production until P2 live trust **and** legal review of Guide copy. Development/test remain on so dogfood works.

---

## Product

- [x] Plain-language Q&A with jurisdiction prompted; caveat shown when unknown
- [x] Document / court-notice explanation (verbatim dates only; court-notice panel)
- [x] Situation timeline (`user_provided` events only)
- [x] Consultation packet (+ print)
- [x] High-stakes escalation banner (eviction, arrest, deportation, DV, custody, imminent deadline)
- [x] No privilege / no attorney-client relationship copy — always visible in Guide chrome
- [x] Spec public nav: Ask, Explain a Document, Build My Timeline, Prepare for a Lawyer, My Files, Saved Conversations, Safety and Privacy

## Isolation and flags

- [x] Isolation tests: Guide search SQL cannot name `student_*`, `matters`, `documents` (plus `student_case_chunks`)
- [x] Playwright beyond smoke; unique ingest hashes per run
- [x] `FEATURE_GUIDE` enforced on Guide APIs and `/guide` layout (404 / disabled page when off)

---

## Notes

- Guide never joins professional or student tables. Dates are never computed.
- Terms/Privacy counsel (P2.8) is a different lawyer from Guide copy review; draft legal pages stay badged until counsel signs off.

**Close-out:** `npm run seed:golden-matter` + Evidence Detect on `SYNTH-GOLDEN-LEASE-V1` after this track (golden matter is professional; Guide isolation must still hold).
