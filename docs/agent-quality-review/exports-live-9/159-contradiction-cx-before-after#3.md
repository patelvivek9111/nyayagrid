# cx-before-after#3
- Workflow: contradiction
- Description: Genuine before/after conflict on completion vs inspection
- Provider: openai / gpt-4o-mini-2024-07-18
- Live: yes
## Input
Matter: SYNTH — Golden CAM date conflict
Sources:
- chunkId=ffffffff-aaaa-4bbb-8ccc-666666666666 | documentId=doc_depo | documentVersionId=docv_depo_2 | page=12 | segmentRef=null | text=|A: Yes, I confirmed the work was completed before the inspection.|
- chunkId=aaaa1111-bbbb-4ccc-8ddd-777777777777 | documentId=doc_email | documentVersionId=docv_email_3 | page=1 | segmentRef=null | text=|The work was never completed; it was still unfinished after the inspection.|
- chunkId=bbbb2222-cccc-4ddd-8eee-888888888888 | documentId=doc_lease | documentVersionId=docv_lease_1 | page=11 | segmentRef=null | text=|Either party may terminate this agreement by providing thirty (30) days written notice.|
## Output
{
  "candidates": [
    {
      "title": "Conflict on Work Completion Status",
      "explanation": "One source states that the work was completed before the inspection, while another source claims that the work was still unfinished after the inspection.",
      "confidence": "high",
      "sideA": {
        "chunkIds": [
          "ffffffff-aaaa-4bbb-8ccc-666666666666"
        ],
        "summary": "The work was confirmed to be completed before the inspection."
      },
      "sideB": {
        "chunkIds": [
          "aaaa1111-bbbb-4ccc-8ddd-777777777777"
        ],
        "summary": "The work was never completed and was still unfinished after the inspection."
      }
    }
  ]
}
## Cited sources
- ffffffff-aaaa-4bbb-8ccc-666666666666: A: Yes, I confirmed the work was completed before the inspection.
- aaaa1111-bbbb-4ccc-8ddd-777777777777: The work was never completed; it was still unfinished after the inspection.
- bbbb2222-cccc-4ddd-8eee-888888888888: Either party may terminate this agreement by providing thirty (30) days written notice.
