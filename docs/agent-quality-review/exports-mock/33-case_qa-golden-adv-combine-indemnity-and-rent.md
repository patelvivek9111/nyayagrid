# golden-adv-combine-indemnity-and-rent
- Workflow: case_qa
- Description: Adversarial: answer requires combining indemnity + rent chunks
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
- evidenceState: grounded
## Input
What is the monthly base rent, and how does the amendment change the indemnity obligation?
## Output
Based on the matter documents: Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month. Section 9 (Indemnity) is deleted in its entirety and replaced with: Tenant shall indemnify Landlord only for third-party claims arising from Tenant's negligence, and not for Landlord's sole negligence.
## Cited sources
- chunk_lease_rent: Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month.
- chunk_amend_indemnity: Section 9 (Indemnity) is deleted in its entirety and replaced with: Tenant shall indemnify Landlord only for third-party claims arising from Tenant's negligence, and not for Landlord's sole negligence.
