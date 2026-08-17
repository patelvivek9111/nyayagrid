# golden-adv-combine-dispute-and-late-fee
- Workflow: case_qa
- Description: Adversarial: answer requires combining dispute-date + late-fee chunks
- Provider: openai / gpt-4o-mini
- Live: yes
## Input
When did Tenant dispute the February CAM reconciliation, and what delinquency charge applies if payment is overdue?
## Output
{
  "answer": {
    "disputeDate": "March 14, 2025",
    "delinquencyCharge": "$500"
  },
  "sources": [
    {
      "chunkId": "chunk_email_dispute",
      "documentId": "doc_email",
      "documentVersionId": "docv_email_1",
      "quote": "On March 14, 2025, Tenant disputed the February CAM reconciliation and requested supporting invoices within ten business days."
    },
    {
      "chunkId": "chunk_late_fee",
      "documentId": "doc_lease",
      "documentVersionId": "docv_lease_1",
      "quote": "A delinquency charge of five hundred dollars ($500) applies if payment is more than five days overdue."
    }
  ],
  "assumptions": [],
  "unresolvedQuestions": [],
  "evidenceState": "grounded"
}
## Cited sources
(none)
