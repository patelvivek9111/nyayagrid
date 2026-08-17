# cx-cam-dual-sided-reversed
- Workflow: contradiction
- Description: Same genuine conflict with chunk order reversed
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
## Input
Matter: SYNTH — Golden CAM date conflict
Sources:
- chunkId=bbbbbbbb-cccc-4ddd-8eee-222222222222 | documentId=doc_email_pm | documentVersionId=docv_email_pm_1 | page=1 | segmentRef=null | text=|Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.|
- chunkId=aaaaaaaa-bbbb-4ccc-8ddd-111111111111 | documentId=doc_depo | documentVersionId=docv_depo_1 | page=44 | segmentRef=44:12-44:20 | text=|Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.|
- chunkId=bbbb2222-cccc-4ddd-8eee-888888888888 | documentId=doc_lease | documentVersionId=docv_lease_1 | page=11 | segmentRef=null | text=|Either party may terminate this agreement by providing thirty (30) days written notice.|
## Output
{
  "candidates": [
    {
      "title": "Potential conflicting statements",
      "explanation": "Mock contradiction candidate based on opposing language in two source chunks. Both sides are presented; neither is treated as the true account.",
      "confidence": "medium",
      "sideA": {
        "chunkIds": [
          "bbbbbbbb-cccc-4ddd-8eee-222222222222"
        ],
        "summary": "Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission."
      },
      "sideB": {
        "chunkIds": [
          "aaaaaaaa-bbbb-4ccc-8ddd-111111111111"
        ],
        "summary": "Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day."
      }
    }
  ]
}
## Cited sources
- bbbbbbbb-cccc-4ddd-8eee-222222222222: Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.
- aaaaaaaa-bbbb-4ccc-8ddd-111111111111: Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.
- bbbb2222-cccc-4ddd-8eee-888888888888: Either party may terminate this agreement by providing thirty (30) days written notice.
