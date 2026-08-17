# Agent output export
Live provider=openai model=gpt-4o-mini-2024-07-18
Exported: 2026-08-15T02:44:40.328Z
Items: 114
=== Live run config (copy into AGENT_QUALITY_TRACKER.md) ===
prompt.case_qa=nyaya-matter-qa-v5
prompt.contradiction=contradiction-analysis-v2
model.requested=gpt-4o-mini
model.resolved=gpt-4o-mini-2024-07-18
system_fingerprint=fp_6ec6bfb92d
rerank=off
temperature=0

Each file is one output. Blind-review against the rubric in docs/AGENT_QUALITY_ATTORNEY_REVIEW.md.
- [01-case_qa-golden-lease-commencement#1.md](./01-case_qa-golden-lease-commencement#1.md) — Direct lease-term fact — grounded + cite term chunk
- [02-case_qa-golden-lease-expiration#1.md](./02-case_qa-golden-lease-expiration#1.md) — Expiration date from the same term chunk
- [03-case_qa-golden-rent-amount#1.md](./03-case_qa-golden-rent-amount#1.md) — Base rent amount from lease — grounded
- [04-case_qa-golden-rent-annual#1.md](./04-case_qa-golden-rent-annual#1.md) — Annual base rent from the rent chunk
- [05-case_qa-golden-notice-period#1.md](./05-case_qa-golden-notice-period#1.md) — Termination notice period — grounded
- [06-case_qa-golden-notice-section#1.md](./06-case_qa-golden-notice-section#1.md) — Notice address is in Section 15 — do not invent a street
- [07-case_qa-golden-indemnity-missing-amendment#1.md](./07-case_qa-golden-indemnity-missing-amendment#1.md) — Indemnity question with only lease retrieval — should be insufficient and need more docs
- [08-case_qa-golden-indemnity-with-amendment#1.md](./08-case_qa-golden-indemnity-with-amendment#1.md) — Indemnity with amendment in retrieval — grounded
- [09-case_qa-golden-unrelated-capital#1.md](./09-case_qa-golden-unrelated-capital#1.md) — Unrelated question must not invent from training data
- [10-case_qa-golden-empty-retrieval#1.md](./10-case_qa-golden-empty-retrieval#1.md) — No passages — insufficient + need more documents
- [11-case_qa-golden-cam-date-conflict#1.md](./11-case_qa-golden-cam-date-conflict#1.md) — Issue-spotting: multi-hop CAM send-date conflict across deposition + PM email — surface both dates
- [12-case_qa-golden-cam-date-conflict-incomplete#1.md](./12-case_qa-golden-cam-date-conflict-incomplete#1.md) — Issue-spotting: only deposition retrieved — must not invent the conflicting March 3 email date
- [13-case_qa-golden-dispute-date#1.md](./13-case_qa-golden-dispute-date#1.md) — Tenant dispute date from counsel email
- [14-case_qa-golden-invoice-request#1.md](./14-case_qa-golden-invoice-request#1.md) — Supporting invoices requested within ten business days
- [15-case_qa-golden-depo-receipt-same-day#1.md](./15-case_qa-golden-depo-receipt-same-day#1.md) — Depo claims Tenant confirmed receipt the same day
- [16-case_qa-golden-portal-upload-date#1.md](./16-case_qa-golden-portal-upload-date#1.md) — PM email places the upload on March 3
- [17-case_qa-golden-late-fee#1.md](./17-case_qa-golden-late-fee#1.md) — Delinquency charge is not base rent
- [18-case_qa-golden-renewal-notice#1.md](./18-case_qa-golden-renewal-notice#1.md) — Renewal notice is 60 days — not the 30-day termination period
- [19-case_qa-golden-cam-estimate-not-transmittal#1.md](./19-case_qa-golden-cam-estimate-not-transmittal#1.md) — Internal worksheet date is not a send date
- [20-case_qa-golden-partial-hedge-indemnity#1.md](./20-case_qa-golden-partial-hedge-indemnity#1.md) — QA-05: model hedges (insufficient) with valid cites → partial
- [21-case_qa-golden-partial-hedge-term#1.md](./21-case_qa-golden-partial-hedge-term#1.md) — QA-05: hedge language with a real term cite → partial
- [22-case_qa-golden-qa06-intel-no-docs#1.md](./22-case_qa-golden-qa06-intel-no-docs#1.md) — QA-06: verified intel without document cites must cap at partial
- [23-case_qa-golden-qa06-graph-no-docs#1.md](./23-case_qa-golden-qa06-graph-no-docs#1.md) — QA-06: verified graph without document cites must cap at partial
- [24-case_qa-golden-qa06-memory-no-docs#1.md](./24-case_qa-golden-qa06-memory-no-docs#1.md) — QA-06: approved memory without document cites must cap at partial
- [25-case_qa-golden-adv-near-miss-commencement#1.md](./25-case_qa-golden-adv-near-miss-commencement#1.md) — Adversarial: near-miss date January 15 must not be confirmed
- [26-case_qa-golden-adv-similar-clause-rent-vs-late-fee#1.md](./26-case_qa-golden-adv-similar-clause-rent-vs-late-fee#1.md) — Adversarial: similarly worded delinquency clause is not monthly base rent
- [27-case_qa-golden-adv-combine-rent-and-term#1.md](./27-case_qa-golden-adv-combine-rent-and-term#1.md) — Adversarial: answer requires combining rent + term chunks, not one alone
- [28-case_qa-golden-adv-notice-vs-renewal#1.md](./28-case_qa-golden-adv-notice-vs-renewal#1.md) — Adversarial: 30-day termination vs 60-day renewal — do not swap
- [29-case_qa-golden-adv-near-miss-cam-worksheet#1.md](./29-case_qa-golden-adv-near-miss-cam-worksheet#1.md) — Adversarial: internal February 15 worksheet is not the send date
- [30-case_qa-golden-adv-combine-notice-and-term#1.md](./30-case_qa-golden-adv-combine-notice-and-term#1.md) — Adversarial: combine termination notice with lease term dates
- [31-case_qa-golden-false-rent-amount#1.md](./31-case_qa-golden-false-rent-amount#1.md) — Refuse a rent figure that is not in the sources
- [32-case_qa-golden-judge-not-in-record#1.md](./32-case_qa-golden-judge-not-in-record#1.md) — Must not invent a judge or docket from training data
- [33-case_qa-golden-adv-combine-indemnity-and-rent#1.md](./33-case_qa-golden-adv-combine-indemnity-and-rent#1.md) — Adversarial: answer requires combining indemnity + rent chunks
- [34-case_qa-golden-adv-combine-dispute-and-late-fee#1.md](./34-case_qa-golden-adv-combine-dispute-and-late-fee#1.md) — Adversarial: answer requires combining dispute-date + late-fee chunks
- [35-case_qa-golden-adv-combine-renewal-and-expiration#1.md](./35-case_qa-golden-adv-combine-renewal-and-expiration#1.md) — Adversarial: answer requires combining renewal notice + lease expiration
- [36-case_qa-golden-adv-near-miss-proposed-commencement#1.md](./36-case_qa-golden-adv-near-miss-proposed-commencement#1.md) — Adversarial: unsigned January 15 move-in hold is in retrieval but is not the executed commencement
- [37-case_qa-golden-adv-near-miss-term-sheet-rent#1.md](./37-case_qa-golden-adv-near-miss-term-sheet-rent#1.md) — Adversarial: unsigned $5,000 term-sheet figure is in retrieval but is not executed Base Rent
- [38-case_qa-golden-adv-near-miss-ninety-day-draft#1.md](./38-case_qa-golden-adv-near-miss-ninety-day-draft#1.md) — Adversarial: unexecuted 90-day draft period is in retrieval but is not the termination notice
- [39-case_qa-golden-lease-commencement#2.md](./39-case_qa-golden-lease-commencement#2.md) — Direct lease-term fact — grounded + cite term chunk
- [40-case_qa-golden-lease-expiration#2.md](./40-case_qa-golden-lease-expiration#2.md) — Expiration date from the same term chunk
- [41-case_qa-golden-rent-amount#2.md](./41-case_qa-golden-rent-amount#2.md) — Base rent amount from lease — grounded
- [42-case_qa-golden-rent-annual#2.md](./42-case_qa-golden-rent-annual#2.md) — Annual base rent from the rent chunk
- [43-case_qa-golden-notice-period#2.md](./43-case_qa-golden-notice-period#2.md) — Termination notice period — grounded
- [44-case_qa-golden-notice-section#2.md](./44-case_qa-golden-notice-section#2.md) — Notice address is in Section 15 — do not invent a street
- [45-case_qa-golden-indemnity-missing-amendment#2.md](./45-case_qa-golden-indemnity-missing-amendment#2.md) — Indemnity question with only lease retrieval — should be insufficient and need more docs
- [46-case_qa-golden-indemnity-with-amendment#2.md](./46-case_qa-golden-indemnity-with-amendment#2.md) — Indemnity with amendment in retrieval — grounded
- [47-case_qa-golden-unrelated-capital#2.md](./47-case_qa-golden-unrelated-capital#2.md) — Unrelated question must not invent from training data
- [48-case_qa-golden-empty-retrieval#2.md](./48-case_qa-golden-empty-retrieval#2.md) — No passages — insufficient + need more documents
- [49-case_qa-golden-cam-date-conflict#2.md](./49-case_qa-golden-cam-date-conflict#2.md) — Issue-spotting: multi-hop CAM send-date conflict across deposition + PM email — surface both dates
- [50-case_qa-golden-cam-date-conflict-incomplete#2.md](./50-case_qa-golden-cam-date-conflict-incomplete#2.md) — Issue-spotting: only deposition retrieved — must not invent the conflicting March 3 email date
- [51-case_qa-golden-dispute-date#2.md](./51-case_qa-golden-dispute-date#2.md) — Tenant dispute date from counsel email
- [52-case_qa-golden-invoice-request#2.md](./52-case_qa-golden-invoice-request#2.md) — Supporting invoices requested within ten business days
- [53-case_qa-golden-depo-receipt-same-day#2.md](./53-case_qa-golden-depo-receipt-same-day#2.md) — Depo claims Tenant confirmed receipt the same day
- [54-case_qa-golden-portal-upload-date#2.md](./54-case_qa-golden-portal-upload-date#2.md) — PM email places the upload on March 3
- [55-case_qa-golden-late-fee#2.md](./55-case_qa-golden-late-fee#2.md) — Delinquency charge is not base rent
- [56-case_qa-golden-renewal-notice#2.md](./56-case_qa-golden-renewal-notice#2.md) — Renewal notice is 60 days — not the 30-day termination period
- [57-case_qa-golden-cam-estimate-not-transmittal#2.md](./57-case_qa-golden-cam-estimate-not-transmittal#2.md) — Internal worksheet date is not a send date
- [58-case_qa-golden-partial-hedge-indemnity#2.md](./58-case_qa-golden-partial-hedge-indemnity#2.md) — QA-05: model hedges (insufficient) with valid cites → partial
- [59-case_qa-golden-partial-hedge-term#2.md](./59-case_qa-golden-partial-hedge-term#2.md) — QA-05: hedge language with a real term cite → partial
- [60-case_qa-golden-qa06-intel-no-docs#2.md](./60-case_qa-golden-qa06-intel-no-docs#2.md) — QA-06: verified intel without document cites must cap at partial
- [61-case_qa-golden-qa06-graph-no-docs#2.md](./61-case_qa-golden-qa06-graph-no-docs#2.md) — QA-06: verified graph without document cites must cap at partial
- [62-case_qa-golden-qa06-memory-no-docs#2.md](./62-case_qa-golden-qa06-memory-no-docs#2.md) — QA-06: approved memory without document cites must cap at partial
- [63-case_qa-golden-adv-near-miss-commencement#2.md](./63-case_qa-golden-adv-near-miss-commencement#2.md) — Adversarial: near-miss date January 15 must not be confirmed
- [64-case_qa-golden-adv-similar-clause-rent-vs-late-fee#2.md](./64-case_qa-golden-adv-similar-clause-rent-vs-late-fee#2.md) — Adversarial: similarly worded delinquency clause is not monthly base rent
- [65-case_qa-golden-adv-combine-rent-and-term#2.md](./65-case_qa-golden-adv-combine-rent-and-term#2.md) — Adversarial: answer requires combining rent + term chunks, not one alone
- [66-case_qa-golden-adv-notice-vs-renewal#2.md](./66-case_qa-golden-adv-notice-vs-renewal#2.md) — Adversarial: 30-day termination vs 60-day renewal — do not swap
- [67-case_qa-golden-adv-near-miss-cam-worksheet#2.md](./67-case_qa-golden-adv-near-miss-cam-worksheet#2.md) — Adversarial: internal February 15 worksheet is not the send date
- [68-case_qa-golden-adv-combine-notice-and-term#2.md](./68-case_qa-golden-adv-combine-notice-and-term#2.md) — Adversarial: combine termination notice with lease term dates
- [69-case_qa-golden-false-rent-amount#2.md](./69-case_qa-golden-false-rent-amount#2.md) — Refuse a rent figure that is not in the sources
- [70-case_qa-golden-judge-not-in-record#2.md](./70-case_qa-golden-judge-not-in-record#2.md) — Must not invent a judge or docket from training data
- [71-case_qa-golden-adv-combine-indemnity-and-rent#2.md](./71-case_qa-golden-adv-combine-indemnity-and-rent#2.md) — Adversarial: answer requires combining indemnity + rent chunks
- [72-case_qa-golden-adv-combine-dispute-and-late-fee#2.md](./72-case_qa-golden-adv-combine-dispute-and-late-fee#2.md) — Adversarial: answer requires combining dispute-date + late-fee chunks
- [73-case_qa-golden-adv-combine-renewal-and-expiration#2.md](./73-case_qa-golden-adv-combine-renewal-and-expiration#2.md) — Adversarial: answer requires combining renewal notice + lease expiration
- [74-case_qa-golden-adv-near-miss-proposed-commencement#2.md](./74-case_qa-golden-adv-near-miss-proposed-commencement#2.md) — Adversarial: unsigned January 15 move-in hold is in retrieval but is not the executed commencement
- [75-case_qa-golden-adv-near-miss-term-sheet-rent#2.md](./75-case_qa-golden-adv-near-miss-term-sheet-rent#2.md) — Adversarial: unsigned $5,000 term-sheet figure is in retrieval but is not executed Base Rent
- [76-case_qa-golden-adv-near-miss-ninety-day-draft#2.md](./76-case_qa-golden-adv-near-miss-ninety-day-draft#2.md) — Adversarial: unexecuted 90-day draft period is in retrieval but is not the termination notice
- [77-case_qa-golden-lease-commencement#3.md](./77-case_qa-golden-lease-commencement#3.md) — Direct lease-term fact — grounded + cite term chunk
- [78-case_qa-golden-lease-expiration#3.md](./78-case_qa-golden-lease-expiration#3.md) — Expiration date from the same term chunk
- [79-case_qa-golden-rent-amount#3.md](./79-case_qa-golden-rent-amount#3.md) — Base rent amount from lease — grounded
- [80-case_qa-golden-rent-annual#3.md](./80-case_qa-golden-rent-annual#3.md) — Annual base rent from the rent chunk
- [81-case_qa-golden-notice-period#3.md](./81-case_qa-golden-notice-period#3.md) — Termination notice period — grounded
- [82-case_qa-golden-notice-section#3.md](./82-case_qa-golden-notice-section#3.md) — Notice address is in Section 15 — do not invent a street
- [83-case_qa-golden-indemnity-missing-amendment#3.md](./83-case_qa-golden-indemnity-missing-amendment#3.md) — Indemnity question with only lease retrieval — should be insufficient and need more docs
- [84-case_qa-golden-indemnity-with-amendment#3.md](./84-case_qa-golden-indemnity-with-amendment#3.md) — Indemnity with amendment in retrieval — grounded
- [85-case_qa-golden-unrelated-capital#3.md](./85-case_qa-golden-unrelated-capital#3.md) — Unrelated question must not invent from training data
- [86-case_qa-golden-empty-retrieval#3.md](./86-case_qa-golden-empty-retrieval#3.md) — No passages — insufficient + need more documents
- [87-case_qa-golden-cam-date-conflict#3.md](./87-case_qa-golden-cam-date-conflict#3.md) — Issue-spotting: multi-hop CAM send-date conflict across deposition + PM email — surface both dates
- [88-case_qa-golden-cam-date-conflict-incomplete#3.md](./88-case_qa-golden-cam-date-conflict-incomplete#3.md) — Issue-spotting: only deposition retrieved — must not invent the conflicting March 3 email date
- [89-case_qa-golden-dispute-date#3.md](./89-case_qa-golden-dispute-date#3.md) — Tenant dispute date from counsel email
- [90-case_qa-golden-invoice-request#3.md](./90-case_qa-golden-invoice-request#3.md) — Supporting invoices requested within ten business days
- [91-case_qa-golden-depo-receipt-same-day#3.md](./91-case_qa-golden-depo-receipt-same-day#3.md) — Depo claims Tenant confirmed receipt the same day
- [92-case_qa-golden-portal-upload-date#3.md](./92-case_qa-golden-portal-upload-date#3.md) — PM email places the upload on March 3
- [93-case_qa-golden-late-fee#3.md](./93-case_qa-golden-late-fee#3.md) — Delinquency charge is not base rent
- [94-case_qa-golden-renewal-notice#3.md](./94-case_qa-golden-renewal-notice#3.md) — Renewal notice is 60 days — not the 30-day termination period
- [95-case_qa-golden-cam-estimate-not-transmittal#3.md](./95-case_qa-golden-cam-estimate-not-transmittal#3.md) — Internal worksheet date is not a send date
- [96-case_qa-golden-partial-hedge-indemnity#3.md](./96-case_qa-golden-partial-hedge-indemnity#3.md) — QA-05: model hedges (insufficient) with valid cites → partial
- [97-case_qa-golden-partial-hedge-term#3.md](./97-case_qa-golden-partial-hedge-term#3.md) — QA-05: hedge language with a real term cite → partial
- [98-case_qa-golden-qa06-intel-no-docs#3.md](./98-case_qa-golden-qa06-intel-no-docs#3.md) — QA-06: verified intel without document cites must cap at partial
- [99-case_qa-golden-qa06-graph-no-docs#3.md](./99-case_qa-golden-qa06-graph-no-docs#3.md) — QA-06: verified graph without document cites must cap at partial
- [100-case_qa-golden-qa06-memory-no-docs#3.md](./100-case_qa-golden-qa06-memory-no-docs#3.md) — QA-06: approved memory without document cites must cap at partial
- [101-case_qa-golden-adv-near-miss-commencement#3.md](./101-case_qa-golden-adv-near-miss-commencement#3.md) — Adversarial: near-miss date January 15 must not be confirmed
- [102-case_qa-golden-adv-similar-clause-rent-vs-late-fee#3.md](./102-case_qa-golden-adv-similar-clause-rent-vs-late-fee#3.md) — Adversarial: similarly worded delinquency clause is not monthly base rent
- [103-case_qa-golden-adv-combine-rent-and-term#3.md](./103-case_qa-golden-adv-combine-rent-and-term#3.md) — Adversarial: answer requires combining rent + term chunks, not one alone
- [104-case_qa-golden-adv-notice-vs-renewal#3.md](./104-case_qa-golden-adv-notice-vs-renewal#3.md) — Adversarial: 30-day termination vs 60-day renewal — do not swap
- [105-case_qa-golden-adv-near-miss-cam-worksheet#3.md](./105-case_qa-golden-adv-near-miss-cam-worksheet#3.md) — Adversarial: internal February 15 worksheet is not the send date
- [106-case_qa-golden-adv-combine-notice-and-term#3.md](./106-case_qa-golden-adv-combine-notice-and-term#3.md) — Adversarial: combine termination notice with lease term dates
- [107-case_qa-golden-false-rent-amount#3.md](./107-case_qa-golden-false-rent-amount#3.md) — Refuse a rent figure that is not in the sources
- [108-case_qa-golden-judge-not-in-record#3.md](./108-case_qa-golden-judge-not-in-record#3.md) — Must not invent a judge or docket from training data
- [109-case_qa-golden-adv-combine-indemnity-and-rent#3.md](./109-case_qa-golden-adv-combine-indemnity-and-rent#3.md) — Adversarial: answer requires combining indemnity + rent chunks
- [110-case_qa-golden-adv-combine-dispute-and-late-fee#3.md](./110-case_qa-golden-adv-combine-dispute-and-late-fee#3.md) — Adversarial: answer requires combining dispute-date + late-fee chunks
- [111-case_qa-golden-adv-combine-renewal-and-expiration#3.md](./111-case_qa-golden-adv-combine-renewal-and-expiration#3.md) — Adversarial: answer requires combining renewal notice + lease expiration
- [112-case_qa-golden-adv-near-miss-proposed-commencement#3.md](./112-case_qa-golden-adv-near-miss-proposed-commencement#3.md) — Adversarial: unsigned January 15 move-in hold is in retrieval but is not the executed commencement
- [113-case_qa-golden-adv-near-miss-term-sheet-rent#3.md](./113-case_qa-golden-adv-near-miss-term-sheet-rent#3.md) — Adversarial: unsigned $5,000 term-sheet figure is in retrieval but is not executed Base Rent
- [114-case_qa-golden-adv-near-miss-ninety-day-draft#3.md](./114-case_qa-golden-adv-near-miss-ninety-day-draft#3.md) — Adversarial: unexecuted 90-day draft period is in retrieval but is not the termination notice
