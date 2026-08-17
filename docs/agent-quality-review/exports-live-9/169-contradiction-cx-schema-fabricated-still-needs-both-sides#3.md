# cx-schema-fabricated-still-needs-both-sides#3
- Workflow: contradiction
- Description: CX-02: fabricated id does not excuse a missing side
- Provider: openai / gpt-4o-mini-2024-07-18
- Live: yes
## Input
schema_reject
## Output
schema rejected one-sided/invalid candidate
## Cited sources
{
  "candidates": [
    {
      "title": "Fabricated side",
      "explanation": "One side cites a made-up chunk and the other side is omitted.",
      "sideA": {
        "chunkIds": [
          "99999999-9999-4999-8999-999999999999"
        ],
        "summary": "Invented statement."
      }
    }
  ]
}
