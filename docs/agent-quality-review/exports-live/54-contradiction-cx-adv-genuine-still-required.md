# cx-adv-genuine-still-required
- Workflow: contradiction
- Description: Adversarial: a real dual-sided date conflict must still be surfaced
- Provider: openai / gpt-4o-mini
- Live: yes
## Input
Matter: SYNTH — Golden CAM date conflict
Sources:
- chunkId=aaaaaaaa-bbbb-4ccc-8ddd-111111111111 | documentId=doc_depo | documentVersionId=docv_depo_1 | page=44 | segmentRef=44:12-44:20 | text=|Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.|
- chunkId=bbbbbbbb-cccc-4ddd-8eee-222222222222 | documentId=doc_email_pm | documentVersionId=docv_email_pm_1 | page=1 | segmentRef=null | text=|Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.|
## Output
{
  "candidates": [
    {
      "title": "Conflict in February CAM Package Transmission Dates",
      "explanation": "There is a contradiction regarding the date the February CAM package was sent. One source states it was emailed on February 28, 2025, while another source indicates it was uploaded to the portal on March 3, 2025, with no earlier transmission noted.",
      "confidence": 0.9,
      "sideA": {
        "chunkIds": [
          "aaaaaaaa-bbbb-4ccc-8ddd-111111111111"
        ],
        "summary": "The February CAM package was emailed on February 28, 2025, and confirmed received the same day."
      },
      "sideB": {
        "chunkIds": [
          "bbbbbbbb-cccc-4ddd-8eee-222222222222"
        ],
        "summary": "The February CAM package was uploaded to the portal on March 3, 2025, with no earlier transmission."
      }
    }
  ]
}
## Cited sources
- aaaaaaaa-bbbb-4ccc-8ddd-111111111111: Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.
- bbbbbbbb-cccc-4ddd-8eee-222222222222: Following up — the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.
