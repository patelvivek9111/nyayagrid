# golden-adv-combine-notice-and-term#1
- Workflow: case_qa
- Description: Adversarial: combine termination notice with lease term dates
- Provider: openai / gpt-4o-mini-2024-07-18
- Live: yes
## Input
When does the lease expire, and how much written notice is required to terminate?
## Output
{
  "answer": "The lease expires on December 31, 2026, and thirty (30) days written notice is required to terminate.",
  "sources": [
    {
      "chunkId": "chunk_lease_term",
      "quote": "The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12."
    },
    {
      "chunkId": "chunk_lease_notice",
      "quote": "Either party may terminate this agreement by providing thirty (30) days written notice to the other party at the notice address listed in Section 15."
    }
  ],
  "assumptions": [],
  "unresolvedQuestions": [],
  "evidenceState": "grounded"
}
## Cited sources
(none)
