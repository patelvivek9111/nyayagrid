# cx-reject-rounding-percent#3
- Workflow: contradiction
- Description: One-sided reject: 12.0% vs about 12 percent is a rounding difference, not a contradiction
- Provider: openai / gpt-4o-mini
- Live: yes
## Input
Matter: SYNTH — Golden CAM date conflict
Sources:
- chunkId=cccc3333-dddd-4eee-8fff-121212121212 | documentId=doc_lease | documentVersionId=docv_lease_2 | page=4 | segmentRef=null | text=|The shared-cost allocation is twelve percent (12.0%).|
- chunkId=dddd4444-eeee-4fff-8aaa-131313131313 | documentId=doc_email | documentVersionId=docv_email_4 | page=1 | segmentRef=null | text=|The shared-cost allocation is about 12 percent.|
## Output
{
  "candidates": []
}
## Cited sources
- cccc3333-dddd-4eee-8fff-121212121212: The shared-cost allocation is twelve percent (12.0%).
- dddd4444-eeee-4fff-8aaa-131313131313: The shared-cost allocation is about 12 percent.
