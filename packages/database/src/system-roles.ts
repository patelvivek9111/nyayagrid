import type { Capability } from "@nyayagrid/validation";

export const OWNER_CAPABILITIES: Capability[] = [
  "organization.manage",
  "members.invite",
  "members.remove",
  "clients.view",
  "clients.edit",
  "matters.create",
  "matters.view",
  "matters.edit",
  "matters.close",
  "documents.upload",
  "documents.view",
  "documents.edit",
  "documents.delete",
  "timeline.manage",
  "research.run",
  "drafts.create",
  "audit.view",
  "compliance.manage",
];

export const LAWYER_CAPABILITIES: Capability[] = [
  "clients.view",
  "clients.edit",
  "matters.create",
  "matters.view",
  "matters.edit",
  "documents.upload",
  "documents.view",
  "documents.edit",
  "timeline.manage",
  "research.run",
  "drafts.create",
];

export const STAFF_CAPABILITIES: Capability[] = [
  "clients.view",
  "matters.view",
  "documents.upload",
  "documents.view",
];

export const SYSTEM_ROLE_DEFINITIONS = [
  {
    key: "owner",
    name: "Organization Owner",
    description: "Full organization control",
    capabilities: OWNER_CAPABILITIES,
  },
  {
    key: "lawyer",
    name: "Lawyer",
    description: "Matter and document work",
    capabilities: LAWYER_CAPABILITIES,
  },
  {
    key: "staff",
    name: "Staff",
    description: "Limited operational access",
    capabilities: STAFF_CAPABILITIES,
  },
] as const;
