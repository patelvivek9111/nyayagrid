# golden-adv-combine-renewal-and-expiration
- Workflow: case_qa
- Description: Adversarial: answer requires combining renewal notice + lease expiration
- Provider: openai / gpt-4o-mini
- Live: yes
## Input
When does the lease expire, and how much notice must Tenant give to renew for an additional year?
## Output
{
  "answer": {
    "leaseExpiration": "December 31, 2026",
    "renewalNotice": "sixty (60) days written notice"
  },
  "sources": [
    {
      "chunkId": "chunk_lease_term",
      "documentId": "doc_lease",
      "documentVersionId": "docv_lease_1",
      "quote": "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12."
    },
    {
      "chunkId": "chunk_renewal_notice",
      "documentId": "doc_lease",
      "documentVersionId": "docv_lease_1",
      "quote": "Tenant may renew for one additional year by giving sixty (60) days written notice before the expiration date."
    }
  ],
  "assumptions": [],
  "unresolvedQuestions": [],
  "evidenceState": "grounded"
}
## Cited sources
(none)
