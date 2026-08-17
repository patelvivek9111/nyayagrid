# golden-adv-combine-notice-and-term
- Workflow: case_qa
- Description: Adversarial: combine termination notice with lease term dates
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
- evidenceState: grounded
## Input
When does the lease expire, and how much written notice is required to terminate?
## Output
The Case documents do not fully agree on the date. Conflicting dates appear in the sources (January 1, 2024 vs December 31, 2026).

Based on the matter documents: The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12. Either party may terminate this agreement by providing thirty (30) days written notice to the other party at the notice address listed in Section 15.
## Cited sources
- chunk_lease_term: The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.
- chunk_lease_notice: Either party may terminate this agreement by providing thirty (30) days written notice to the other party at the notice address listed in Section 15.
