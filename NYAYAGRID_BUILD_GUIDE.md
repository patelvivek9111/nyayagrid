NyayaGrid Build Guide for Cursor

Goal

Build one complete vertical slice at a time. Do not generate every page as a disconnected mockup.

NyayaGrid is the single platform. Nyaya, Nyaya Graph, Nyaya Memory, Nyaya Timeline, Nyaya Research, Nyaya Draft, Nyaya Professor, and Nyaya Guide are capabilities inside NyayaGrid. Do not create separate apps, repositories, authentication systems, billing systems, or domains for these modules.

For the professional product, Nyaya is the assistant surface while Nyaya Memory, Nyaya Graph, Nyaya Timeline, Nyaya Research, and Nyaya Draft operate as integrated matter capabilities. For students, surface Nyaya Professor. For public users, surface Nyaya Guide.

Recommended First Vertical Slice

A professional user should be able to:

Create an account.

Create or join a firm.

Create a client.

Create a matter.

Upload a PDF.

Wait for processing.

Open the document.

Ask a question about the document or matter.

Receive a cited answer.

Save the answer as a matter note.

Generate proposed timeline events.

Approve one timeline event.

Create a task from the event.

This flow proves the central NyayaGrid concept: Nyaya answers the legal question while NyayaGrid manages the legal work around it.

Suggested Repository Structure

/apps
/web
/worker
/packages
/ai
/auth
/database
/documents
/permissions
/search
/ui
/validation
/observability
/docs
NYAYAGRID_PRODUCT_SPEC.md
SECURITY.md
DATA_MODEL.md
AI_EVALUATIONS.md

A single Next.js application plus a worker is acceptable for the MVP. Do not split into many services prematurely.

First Database Tables

users

organizations

memberships

roles

permissions

clients

contacts

matters

matter_members

documents

document_versions

document_chunks

notes

tasks

deadlines

timeline_events

conversations

messages

ai_jobs

ai_artifacts

citations

audit_events

First Screens

Sign in

Workspace onboarding

Professional home

Clients list and detail

Matters list

Matter overview

Matter documents

Document viewer

Nyaya matter assistant

Nyaya Timeline

Matter tasks

Settings and members

First Nyaya AI Tools

retrieveMatterSources

retrieveSelectedDocuments

createMatterNote

proposeTimelineEvents

createTaskDraft

validateCitations

Keep tools narrow and permission-aware.

Initial Application Routes

/app — professional home

/app/matters — matter list

/app/matters/:matterId — matter overview

/app/matters/:matterId/documents — documents

/app/matters/:matterId/ai — Nyaya contextual assistant

/app/matters/:matterId/timeline — Nyaya Timeline

/app/matters/:matterId/graph — Nyaya Graph

/app/matters/:matterId/research — Nyaya Research

/app/matters/:matterId/drafts — Nyaya Draft

/professor — Nyaya Professor

/guide — Nyaya Guide

Use these as logical route boundaries, not separate deployments.

First API Endpoints

POST /api/v1/organizations

POST /api/v1/clients

POST /api/v1/matters

POST /api/v1/matters/:matterId/documents

GET /api/v1/matters/:matterId/documents

POST /api/v1/matters/:matterId/ask

POST /api/v1/matters/:matterId/notes

POST /api/v1/matters/:matterId/timeline/proposals

POST /api/v1/matters/:matterId/timeline/:eventId/approve

POST /api/v1/matters/:matterId/tasks

First AI Output Schemas

Cited Answer

interface CitedAnswer {
answer: string;
sources: Array<{
documentId: string;
documentVersionId: string;
page?: number;
paragraph?: string;
quote: string;
}>;
assumptions: string[];
unresolvedQuestions: string[];
}

Timeline Proposal

interface TimelineProposal {
eventDate?: string;
datePrecision: "exact" | "approximate" | "unknown";
description: string;
eventType: string;
sourceIds: string[];
sourceQuotes: string[];
confidence: "low" | "medium" | "high";
}

Extracted Deadline

interface DeadlineProposal {
title: string;
dueAt?: string;
timezone?: string;
triggerText: string;
sourceIds: string[];
calculationExplanation?: string;
requiresVerification: true;
}

Testing Priorities

Tenant isolation

Matter-level permissions

Citation correctness

Upload processing

Prompt injection from documents

Timeline approval workflow

Audit logging

AI job retries

Document version handling

Public versus professional data isolation

Demo Data Rules

Use synthetic names and clearly fictional authorities. Never create realistic-looking fake legal citations in a way that could be misunderstood as real.

Completion Milestone

The first milestone is complete only when the full vertical slice works end to end with real persistence, real permission checks, source citations, and audit logs. Static pages alone do not count.
