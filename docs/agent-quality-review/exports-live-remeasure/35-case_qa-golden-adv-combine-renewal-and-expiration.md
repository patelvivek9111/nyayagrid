# golden-adv-combine-renewal-and-expiration
- Workflow: case_qa
- Description: Adversarial: answer requires combining renewal notice + lease expiration
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
- evidenceState: grounded
## Input
When does the lease expire, and how much notice must Tenant give to renew for an additional year?
## Output
The Case documents do not fully agree on the date. Conflicting dates appear in the sources (January 1, 2024 vs December 31, 2026).

Based on the matter documents: Tenant may renew for one additional year by giving sixty (60) days written notice before the expiration date. The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.
## Cited sources
- chunk_renewal_notice: Tenant may renew for one additional year by giving sixty (60) days written notice before the expiration date.
- chunk_lease_term: The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.
