# WP-04 deployment readiness checklist (executable)

Do **not** activate production from this document alone. Check each item in the target environment.

## OCR

- [ ] `OCR_PROVIDER=none|http|tesseract`
- [ ] If `http`: `OCR_ENDPOINT` reachable over TLS; optional `OCR_API_KEY`, `OCR_TIMEOUT_MS`
- [ ] If `tesseract`: `tesseract.js` installed **or** system tesseract available; smoke a scanned fixture
- [ ] `FEATURE_OCR=1` only when a real provider is wired
- [ ] Health: image-only PDF reaches `requires_ocr` or OCR success — never silent empty READY
- [ ] Load-test managed endpoint at agreed RPS; record p95

## ClamAV

- [ ] `MALWARE_SCANNER=clamav`
- [ ] `CLAMAV_HOST` / `CLAMAV_PORT` point at managed clamd
- [ ] `CLAMAV_FIXTURE` **unset** in staging/production
- [ ] Probe: EICAR FOUND + clean OK (`npm run ops:verify-clamav`)
- [ ] Upload E2E: clean → ready; EICAR → `scan_blocked`; down scanner → `malware_scan_failed`
- [ ] Download blocked for `uploaded` / `awaiting_malware_scan` / `scan_blocked` / `malware_scan_failed`
- [ ] Alerts on scan failure rate / clamd down

## Clerk MFA

- [ ] `AUTH_PROVIDER=clerk` with live keys
- [ ] Clerk Dashboard: MFA required for org (human ops — not automated here)
- [ ] `REQUIRE_CLERK_MFA=1` (or `FEATURE_REQUIRE_CLERK_MFA=1`) for server defense-in-depth
- [ ] Staging: enroll + challenge with test user; API returns `MFA_REQUIRED` / `MFA_CHALLENGE_REQUIRED` without secrets
- [ ] Production Dashboard change separately approved

## Terms / Privacy

- [ ] Confirm published versions match `CURRENT_TERMS_VERSION` / `CURRENT_PRIVACY_VERSION`
- [ ] Acceptance API reachable; audit events written
- [ ] Attorney sign-off recorded; then bump versions if counsel edits copy
- [ ] No production claim of attorney approval until sign-off exists

## Shared

- [ ] Secrets via secret manager (never git)
- [ ] Timeouts/retries documented for OCR + ClamAV
- [ ] Rollback: disable `FEATURE_OCR`; keep malware fail-closed
- [ ] Incident: ClamAV down → uploads fail closed (see `docs/INCIDENT_RESPONSE.md`)
