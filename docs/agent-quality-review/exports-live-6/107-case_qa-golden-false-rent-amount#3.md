# golden-false-rent-amount#3
- Workflow: case_qa
- Description: Refuse a rent figure that is not in the sources
- Provider: openai / gpt-4o-mini-2024-07-18
- Live: yes
## Input
Is the monthly base rent seven thousand dollars?
## Output
{
  "answer": "No, the monthly base rent is not seven thousand dollars.",
  "sources": [
    {
      "chunkId": "chunk_lease_term",
      "documentId": "doc_lease",
      "documentVersionId": "docv_lease_1",
      "quote=\"The lease term commences on January 1, 2024 and expires on December 31, 2026, unless earlier terminated in accordance with Section 12.\"}],": [],
      "unresolvedQuestions": [],
      "evidenceState": "insufficient"
    }
  ]
}
## Cited sources
(none)
