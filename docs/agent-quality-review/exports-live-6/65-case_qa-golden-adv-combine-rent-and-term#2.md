# golden-adv-combine-rent-and-term#2
- Workflow: case_qa
- Description: Adversarial: answer requires combining rent + term chunks, not one alone
- Provider: openai / gpt-4o-mini-2024-07-18
- Live: yes
## Input
What is the monthly base rent and when does the lease term commence?
## Output
{
  "answer": "The monthly base rent is $4,000 and the lease term commences on January 1, 2024.",
  "sources": [
    {
      "chunkId": "chunk_lease_rent",
      "quote": "Tenant shall pay Base Rent of forty-eight thousand dollars ($48,000) per year, payable in equal monthly installments of four thousand dollars ($4,000) on the first business day of each month."
    },
    {
      "chunkId": "chunk_lease_term",
      "quote": "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12."
    }
  ],
  "assumptions": [],
  "unresolvedQuestions": [],
  "evidenceState": "grounded"
}
## Cited sources
(none)
