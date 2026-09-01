# BASELINE 6W-R1 FROZEN ATTEMPT 2 — INVALID LIVE PROOF

This sequential harness run is **not** a valid frozen regression.

- Compare B2 hung past the 30-minute timeout after OpenAI `fetch failed`.
- Later suites reported `INFRASTRUCTURE: fetch failed` / `getaddrinfo ENOTFOUND api.openai.com`.
- Deposition and Research JSON had `infrastructure > 0` and `criticalFails: 0`; the harness incorrectly labeled those **PASS**.
- C2A and 6U crashed on the same DNS failure.

Do not use this file as the 6W-R1 frozen gate. Dedicated Research R1 (iter 2) and dedicated DA1 (iter 3) remain the valid live proofs for those suites.
