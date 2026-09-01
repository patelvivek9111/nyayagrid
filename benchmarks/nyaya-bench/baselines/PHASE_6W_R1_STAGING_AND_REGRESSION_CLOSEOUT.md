# PHASE 6W-R1 — STAGING CREDENTIALS, INNGEST CLOUD, AND FROZEN LIVE REGRESSION CLOSEOUT

**Frozen:** 2026-08-27  
**Remediation iterations used:** 3 of 5  
**Stop condition:** **B** — Track A code work complete; Clerk and Inngest Cloud credentials prevent truthful staging proof  
**FEATURE_AGENTS:** OFF (staging and production defaults; `agents === false` check passed)  
**Attorney validated:** NO  
**Nationwide support:** NO  
**Automatic production deployment:** NO  
**Technically deployable for a controlled beta:** **NO**

Do not start 6X. Do not invite beta users. Do not enable Agents. Do not claim nationwide support.

---

## 1. Executive Summary

6W left NyayaGrid locally rehearsed but not deployable. 6W-R1 closed the in-repo Research R1 criticals (R010, R014), a subsequent deposition contradiction-class regression (DA003/DA004/DA006), and taught the frozen harness to fail on suite `criticalFails` **and** on infrastructure-only JSON even when the process exits 0.

A valid sequential frozen harness (attempt 3) finished with **criticalFailures []**. Research R1 stayed at 0 critical. Deposition DA1 was 16/16 PASS.

Clerk keys remain unset. Inngest is local `INNGEST_DEV` mode. Track B HTTP, Cloud ingest, E2E canary, ready=200, rate-limit HTTP, image-tag rollback, managed PITR, and provider object recovery are **BLOCKED / EXTERNAL — NOT PROVEN**. Those absences are not marked PASS.

---

## 2. Starting 6W State

6V quality (untouched): 96.7% material, 100% critical safety.

6W local PASS: production build, staging boot, 13 migrations, pg_dump/pg_restore, private MinIO, restart, DevAuth refusal, RBAC/isolation DB tests, bounded OpenAI retries, process-pool close, live/ready split.

6W FAIL: Research R1 R010 + R014 criticalFails hidden behind harness exit 0; Clerk/Inngest Cloud absent.

---

## 3. Research R1 R010 Root Cause

**Class: C (classification) + D (synthesis wording), not retrieval-only.**

Task: “Is Other State Code § 100 controlling authority for a Synthetic Federal preliminary-injunction question?”

`classifyAuthorityRelationship` treated enacted law with jurisdiction `"Other State"` as **`unknown`**, because that label is not a USPS code. Hits therefore were not labeled `out_of_jurisdiction`. The synthesis prompt only forbade calling **persuasive / out_of_jurisdiction** authorities controlling. The model echoed the question as “Other State Code § 100 is controlling.”

Relationship architecture did not constrain the prose. Not a grader defect. Hidden GT unchanged.

---

## 4. Research R1 R014 Root Cause

**Class: E (citation mapping / snapshot) + model generation.**

The model can emit a UUID that is not in **this** retrieval allow-list. `validateSynthesisAgainstRetrieval` already dropped those ids from published propositions/sources. The bench snapshot still copied **dropped** ids onto `fabricatedAuthorityIds`. The grader treats a non-empty array as a final citation leak, so R014 failed even when the user-facing citation set was clean.

---

## 5. Research Production Changes

General; no R010/R014 task ids; no fixture-specific branches.

1. Enacted-law labels that are not federal and do not match implicated Case states → `out_of_jurisdiction` (`packages/jurisdiction/src/classify.ts`).
2. Deterministic `rewriteUnsupportedControllingClaims` after synthesis/memo (`packages/research/src/weight.ts`).
3. `fabricatedAuthorityIds` = ids **still published** after allow-list filtering; dropped attempts recorded as `droppedUnsupportedAuthorityIds`. Unretrieved UUIDs stripped from `conciseAnswer`.
4. Prompt: only `hierarchyRelationship=controlling` may be described as controlling.
5. Iteration 2: `rewriteUnsourcedEditorialTreatment` strips unsourced overruled / good-law claims (`packages/research/src/treatment.ts`).
6. Clerk-missing request path: `UnavailableAuthProvider` returns null identity (401 via `requireUser`) instead of throwing 500. Production boot still requires Clerk keys.

---

## 6. Research Anti-Overfit Tests

- NY matter + NJ statute → not controlling  
- TX matter + CA statute → not controlling  
- PA forum + DE governing + OH statute → not controlling  
- Unrecognized “Other State” enacted label → `out_of_jurisdiction`  
- Citation membership: nonexistent UUID, real UUID not in this retrieval set, valid retrieved id  
- Treatment rewrite uses **Northgate v. Harbor** wording, not R009’s Acme prompt  

---

## 7. Research R1 Re-run

| Run | Result |
| --- | --- |
| After iter 1 | R010 PASS, R014 PASS, **R009 FAIL**, criticalFails=1 |
| After iter 2 (`2026-08-27T09-52-06-747Z`) | **15 PASS, 3 NEEDS WORK, 0 FAIL, 0 criticalFails** |
| Frozen attempt 3 | **15 PASS, 3 NEEDS WORK, 0 FAIL, 0 criticalFails**; R010 PASS; R014 PASS |

Accepted non-critical NEEDS WORK: R002 near-name decoy; R003/R004 retrieval completeness.

---

## 8. Frozen Harness Semantic Parsing

`scripts/frozen-suite-status.ts` parses JSON objects from suite logs:

- `counts.criticalFails` / `counts.fail` / `counts.needs_work` / `counts.infrastructure` (v2 bench)
- `totals.critical` / `totals.fail` / `totals.needsWork` (C2A / 6U)
- `criticalSafety < 100`
- `criticalFailures[]`

**PROCESS STATUS** (exited / timeout / crash) is separate from **SUITE STATUS** (PASS / NEEDS_WORK / FAIL / CRITICAL).

Exit 0 + `criticalFails: 2` → suite **CRITICAL**.  
Exit 0 + `infrastructure: 16` + `criticalFails: 0` → suite **FAIL**; overall gate fails for a critical suite (the attempt-2 failure mode).  
CA012-style quality FAIL with `infrastructure: 0` and `criticalFails: 0` does **not** fail the overall safety gate.

---

## 9. Harness Lock / Process Safety

Preserved: sequential execution, lock file, per-suite timeout, SIGTERM then SIGKILL, progress logs, separate logs, `NYAYA_BENCH_BASELINES_ROOT=baselines/6w-regression`.

SIGINT/SIGTERM release the lock. Summary file is `BASELINE_6W_R1_FROZEN.json` so **6W** `BASELINE_6W_FROZEN.json` is not overwritten.

Attempt 1 and invalid attempt 2 are preserved as `BASELINE_6W_R1_FROZEN_ATTEMPT1.json` and `BASELINE_6W_R1_FROZEN_ATTEMPT2.json`.

---

## 10. Full Frozen Regression

| Attempt | Outcome |
| --- | --- |
| 1 (after Research iter 2) | Sequential complete; **deposition-da1 CRITICAL** (3 criticalFails). Research 0 critical. No stacking. |
| 2 (after DA1 iter 3) | **INVALID.** OpenAI `getaddrinfo ENOTFOUND api.openai.com`. Compare timed out. Later suites were infrastructure-only and were mislabeled PASS. Discarded. |
| 3 (DNS restored; infra parsing fixed) | Sequential complete, **no stacking**, **criticalFailures []**, exit 0. Wall ~63 minutes. |

Attempt 3 suite statuses:

| Suite | Status | Notes |
| --- | --- | --- |
| unit suites, J1, isolation/RBAC | PASS | 0 critical |
| Compare B2 | PASS | 48/48 |
| Contradiction B2 | PASS | 0 critical |
| Timeline T2 | NEEDS_WORK | 1 NW, 0 critical, 0 fail |
| Memory M2 | NEEDS_WORK | M001/M007/M010 needles, 0 critical |
| Analysis trust | PASS | |
| Deposition DA1 | PASS | **16/16**, 0 critical |
| Contract CA1 | FAIL | CA012 header span only, 0 critical |
| Evidence EM2 | PASS | 28/28 |
| Graph G2 | PASS | |
| Research R1 | NEEDS_WORK | R002–R004; R010/R014 PASS; 0 critical |
| Draft source limitation | PASS | |
| 6R | NEEDS_WORK | FS029 partial-ingest disclose; 0 critical |
| C2A | NEEDS_WORK | 124 pass / 3 NW / 0 fail / 0 critical |
| 6U-R1 | NEEDS_WORK | 45 pass / 2 NW / 0 fail; criticalSafety 100 |

Historical 6U/6V/6W baselines remain. 6U wrote `BASELINE_6U_6W_REGRESSION.json` (new file). C2A wrote under `baselines/6w-regression/`.

---

## 11. Clerk Configuration

| Variable | Presence |
| --- | --- |
| CLERK_SECRET_KEY | UNSET / commented |
| NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY | UNSET / commented |
| CLERK_WEBHOOK_SECRET | UNSET / commented |

**BLOCKED — HUMAN EXTERNAL ACTION REQUIRED**

---

## 12. Clerk Auth Proof

Not executed. Credentials absent. Not marked PASS.

Code change: missing Clerk keys no longer throw at provider construction; identity is null → unauthenticated 401.

---

## 13. HTTP RBAC

Not proven (Clerk blocked). DB RBAC/isolation tests remain from 6W and harness isolation suite (PASS).

---

## 14. Inngest Configuration

| Variable | Presence |
| --- | --- |
| INNGEST_EVENT_KEY | SET (local) |
| INNGEST_SIGNING_KEY | SET (local / weak) |
| INNGEST_DEV | SET (must be unset/false for Cloud) |

**BLOCKED — HUMAN EXTERNAL ACTION REQUIRED** — do not simulate Cloud proof.

---

## 15. Inngest Cloud Registration

Not executed.

---

## 16. Async Ingest

HTTP upload → Inngest Cloud → ready: **NOT PROVEN**.

---

## 17. Ingest Failure / Retry

Unit ingest-job retry cap remains from 6W. Live Cloud failure/retry: **NOT PROVEN**.

---

## 18. E2E Canary

**BLOCKED** (Clerk + Inngest Cloud).

---

## 19. Coverage Canary

HTTP canary **BLOCKED**. No 6W-R1 flag changed C2A certification. FEATURE_AGENTS remains off. Coverage not widened. C2A frozen attempt 3: 0 critical, VALIDATED/LIMITED/UNVALIDATED not converted by this phase.

---

## 20. HTTP Performance

**NOT PROVEN** (no authenticated HTTP).

---

## 21. HTTP Rate Limits

Unit presets unchanged. HTTP burst **NOT PROVEN**. Redis **EXTERNAL**.

---

## 22. Rollback

Image-tag N → N+1 → N: **NOT PROVEN** (no staging host). DB migrations remain additive (6W).

---

## 23. Managed PITR

**EXTERNAL — NOT PROVEN**. Local pg_dump/pg_restore from 6W still stands as rehearsal only.

---

## 24. Object Storage

Local MinIO rehearsal from 6W. Provider S3 versioning/recovery: **EXTERNAL — NOT PROVEN**.

---

## 25. Redis

`REDIS_URL` unset. Memory limiter is not production proof. **EXTERNAL**.

---

## 26. Malware

Development/local scanning is not staging proof. **EXTERNAL / BLOCKED** for real upload proof.

---

## 27. Invites

Application SMTP send is unimplemented. **Controlled-beta invitation path: Clerk-managed invites**, not in-app SMTP. SMTP is not a 6W-R1 code blocker if Clerk invites are used.

---

## 28. Monitoring

Signals remain: live/ready, JSON logs, Inngest dashboard (once Cloud exists). Alerting provider: **EXTERNAL**.

---

## 29. Privacy / Deletion

No UI copy claiming permanent purge of archived/deletion-requested data was found. Permanent purge remains a known beta limitation. Architecture not redesigned.

---

## 30. Health / Readiness

Without Clerk/Inngest Cloud/Redis/etc., staging **ready remains 503** by design. Gate was not bypassed.

---

## 31. Feature Flags

FEATURE_AGENTS unset in `.env`. Staging/production defaults **false**. No `ALLOW_AGENTS_IN_PRODUCTION`. C2A check: production/staging `agents === false` passed. Coverage was not widened.

---

## 32. External Actions

1. Create Clerk staging application + operator test users (no real clients).  
2. Unset `INNGEST_DEV`; install Cloud event/signing keys; register `https://<staging-host>/api/inngest`.  
3. Provision TLS/DNS hosting.  
4. Managed Postgres PITR rehearsal.  
5. Private non-localhost object storage with versioning.  
6. Redis for multi-instance rate limits.  
7. Production-shaped malware scanner.  
8. Alerting provider.  
9. Clerk-managed beta invites.

---

## 33. Final Scorecard

| Gate | Label |
| --- | --- |
| Research R1 critical | **PASS** |
| Deposition DA1 critical | **PASS** (attempt 3 16/16) |
| Harness JSON parsing | **PASS** (`criticalFails` + `infrastructure`) |
| Full frozen harness (valid run) | **PASS** (attempt 3, criticalFailures []) |
| Clerk | **BLOCKED** |
| HTTP RBAC | **BLOCKED** |
| Inngest Cloud | **BLOCKED** |
| Async ingest HTTP | **BLOCKED** |
| E2E canary | **BLOCKED** |
| Coverage HTTP canary | **BLOCKED** |
| Ready 200 | **BLOCKED** |
| HTTP performance | **BLOCKED** |
| HTTP rate limits | **BLOCKED** |
| Image-tag rollback | **NOT PROVEN** |
| Managed PITR | **EXTERNAL** |
| Provider object recovery | **EXTERNAL** |
| Secrets | **PASS** (no values printed) |
| Agents | **OFF** |

---

## 34. Deployment Decision

**TECHNICALLY DEPLOYABLE FOR CONTROLLED BETA = NO**

Track A frozen criticals are closed. Staging proof is not.

---

## 35. Attorney Validation

**NO**

---

## 36. Exactly One Next Phase

**PHASE 6W-R2 — CLERK STAGING, INNGEST CLOUD, AND HTTP CANARY**

Not 6X. Not public beta. Agents stay off. Nationwide stays NO.

---

## Iteration 3 deposition note

Attempt 1 DA1 invented sworn-testimony contradictions from testimony versus badge/access-log activity (`findingType: inconsistency`). Prompt text already forbade that. Production now applies `refineDepositionFindingClass`: credential/system activity versus physical denial is **tension**, using the same relation as the contradiction engine. Anti-overfit cases: vault/swipe, Texas login, Ohio warehouse. Two sworn physical-entry statements remain `inconsistency`.

---

## Final questions

1. What caused R010? **Unknown hierarchy on non-USPS “Other State” enacted law plus synthesis echoing “is controlling.”**  
2. What caused R014? **Unretrieved UUIDs dropped from output but still reported on snapshot.fabricatedAuthorityIds.**  
3. Were fixes general? **YES**  
4. Any fixture-specific branch? **NO**  
5. Does Research R1 now have 0 critical? **YES**  
6. Can an unretrieved authority ID reach final citation? **NO** (published set ⊆ retrieval allow-list)  
7. Can wrong-state authority be upgraded to controlling? **NO** (classification + deterministic rewrite)  
8. Does harness now fail on suite criticalFails? **YES** (also fails critical suites with infrastructure > 0)  
9. Did full frozen harness complete once without stacking? **YES** for the valid attempt 3. Attempt 1 and invalid attempt 2 were sequential, not stacked.  
10. Any frozen critical regression? **NO** on valid attempt 3  
11. Are Clerk credentials present? **NO**  
12. Is Clerk staging authentication proven? **NO**  
13. Does unauthenticated HTTP return correct status? **Code path is 401 when identity is null; not live-proven with Clerk**  
14. Is HTTP RBAC proven? **NO**  
15. Any HTTP cross-org leakage? **Not HTTP-proven; DB tests still show none**  
16. Is Inngest Cloud registered? **NO**  
17. Did upload→ingest→intelligence pass? **NO**  
18. Did failure/retry pass? **Unit yes; Cloud no**  
19. Did E2E staging canary pass? **NO**  
20. Did VALIDATED remain VALIDATED? **Not HTTP-proven; no config converted coverage**  
21. Did LIMITED remain LIMITED? **Not HTTP-proven; no config converted coverage**  
22. Did UNVALIDATED remain UNVALIDATED? **Not HTTP-proven; no config converted coverage**  
23. Is staging ready endpoint 200? **NO** (expected until secrets exist)  
24. Is staging performance acceptable? **NOT MEASURED**  
25. Do HTTP rate limits work? **NOT HTTP-PROVEN**  
26. Did image-tag rollback pass? **NO**  
27. Is managed PITR proven? **NO**  
28. Is provider object recovery proven? **NO**  
29. Is monitoring sufficient? **NO** (no alerting provider)  
30. Are Agents still OFF? **YES**  
31. Is attorney validation complete? **NO**  
32. Is nationwide support justified? **NO**  
33. Is NyayaGrid technically deployable for a controlled beta? **NO**  
34. Is production deployment authorized automatically? **NO**  
35. What external actions remain? **Clerk users; Inngest Cloud; hosting/TLS; PITR; S3 versioning; Redis; malware; alerting; Clerk invites**  
36. What is the largest remaining blocker? **Clerk staging credentials plus Inngest Cloud registration (`INNGEST_DEV` still on)**  
37. What is the exactly one next phase? **PHASE 6W-R2 — CLERK STAGING, INNGEST CLOUD, AND HTTP CANARY**
