# cx-adv-imprecise-phrasing
- Workflow: contradiction
- Description: Adversarial: imprecise phrasing vs exact date must be rejected (not a real conflict)
- Provider: openai / gpt-4o-mini
- Live: yes
## Input
Matter: SYNTH — Golden CAM date conflict
Sources:
- chunkId=aaaaaaaa-bbbb-4ccc-8ddd-111111111111 | documentId=doc_depo | documentVersionId=docv_depo_1 | page=44 | segmentRef=44:12-44:20 | text=|Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.|
- chunkId=dddddddd-eeee-4fff-8aaa-444444444444 | documentId=doc_email_pm | documentVersionId=docv_email_pm_2 | page=1 | segmentRef=null | text=|I sent the February CAM package around the end of February; I do not remember the exact calendar day.|
## Output
{
  "candidates": [
    {
      "title": "Date of February CAM Package Sending",
      "explanation": "There is a conflict regarding the exact date the February CAM package was sent. One source states it was sent on February 28, 2025, while the other source indicates it was sent around the end of February without specifying the exact date.",
      "confidence": 0.9,
      "sideA": {
        "chunkIds": [
          "aaaaaaaa-bbbb-4ccc-8ddd-111111111111"
        ],
        "summary": "The package was emailed on February 28, 2025, and confirmed received the same day."
      },
      "sideB": {
        "chunkIds": [
          "dddddddd-eeee-4fff-8aaa-444444444444"
        ],
        "summary": "The package was sent around the end of February, but the exact date is not remembered."
      }
    }
  ]
}
## Cited sources
- aaaaaaaa-bbbb-4ccc-8ddd-111111111111: Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.
- dddddddd-eeee-4fff-8aaa-444444444444: I sent the February CAM package around the end of February; I do not remember the exact calendar day.
