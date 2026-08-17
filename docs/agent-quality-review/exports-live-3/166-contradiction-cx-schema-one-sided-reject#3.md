# cx-schema-one-sided-reject#3
- Workflow: contradiction
- Description: CX-01: schema rejects a candidate missing side B
- Provider: openai / gpt-4o-mini
- Live: yes
## Input
schema_reject
## Output
schema rejected one-sided/invalid candidate
## Cited sources
{
  "candidates": [
    {
      "title": "One sided",
      "explanation": "Missing side B",
      "sideA": {
        "chunkIds": [
          "aaaaaaaa-bbbb-4ccc-8ddd-111111111111"
        ],
        "summary": "Witness said the package went out February 28."
      }
    }
  ]
}
