# cx-schema-empty-side-chunks#2
- Workflow: contradiction
- Description: CX-01: schema rejects empty chunkIds on a side
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
      "title": "Empty side",
      "explanation": "Side B has no chunks",
      "sideA": {
        "chunkIds": [
          "aaaaaaaa-bbbb-4ccc-8ddd-111111111111"
        ],
        "summary": "February 28 send."
      },
      "sideB": {
        "chunkIds": [],
        "summary": "Unsourced contrary claim."
      }
    }
  ]
}
