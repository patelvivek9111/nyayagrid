# cx-one-sided-generate
- Workflow: contradiction
- Description: CX-01/CX-02: one chunk only — must not emit a candidate
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
## Input
Matter: SYNTH — Golden CAM date conflict
Sources:
- chunkId=aaaaaaaa-bbbb-4ccc-8ddd-111111111111 | documentId=doc_depo | documentVersionId=docv_depo_1 | page=44 | segmentRef=44:12-44:20 | text=|Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.|
## Output
{
  "candidates": []
}
## Cited sources
- aaaaaaaa-bbbb-4ccc-8ddd-111111111111: Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.
