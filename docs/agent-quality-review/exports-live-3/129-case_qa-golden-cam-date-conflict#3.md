# golden-cam-date-conflict#3
- Workflow: case_qa
- Description: Issue-spotting: multi-hop CAM send-date conflict across deposition + PM email — surface both dates
- Provider: openai / gpt-4o-mini
- Live: yes
- evidenceState: grounded
## Input
When was the February CAM package sent, and do the Case documents agree?
## Output
The February CAM package was sent on February 28, 2025, according to the deposition document, but it was uploaded to the portal on March 3, 2025, as per the email receipt document. The documents do not fully agree on the timing of the transmission.
## Cited sources
- chunk_depo_cam: Q: When did you send the February CAM package? A: I emailed the package on February 28, 2025, and Tenant confirmed receipt the same day.
- chunk_email_receipt: Following up - the February CAM package was uploaded to the portal on March 3, 2025; I do not see an earlier transmission.
