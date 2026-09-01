# BASELINE 6W ITER1

One remediation iteration. Highest-impact operational gaps that could be fixed in-repo:

1. Bounded OpenAI HTTP retries (429 + Retry-After, transient 5xx, no infinite retry, AbortSignal).
2. Database pool close (`closeDb`) and frozen-regression harness so benches cannot stack or overwrite historical baselines.
3. Client-facing 500s no longer include raw `Error.message` (connection strings, etc.).

External Clerk / Inngest Cloud / managed PITR were not invented as PASS.
