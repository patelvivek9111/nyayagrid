# golden-adv-combine-renewal-and-expiration#1
- Workflow: case_qa
- Description: Adversarial: answer requires combining renewal notice + lease expiration
- Provider: openai / gpt-4o-mini-2024-07-18
- Live: yes
## Input
When does the lease expire, and how much notice must Tenant give to renew for an additional year?
## Output
{
  "answer": "The lease expires on December 31, 2026, and Tenant must give sixty (60) days written notice to renew for an additional year.",
  "sources": [
    {
      "chunkId": "chunk_lease_term",
      "quote": "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12."
    },
    {
      "chunkId": "chunk_renewal_notice",
      "quote": "Tenant may renew for one additional year by giving sixty (60) days written notice before the expiration date."
    }
  ],
  "assumptions": [],
  "unresolvedQuestions": [],
  "evidenceState": "grounded"
}
## Cited sources
(none)
