# golden-adv-combine-rent-and-term
- Workflow: case_qa
- Description: Adversarial: answer requires combining rent + term chunks, not one alone
- Provider: openai / gpt-4o-mini
- Live: yes
## Input
What is the monthly base rent and when does the lease term commence?
## Output
{
  "answer": {
    "monthlyBaseRent": "$4,000",
    "leaseTermCommencement": "January 1, 2024"
  },
  "sources": [
    {
      "chunkId": "chunk_lease_term",
      "documentId": "doc_lease",
      "documentVersionId": "docv_lease_1",
      "quote": "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12."
    },
    {
      "chunkId": "chunk_lease_rent",
      "documentId": "doc_lease",
      "documentVersionId": "docv_lease_1",
      "quote": "Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month."
    }
  ],
  "assumptions": [],
  "unresolvedQuestions": [],
  "evidenceState": "grounded"
}
## Cited sources
(none)
