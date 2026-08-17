# cx-reject-imprecise-plus-decoy-notice
- Workflow: contradiction
- Description: One-sided reject: imprecise phrasing plus an unrelated notice clause is still not a contradiction
- Provider: mock / mock-1
- Live: NO (mock — do not score as model quality)
## Input
Matter: SYNTH — Golden CAM date conflict
Sources:
- chunkId=aaaaaaaa-bbbb-4ccc-8ddd-111111111111 | documentId=doc_depo | documentVersionId=docv_depo_1 | page=44 | segmentRef=44:12-44:20 | text=|Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.|
- chunkId=dddddddd-eeee-4fff-8aaa-444444444444 | documentId=doc_email_pm | documentVersionId=docv_email_pm_2 | page=1 | segmentRef=null | text=|I sent the February CAM package around the end of February; I do not remember the exact calendar day.|
- chunkId=bbbb2222-cccc-4ddd-8eee-888888888888 | documentId=doc_lease | documentVersionId=docv_lease_1 | page=11 | segmentRef=null | text=|Either party may terminate this agreement by providing thirty (30) days written notice.|
## Output
{
  "candidates": []
}
## Cited sources
- aaaaaaaa-bbbb-4ccc-8ddd-111111111111: Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.
- dddddddd-eeee-4fff-8aaa-444444444444: I sent the February CAM package around the end of February; I do not remember the exact calendar day.
- bbbb2222-cccc-4ddd-8eee-888888888888: Either party may terminate this agreement by providing thirty (30) days written notice.
