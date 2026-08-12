# NyayaGrid Product and Technical Specification

## 1. Executive Summary

NyayaGrid is an AI-native legal operating system designed to combine two capabilities in one platform:

1. **Legal intelligence**: answer legal questions, research authority, explain legal concepts, review documents, and draft legal work.
2. **Legal operations**: manage clients, matters, documents, evidence, timelines, tasks, deadlines, research, drafts, communications, and collaboration from start to finish.

The first release serves four audiences:

- Law firms
- Solo lawyers
- Law students
- Public users

The product must not behave like a generic chatbot. The professional experience revolves around a persistent, structured Matter that becomes the system of record for all legal work. The student experience revolves around interactive legal learning and uploaded cases. The public experience revolves around safe legal information, document understanding, issue organization, and preparation for speaking with a lawyer.

### 1.1 NyayaGrid Product System

NyayaGrid is one integrated platform hosted under `NyayaGrid.com`. The branded capabilities below live inside the platform and share the same accounts, permissions, data, design system, APIs, and infrastructure. They are not separate domains or independent codebases.

| Module              | Role inside NyayaGrid                                                                                                       | Primary users                                                 |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Nyaya**           | Conversational legal intelligence and AI orchestration layer                                                                | Professionals, students, public                               |
| **Nyaya Graph**     | Legal knowledge graph connecting people, organizations, documents, evidence, facts, events, authorities, claims, and issues | Professionals; underlying platform service                    |
| **Nyaya Memory**    | Persistent, structured, user-reviewable matter intelligence                                                                 | Professionals; underlying platform service                    |
| **Nyaya Timeline**  | Source-linked chronology generated from matter materials and user entries                                                   | Professionals; public timeline builder uses a restricted form |
| **Nyaya Research**  | Source-grounded legal research and authority analysis                                                                       | Professionals; limited educational research for students      |
| **Nyaya Draft**     | Drafting, editing, reviewing, comparing, and citing legal documents                                                         | Professionals                                                 |
| **Nyaya Professor** | Interactive law-student learning, legal concept explanation, and case analysis                                              | Law students                                                  |
| **Nyaya Guide**     | Plain-language legal information, document explanation, timeline organization, and lawyer-preparation tools                 | Public users                                                  |

The module names describe experiences and capabilities, not isolated applications. For example, a lawyer asking Nyaya a matter question may invoke Nyaya Memory, Nyaya Graph, Nyaya Timeline, and Nyaya Research behind the scenes and receive one unified answer.

### 1.2 Domain and Routing Strategy

Use one primary domain and one application initially. Suggested routes:

- `nyayagrid.com/app` — authenticated professional application entry
- `nyayagrid.com/research` — Nyaya Research entry or marketing surface
- `nyayagrid.com/draft` — Nyaya Draft entry or marketing surface
- `nyayagrid.com/professor` — Nyaya Professor
- `nyayagrid.com/guide` — Nyaya Guide

Inside authenticated professional matters, prefer contextual routes such as `/app/matters/:matterId/timeline`, `/research`, `/drafts`, and `/graph` rather than making every capability feel like a separate product.

---

## 2. Product Positioning

### 2.1 Category

AI-native legal operating system.

### 2.2 Core Promise

**Ask legal questions and manage legal work in one trusted workspace.**

### 2.3 Differentiation

NyayaGrid combines:

- Nyaya conversational legal-intelligence capabilities
- Matter and case management
- Nyaya Research with source-grounded legal authority analysis
- Document intelligence
- Nyaya Memory for persistent matter intelligence
- Nyaya Timeline and Nyaya Graph intelligence
- Role-specific experiences for professionals, students, and the public

The main differentiator is not access to a specific LLM. It is the structured legal workflow, source traceability, matter context, safety controls, and integrated product experience.

### 2.4 Product Principles

1. Matter-first, not prompt-first.
2. Source-grounded, not memory-grounded.
3. Human-controlled, not autonomously consequential.
4. Structured data plus documents, not folders alone.
5. Role-specific experiences, not one interface for everyone.
6. Security and confidentiality by default.
7. AI outputs remain reviewable and correctable.

---

## 3. User Segments

## 3.1 Law Firms

### Users

- Organization owners
- Partners
- Associates
- Of counsel
- Paralegals
- Legal assistants
- Administrative staff
- Invited clients

### Primary Goals

- Manage multiple matters and teams
- Reduce research and drafting time
- Find information across large document sets
- Maintain deadlines and assignments
- Build timelines and evidence relationships
- Reuse firm knowledge safely
- Improve consistency and reviewability

### Willingness to Pay

Highest among initial segments because the platform replaces or consolidates multiple tools and reduces professional labor time.

## 3.2 Solo Lawyers

### Primary Goals

- Run a practice without large administrative overhead
- Draft, research, organize, track, and communicate in one place
- Reduce missed deadlines and repetitive work
- Create professional client-ready work faster

### Product Approach

Use the same core professional platform with simplified setup, single-user defaults, and lower-complexity administration.

## 3.3 Law Students

### Primary Goals

- Understand legal concepts
- Upload judicial opinions
- Generate structured case briefs
- Ask follow-up questions about cases
- Compare holdings, rules, reasoning, and hypotheticals
- Save learning conversations and notes

### Excluded Features

- Flashcards
- Quiz generator
- Bar exam coach

## 3.4 Public Users

### Primary Goals

- Understand legal documents and notices
- Learn general legal processes
- Organize events, documents, and questions
- Prepare for a lawyer consultation
- Understand what kind of lawyer may be relevant

### Critical Limitation

The public workspace provides legal information and organizational assistance. It must not represent itself as a lawyer, establish an attorney-client relationship, guarantee outcomes, or imply privilege.

---

## 4. Workspace Architecture

A user may have access to one or more workspace types. Data must remain isolated by workspace and tenant.

### 4.1 Professional Workspace

For law firms and solo lawyers.

### 4.2 Student Workspace

For personal academic learning.

### 4.3 Public Workspace

For personal legal information and document understanding.

### 4.4 Shared Client Portal

A limited professional sub-experience where invited clients can:

- View selected matter information
- Upload requested documents
- Review selected tasks or dates
- Exchange messages
- Approve or sign supported documents later

The client portal is not a separate top-level target market.

---

## 5. Professional Workspace Modules

## 5.1 Home Dashboard

### Required Widgets

- Today’s deadlines
- Upcoming hearings and meetings
- Assigned tasks
- Recent matter activity
- New uploads
- Drafts requiring review
- AI-detected changes
- Unverified timeline events
- Documents requiring classification
- Time entries needing confirmation

### AI Daily Brief

The dashboard may generate a sourced summary such as:

- What changed since the last login
- What is due soon
- What requires review
- Which matters have unresolved risks

Never produce unsourced strategic claims.

## 5.2 Clients and Contacts

### Client Record

- Name
- Client type: individual or organization
- Contact information
- Related contacts
- Conflict-check fields
- Active matters
- Documents
- Notes
- Billing profile
- Communication preferences
- Custom fields

### Contact Record

- Name
- Role
- Organization
- Contact details
- Matters involved
- Relationship type
- Confidential notes

### Future-Ready Requirements

- Conflict checking
- Duplicate detection
- Contact import
- Retention controls

## 5.3 Matters

### Matter Types

Configurable examples:

- Civil litigation
- Criminal defense
- Family law
- Immigration
- Personal injury
- Real estate
- Contract dispute
- Employment
- Estate planning
- General advisory

### Matter Fields

- Matter ID
- Matter number
- Name
- Client
- Description
- Practice area
- Matter type
- Jurisdiction
- Venue
- Court
- Judge
- Opposing parties
- Opposing counsel
- Status
- Open date
- Close date
- Responsible lawyer
- Team members
- Confidentiality level
- Billing arrangement
- Tags
- Custom fields

### Matter Tabs

- Overview
- Activity
- Documents
- Evidence
- Timeline
- People
- Tasks
- Deadlines
- Calendar
- Research
- Drafts
- Communications
- Notes
- AI Insights
- Billing
- Settings

## 5.4 Documents

### Supported Inputs

- PDF
- DOCX
- TXT
- RTF
- Images
- Email files
- Audio and video later
- Scanned documents through OCR

### Document Capabilities

- Folder organization
- Tags
- Matter association
- Version history
- Full-text search
- OCR
- Preview
- Annotations
- Comments
- Access controls
- Download and export
- Duplicate detection
- Document classification
- Metadata extraction
- Citation-ready page and paragraph references

### AI Actions

- Summarize
- Explain
- Extract dates
- Extract parties
- Extract obligations
- Identify legal issues
- Compare versions
- Find contradictions
- Generate timeline events
- Add to Nyaya Memory
- Ask questions

### Chain of Custody

For evidence-related documents, preserve:

- Original file
- File hash
- Upload time
- Uploader
- Source
- Versions
- Processing events
- Access events

## 5.5 Nyaya — Legal Intelligence

### Context Modes

1. General legal research
2. Entire matter
3. Selected documents
4. Selected evidence
5. Drafting workspace
6. Contract review
7. Deposition review

### Answer Structure

Where applicable, display:

- Direct answer
- Jurisdiction
- Relevant facts used
- Authorities or source documents
- Analysis
- Uncertainties
- Suggested next questions or actions

### Required Controls

- Source viewer
- Copy with citations
- Save to matter
- Convert to note
- Convert to task
- Start draft
- Mark inaccurate
- Regenerate with narrower context

## 5.6 Nyaya Research

### Research Inputs

- Natural-language question
- Jurisdiction
- Date range
- Court level
- Practice area
- Binding versus persuasive authority
- Include or exclude secondary sources

### Research Output

- Issue summary
- Authorities list
- Rule synthesis
- Case comparison
- Key quotations with pinpoint references
- Negative treatment warnings when data is available
- Conflicting authority
- Open research gaps

### Source Requirements

NyayaGrid must use licensed or authorized legal data sources. It must not imply comprehensive coverage without the necessary data rights.

### Citation Verification

Before presenting a citation:

- Confirm the source exists
- Confirm court, date, reporter or identifier
- Confirm quoted text appears in the source
- Confirm pinpoint reference
- Confirm proposition is supported

## 5.7 Nyaya Draft

### Draft Types

- Legal memorandum
- Motion
- Brief
- Pleading
- Contract
- Demand letter
- Client letter
- Internal email
- Discovery request
- Discovery response
- Deposition outline
- Settlement term sheet

### Draft Creation Flow

1. Select matter
2. Select document type
3. Select jurisdiction and court
4. Select source materials
5. Define objective and audience
6. Generate outline
7. Generate sections
8. Validate citations
9. Human review
10. Export

### Draft Editor

- Rich-text editing
- Track changes
- Comments
- Citations panel
- Source panel
- Version history
- Compare versions
- AI rewrite commands
- Placeholder detection
- Defined-term consistency checks

## 5.8 Contract Review

### Inputs

- Contract type
- Party represented
- Preferred positions
- Clause playbook
- Risk tolerance
- Jurisdiction

### Output

- Executive summary
- Clause inventory
- Missing clauses
- Risk classification
- Nonstandard language
- Obligation table
- Dates and renewal terms
- Suggested edits
- Redline-ready language
- Questions for client

### Safety

Risk labels must be explainable and tied to a playbook, source, or rule. Avoid arbitrary numerical risk scores unless a documented scoring methodology exists.

## 5.9 Deposition Analysis

### Output

- Witness summary
- Topic index
- Key admissions
- Inconsistent statements
- Conflicts with other documents or testimony
- Evasive answers
- Important quotations with page and line
- Follow-up questions
- Potential impeachment material

Every finding must cite the transcript or related evidence.

## 5.10 Nyaya Timeline

### Sources

- Documents
- Emails
- Pleadings
- Contracts
- Testimony
- User entries
- Calendar events

### Event Fields

- Date or date range
- Precision: exact, approximate, unknown
- Timezone
- Description
- Event category
- People
- Organizations
- Documents
- Evidence
- Claims or issues
- Source references
- Confidence
- Verification state

### User Controls

- Approve
- Reject
- Edit
- Merge duplicates
- Mark disputed
- Mark privileged
- Filter
- Export

## 5.11 Nyaya Graph

### Node Types

- Person
- Organization
- Document
- Communication
- Event
- Location
- Contract
- Evidence item
- Claim
- Defense
- Legal issue

### Edge Types

- Sent
- Received
- Signed
- Mentioned in
- Present at
- Employed by
- Owns
- Represents
- Contradicts
- Supports
- Related to
- Occurred before
- Occurred after

### Graph Rules

- Each relationship needs a source or inference label.
- Users can approve, reject, and edit relationships.
- Graph access follows matter permissions.

## 5.12 Tasks, Deadlines, and Calendar

### Tasks

- Title
- Description
- Matter
- Assignee
- Reviewer
- Due date
- Priority
- Status
- Dependencies
- Source
- Checklist
- Comments

### Deadlines

- Date and time
- Timezone
- Matter
- Deadline type
- Jurisdiction or rule source
- Trigger event
- Calculation method
- Responsible person
- Reminder schedule
- Verification status

AI may suggest deadlines, but a user must verify them before they become authoritative.

### Calendar

- Hearings
- Depositions
- Meetings
- Filing dates
- Internal milestones
- Reminders

## 5.13 Nyaya Memory

### Memory Categories

- Confirmed fact
- Disputed fact
- Allegation
- Admission
- Legal issue
- Claim
- Defense
- Key authority
- Strategy note
- Client preference
- Open question
- Risk
- Important deadline

### Memory Workflow

1. AI proposes memory item.
2. User reviews source and wording.
3. User approves, edits, or rejects.
4. Approved memory becomes available to matter-scoped AI.
5. Changes are audited.

Do not allow unreviewed AI memory to silently become authoritative.

## 5.14 Communications

### Initial Scope

- Internal comments
- Matter messages
- Client portal messages

### Later Integrations

- Gmail
- Outlook
- Calendar providers

Imported communications should be mapped to matters only with user confirmation or high-confidence rules plus review.

## 5.15 Time and Billing

### MVP Scope

- Manual time entry
- Timer
- Matter association
- Activity description
- AI-suggested narrative
- Billable or nonbillable
- Rate
- Basic invoice generation later

AI must not automatically bill clients without confirmation.

---

## 6. Solo Lawyer Experience

The solo workspace uses the professional architecture with these defaults:

- One organization owner
- Owner is responsible lawyer by default
- Minimal role configuration
- Simplified client intake
- Simplified dashboard
- Fewer billing settings
- Guided setup
- Templates by practice area

A solo lawyer can invite staff and convert the workspace into a firm without data migration.

---

## 7. Law Student Workspace

## 7.1 Nyaya Professor

### Capabilities

- Explain legal doctrines
- Explain cases
- Compare rules and jurisdictions
- Walk through hypotheticals
- Clarify legal vocabulary
- Distinguish rule, holding, dicta, concurrence, and dissent
- Adjust depth based on the student's request
- Cite uploaded materials and approved legal sources

### Interaction Patterns

- "Explain this simply."
- "Explain why the court ruled this way."
- "What fact was most important?"
- "How would the result change if this fact changed?"
- "Compare this case with another case."

### Guardrails

- Avoid claiming to replace course instruction.
- Clearly identify uncertainty.
- Encourage students to review source text.
- Do not knowingly assist with active restricted exams.

## 7.2 Case Upload and Case Brief Generator

### Inputs

- Uploaded judicial opinion
- Case citation or source
- Student notes, optional

### Case Brief Fields

- Case name
- Court
- Year
- Procedural posture
- Parties
- Material facts
- Issue
- Rule
- Holding
- Reasoning
- Judgment or disposition
- Concurrence
- Dissent
- Key quotations
- Importance
- Questions or ambiguities

### Interactive Case Room

After generation, students can:

- Ask follow-up questions
- Highlight passages
- Challenge the generated brief
- Compare the brief with source text
- Save notes
- Compare cases
- Ask counterfactual questions

Every answer about an uploaded case should cite the uploaded text.

## 7.3 Student Library

- Uploaded cases
- Generated briefs
- Notes
- Saved conversations
- Tags
- Course folders

---

## 8. Public Workspace

## 8.1 Nyaya Guide

### Purpose

Provide plain-language legal information and help users organize their situation.

### Required Context

Before giving jurisdiction-dependent information, ask for:

- Country
- State, province, or region when relevant

### Answer Structure

- What the issue may involve
- General legal concepts
- Common process
- Documents to gather
- Questions to ask a lawyer
- Possible urgency or deadlines
- Clear limitations

## 8.2 Explain a Document

### Supported Documents

- Lease
- Employment agreement
- Demand letter
- Court notice
- Summons
- Settlement agreement
- Insurance letter
- Consumer contract
- Government notice

### Output

- Plain-language summary
- Important dates
- Obligations
- Rights mentioned in the document
- Risks or unusual language
- Terms needing clarification
- Questions to ask a lawyer

The system must not state that a clause is legally enforceable without sufficient jurisdiction-specific authority.

## 8.3 Build My Timeline

### User Flow

1. User describes events.
2. User uploads documents.
3. AI proposes structured events.
4. User edits and confirms.
5. User exports a consultation-ready timeline.

## 8.4 Prepare for a Lawyer

### Output

- Situation summary
- People involved
- Timeline
- Documents available
- Questions for the lawyer
- Desired outcome
- Missing information
- Potentially urgent items

### Lawyer-Type Guidance

NyayaGrid may suggest categories such as:

- Family lawyer
- Immigration lawyer
- Employment lawyer
- Criminal defense lawyer
- Personal injury lawyer
- Landlord-tenant lawyer

It must not guarantee that a category is correct or recommend a specific lawyer without a separate vetted referral system.

## 8.5 Public Safety Escalation

High-risk situations should display stronger guidance, including when relevant:

- Imminent court deadline
- Arrest or detention
- Domestic violence
- Eviction or foreclosure deadline
- Immigration deadline
- Threat to personal safety
- Child custody emergency
- Risk of self-incrimination

NyayaGrid should advise prompt contact with a qualified lawyer or appropriate emergency service without pretending to assess the case definitively.

---

## 9. AI System Architecture

## 9.1 Model Strategy

Do not train a foundation model for the MVP.

Use external model providers behind a common interface:

- OpenAI
- Anthropic
- Google
- Future specialized legal models

### Provider Router Inputs

- Task type
- Required context length
- Data residency requirement
- Cost ceiling
- Latency target
- Structured output reliability
- Tool-use capability
- Customer provider restrictions

## 9.2 Retrieval-Augmented Generation

### Ingestion Pipeline

1. Upload file.
2. Malware scan.
3. Store original.
4. Extract text.
5. OCR if required.
6. Detect structure and page boundaries.
7. Create document chunks.
8. Generate embeddings.
9. Extract entities, dates, citations, and document type.
10. Index in full-text and vector search.
11. Associate with tenant and matter permissions.

### Retrieval Pipeline

1. Identify workspace and context.
2. Apply tenant and permission filters.
3. Rewrite query when useful.
4. Search lexical and vector indexes.
5. Rerank results.
6. Select source passages.
7. Generate answer.
8. Validate citations and unsupported claims.
9. Return answer with source references.

## 9.3 Agent Design

Use bounded agents, not unrestricted autonomous agents.

### Initial Agents

- Nyaya Research agent
- Nyaya Draft agent
- Document Review Agent
- Contract Agent
- Deposition Agent
- Nyaya Timeline agent
- Nyaya Graph/evidence agent
- Deadline Extraction Agent
- Student Professor Agent
- Public Legal Information Agent

### Agent Rules

- Agents have explicit tools and scopes.
- Agents cannot bypass permissions.
- Agents cannot perform external consequential actions without approval.
- Agent outputs use validated schemas.
- Long-running jobs are resumable and auditable.

## 9.4 Citation and Claim Validation

### For Uploaded Documents

Verify:

- Document ID
- Page or paragraph
- Exact supporting text
- Permission to display source

### For Legal Authorities

Verify:

- Existence
- Citation format
- Court
- Date
- Jurisdiction
- Quotation
- Pinpoint
- Treatment where available

### Unsupported Claim Handling

- Remove unsupported claim, or
- Label it as inference, or
- Ask the user for more information.

## 9.5 Structured AI Outputs

Use schemas for:

- Entities
- Relationships
- Timeline events
- Deadlines
- Facts
- Issues
- Claims
- Defenses
- Citations
- Contract clauses
- Deposition findings
- Case briefs
- Draft metadata

## 9.6 Evaluation

Maintain test sets for:

- Citation accuracy
- Source faithfulness
- Fact extraction
- Deadline extraction
- Entity extraction
- Contract issue detection
- Case brief quality
- Jurisdiction adherence
- Permission isolation
- Prompt injection resistance

---

## 10. Data Architecture

## 10.1 Multi-Tenancy

Every professional record must be scoped to a tenant.

Required protections:

- Tenant ID at the data layer
- Server-side permission checks
- Row-level security where appropriate
- Tenant-scoped search indexes
- Tenant-scoped object storage paths
- Tenant-scoped background jobs

## 10.2 Core Entity Relationships

```text
Organization
  ├── Memberships
  ├── Clients
  ├── Contacts
  ├── Matters
  │     ├── MatterMembers
  │     ├── Documents
  │     │     └── DocumentVersions
  │     ├── EvidenceItems
  │     ├── TimelineEvents
  │     ├── Entities
  │     ├── Relationships
  │     ├── Tasks
  │     ├── Deadlines
  │     ├── CalendarEvents
  │     ├── Notes
  │     ├── ResearchSessions
  │     ├── Drafts
  │     │     └── DraftVersions
  │     ├── Conversations
  │     ├── AIArtifacts
  │     └── TimeEntries
  └── AuditEvents
```

## 10.3 Suggested Matter Statuses

- Intake
- Conflict review
- Open
- Active
- Waiting
- On hold
- Settled
- Closed
- Archived

## 10.4 AI Artifact

An AIArtifact should include:

- ID
- Tenant
- Workspace
- Matter
- Artifact type
- User request
- Model provider
- Model name and version
- Prompt template version
- Tools called
- Source IDs
- Output
- Structured output
- Validation results
- User approval state
- Created by
- Created time

---

## 11. Permissions

## 11.1 Capability Examples

- organization.manage
- members.invite
- members.remove
- clients.view
- clients.edit
- matters.create
- matters.view
- matters.edit
- matters.close
- documents.upload
- documents.view
- documents.edit
- documents.delete
- evidence.manage
- timeline.manage
- research.run
- drafts.create
- drafts.approve
- billing.view
- billing.manage
- audit.view

## 11.2 Matter-Level Access

Users may have access to an organization but not every matter.

Matter access states:

- No access
- Metadata only
- Read
- Comment
- Edit
- Manage

## 11.3 Ethical Walls

Design for ethical walls:

- Restricted matter groups
- Deny-by-default membership
- Access logging
- Search exclusion
- AI retrieval exclusion

---

## 12. Security, Privacy, and Compliance

### Required for MVP

- Encryption in transit and at rest
- MFA support
- Secure session management
- Role and matter-level permissions
- Immutable audit logs for sensitive actions
- Secure upload processing
- Malware scanning
- Secret management
- Backup and recovery
- Data deletion workflow
- Export workflow
- Incident logging

### Design for Later

- SSO/SAML
- SCIM
- Data residency
- Customer-managed encryption keys
- Legal hold
- Retention policies
- DLP
- SOC 2 readiness
- ISO 27001 readiness

### Privilege and Confidentiality

NyayaGrid must state that technical confidentiality controls do not themselves determine whether legal privilege applies. Privilege status should be user-controlled and reviewable.

---

## 13. API Design

Use versioned APIs.

### Example Resources

- `/api/v1/organizations`
- `/api/v1/clients`
- `/api/v1/contacts`
- `/api/v1/matters`
- `/api/v1/matters/{matterId}/documents`
- `/api/v1/matters/{matterId}/timeline`
- `/api/v1/matters/{matterId}/entities`
- `/api/v1/matters/{matterId}/relationships`
- `/api/v1/matters/{matterId}/tasks`
- `/api/v1/matters/{matterId}/deadlines`
- `/api/v1/research`
- `/api/v1/drafts`
- `/api/v1/ai/jobs`
- `/api/v1/student/cases`
- `/api/v1/public/intakes`

### API Rules

- Validate all requests.
- Require authorization server-side.
- Return consistent error formats.
- Support idempotency.
- Use background jobs for expensive AI and document processing.
- Never return inaccessible source passages.

---

## 14. Background Jobs

### Job Types

- File extraction
- OCR
- Embedding generation
- Entity extraction
- Timeline extraction
- Citation validation
- Contract review
- Deposition analysis
- Draft generation
- Email import later
- Notification delivery

### Job Requirements

- Idempotent
- Retryable
- Observable
- Cancellable when safe
- Permission-aware
- Tenant-scoped
- Store progress and errors

---

## 15. Search

### Search Modes

- Global professional search
- Matter search
- Document search
- Entity search
- Timeline search
- Research search
- Student library search
- Public file search

### Filters

- Matter
- Client
- Document type
- Date
- Author
- Person
- Organization
- Tag
- Privilege status
- Source type

Search results must respect access permissions before ranking or display.

---

## 16. Notifications

### Notification Types

- Deadline approaching
- Task assigned
- Mention
- Draft ready for review
- Document processing complete
- AI contradiction found
- Timeline event awaiting verification
- Client upload
- Permission change

Allow in-app and email preferences. Avoid sending confidential details in notification previews by default.

---

## 17. Auditability

Audit events should include:

- User
- Tenant
- Matter
- Action
- Target
- Timestamp
- IP and device metadata where appropriate
- Previous and new state for important changes
- Source or reason

Audit:

- Login
- File access
- Downloads
- Sharing
- Permission changes
- Matter access changes
- Document deletion
- AI generation
- Draft approval
- Deadline verification
- Export

---

## 18. Product Analytics

Track product usage without capturing privileged content.

Safe metrics:

- Active organizations
- Active users
- Matters created
- Documents processed
- AI jobs completed
- Time to first value
- Citation validation failure rate
- User correction rate
- Draft approval rate
- Search success indicators
- Feature adoption

Do not send confidential document text to general analytics platforms.

---

## 19. MVP Definition

The MVP should prove that a lawyer can create a matter, upload documents, ask sourced questions, generate a timeline, create tasks and deadlines, and draft a document without leaving NyayaGrid.

### MVP Must Include

- Authentication
- Firm and solo onboarding
- Organizations and roles
- Clients
- Matters
- Documents and OCR
- Matter-scoped AI Q&A with citations
- Notes
- Tasks
- Deadline suggestions with verification
- Timeline extraction and approval
- Basic drafting
- Audit logs
- Student Nyaya Professor
- Student case upload and case brief
- Public document explanation
- Public consultation summary

### MVP Can Exclude

- Full billing
- Full email sync
- Full calendar sync
- Advanced Nyaya Graph visualization
- Advanced contract playbooks
- Full deposition suite
- Native mobile applications
- Full e-discovery production workflow

---

## 20. Release Roadmap

## Phase 1: Platform Foundation

- Authentication
- Workspace selection
- Organization model
- Roles and permissions
- Tenant isolation
- File storage
- Audit system
- Base design system

## Phase 2: Matter Management

- Clients
- Contacts
- Matters
- Matter dashboard
- Documents
- Notes
- Tasks
- Deadlines

## Phase 3: Document Intelligence

- Extraction
- OCR
- Search
- Embeddings
- Matter Q&A
- Source viewer
- Summaries
- Entity and date extraction

## Phase 4: Legal Intelligence

- Research provider abstraction
- Citation validation
- Drafting
- Document review
- Contract review foundation

## Phase 5: Matter Intelligence

- Nyaya Memory
- Timeline
- Evidence entities and relationships
- Contradiction detection
- AI daily brief

## Phase 6: Student Workspace

- Nyaya Professor
- Case upload
- Case brief
- Interactive case room
- Student library

## Phase 7: Public Workspace

- Legal information Q&A
- Document explanation
- Timeline builder
- Consultation preparation
- Risk escalation

## Phase 8: Operations Expansion

- Email integration
- Calendar integration
- Time tracking
- Billing foundation
- Client portal
- Notifications

---

## 21. Acceptance Criteria for Key Workflows

## 21.1 Matter Q&A

- User selects one matter.
- User asks a question.
- System retrieves only authorized matter sources.
- Answer includes citations.
- User can open each cited source.
- Unsupported claims are not presented as fact.
- User can save answer to notes or a draft.

## 21.2 Case Brief

- Student uploads a case.
- System extracts text with page references.
- System generates every required brief section.
- Each section links to supporting passages.
- Student can ask follow-up questions.
- Student can edit and save the brief.

## 21.3 Public Document Explanation

- User uploads a document.
- System identifies likely document type.
- System provides plain-language explanation.
- Important dates and obligations link to source text.
- System displays legal-information disclaimer.
- System recommends lawyer review when risk indicators are present.

## 21.4 Timeline Extraction

- User uploads a document.
- System proposes events.
- Each event has a source and confidence.
- User can approve, reject, or edit.
- Approved events appear in the matter timeline.
- Rejected events do not affect Nyaya Memory.

## 21.5 Draft Creation

- User selects matter and draft type.
- User selects source materials.
- System generates outline and draft.
- Citations are verified or clearly marked unresolved.
- Draft is saved as an editable version.
- Draft cannot be sent or filed automatically.

---

## 22. UX Direction

### Professional

- Desktop-first responsive design
- Split-pane document and analysis views
- Dense data tables where appropriate
- Command palette
- Keyboard shortcuts
- Persistent matter context
- Clear source and status indicators

### Student

- Calm reading environment
- Case text beside brief and chat
- Easy highlighting and note-taking
- Clear learning-oriented explanations

### Public

- Minimal legal jargon
- Step-by-step flows
- Prominent privacy and limitation notices
- Mobile-friendly document upload and reading

---

## 23. Naming Conventions

### Branded product language

- NyayaGrid: the overall platform and ecosystem.
- Nyaya: the primary AI intelligence users converse with.
- Nyaya Graph: the legal knowledge graph.
- Nyaya Memory: persistent matter intelligence.
- Nyaya Timeline: source-linked matter chronology.
- Nyaya Research: legal research experience.
- Nyaya Draft: legal drafting and review experience.
- Nyaya Professor: law student workspace.
- Nyaya Guide: public legal-information workspace.

Do not use legacy `LegalOS` naming anywhere in code, UI, database-facing copy, documentation, emails, test fixtures, or generated demo data. Do not treat branded modules as separate domains or separate codebases.

Use consistent domain language:

- Organization: a firm account
- Workspace: professional, student, or public environment
- Client: the represented person or entity
- Matter: a legal engagement, dispute, case, or project
- Document: an uploaded or generated file
- Evidence item: a document or object designated as evidence
- Authority: case, statute, regulation, rule, or other legal source
- AI Artifact: a persisted AI-generated result
- Verified: reviewed and confirmed by a user
- Inference: generated conclusion not directly stated by a source

Avoid using "case" for every matter because not all legal work is litigation.

---

## 24. Product Non-Goals

NyayaGrid is not initially:

- A law firm
- A substitute for legal representation
- A court filing service
- A comprehensive legal research database without licensed content
- A general-purpose CRM
- A full accounting suite
- A government case-management platform
- A corporate legal operations platform
- A bar exam application
- A flashcard or quiz product
- An autonomous legal decision-maker

---

## 25. Long-Term Vision

NyayaGrid should evolve into the trusted system of record and intelligence layer for legal matters.

A mature matter contains:

- People
- Organizations
- Facts
- Allegations
- Claims
- Defenses
- Legal issues
- Authorities
- Documents
- Evidence
- Events
- Deadlines
- Tasks
- Communications
- Drafts
- Decisions
- Strategy
- Outcomes

The AI should help users understand and operate on this structured matter while preserving human judgment, confidentiality, source traceability, and professional responsibility.

The product succeeds when users no longer need to choose between an AI legal assistant and legal workflow software because NyayaGrid provides both in one coherent system.
