# golden-adv-combine-rent-and-term
- Workflow: case_qa
- Description: Adversarial: answer requires combining rent + term chunks, not one alone
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
- evidenceState: grounded
## Input
What is the monthly base rent and when does the lease term commence?
## Output
The Case documents do not fully agree on the date. Conflicting dates appear in the sources (January 1, 2024 vs December 31, 2026).

Based on the matter documents: Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month. The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.
## Cited sources
- chunk_lease_rent: Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month.
- chunk_lease_term: The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.
