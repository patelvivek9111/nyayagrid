# cx-schema-one-sided-reject
- Workflow: contradiction
- Description: CX-01: schema rejects a candidate missing side B
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
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
