# cx-schema-dual-accept
- Workflow: contradiction
- Description: CX-01: dual-sided candidate with valid UUIDs is accepted
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
## Input
schema_accept
## Output
dual-sided schema accepted
## Cited sources
{
  "candidates": [
    {
      "title": "Date conflict",
      "explanation": "Sources disagree on the send date; both sides are presented without picking a winner.",
      "sideA": {
        "chunkIds": [
          "aaaaaaaa-bbbb-4ccc-8ddd-111111111111"
        ],
        "summary": "Depo places send on February 28, 2025."
      },
      "sideB": {
        "chunkIds": [
          "bbbbbbbb-cccc-4ddd-8eee-222222222222"
        ],
        "summary": "Email places upload on March 3, 2025."
      }
    }
  ]
}
