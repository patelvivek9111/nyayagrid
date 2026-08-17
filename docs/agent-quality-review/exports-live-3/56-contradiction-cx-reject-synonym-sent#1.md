# cx-reject-synonym-sent#1
- Workflow: contradiction
- Description: One-sided reject: emailed vs transmitted is a paraphrase, not an inconsistency
- Provider: openai / gpt-4o-mini
- Live: yes
## Input
Matter: SYNTH — Golden CAM date conflict
Sources:
- chunkId=eeee5555-ffff-4aaa-8bbb-141414141414 | documentId=doc_email_pm | documentVersionId=docv_email_pm_3 | page=1 | segmentRef=null | text=|I emailed the February CAM package to Tenant.|
- chunkId=ffff6666-aaaa-4bbb-8ccc-151515151515 | documentId=doc_depo | documentVersionId=docv_depo_3 | page=20 | segmentRef=null | text=|I transmitted the February CAM package to Tenant.|
## Output
{
  "candidates": []
}
## Cited sources
- eeee5555-ffff-4aaa-8bbb-141414141414: I emailed the February CAM package to Tenant.
- ffff6666-aaaa-4bbb-8ccc-151515151515: I transmitted the February CAM package to Tenant.
