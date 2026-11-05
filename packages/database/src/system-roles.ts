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
  "prosecution.view",
  "prosecution.edit",
  "prosecution.review",
];

/** Firm administrator — org/membership control without needing to be the Owner. */
export const ADMIN_CAPABILITIES: Capability[] = [
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

/** Supervising lawyer — full matter work plus invite and close. */
export const PARTNER_CAPABILITIES: Capability[] = [
  "members.invite",
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
];

const PROSECUTION_VIEW = [
  "prosecution.view",
  "documents.view",
] as const satisfies readonly Capability[];
const PROSECUTION_WORK = [
  "prosecution.view",
  "prosecution.edit",
  "documents.view",
  "documents.upload",
  "timeline.manage",
  "research.run",
] as const satisfies readonly Capability[];

export const PROSECUTION_ROLE_DEFINITIONS = [
  {
    key: "prosecution_office_admin",
    name: "Prosecution office admin",
    description: "Administer a prosecution office inside the organization",
    capabilities: [
      ...PROSECUTION_WORK,
      "prosecution.review",
      "audit.view",
      "organization.manage",
    ] as Capability[],
  },
  {
    key: "supervising_prosecutor",
    name: "Supervising prosecutor",
    description: "Review prosecutors' work, including disclosure review",
    capabilities: [...PROSECUTION_WORK, "prosecution.review"] as Capability[],
  },
  {
    key: "prosecutor",
    name: "Prosecutor",
    description: "Work a criminal case. Disclosure decisions stay with a reviewer.",
    capabilities: [...PROSECUTION_WORK] as Capability[],
  },
  {
    key: "investigator",
    name: "Investigator",
    description: "Add evidence and documents. Cannot edit charges or disclosure decisions.",
    capabilities: ["prosecution.view", "documents.view", "documents.upload"] as Capability[],
  },
  {
    key: "legal_support",
    name: "Legal support",
    description:
      "Prepare files and discovery intake without charge edit or final disclosure authority",
    // Must NOT include prosecution.edit — consequential case edits stay with prosecutors/reviewers.
    capabilities: ["prosecution.view", "documents.view", "documents.upload"] as Capability[],
  },
  {
    key: "prosecution_read_only",
    name: "Prosecution read only",
    description: "Read prosecution case records",
    capabilities: [...PROSECUTION_VIEW] as Capability[],
  },
] as const;

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

/** Paralegal — matter/document support without org admin or matter create/close. */
export const PARALEGAL_CAPABILITIES: Capability[] = [
  "clients.view",
  "clients.edit",
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

export const CLIENT_GUEST_CAPABILITIES: Capability[] = ["matters.view", "documents.view"];

/**
 * Professional system roles per product requirement:
 * Owner / Administrator / Partner / Lawyer / Paralegal / Staff / Client Guest.
 */
export const SYSTEM_ROLE_DEFINITIONS = [
  {
    key: "owner",
    name: "Organization Owner",
    description: "Full organization control",
    capabilities: OWNER_CAPABILITIES,
  },
  {
    key: "admin",
    name: "Administrator",
    description: "Administer firm membership, matters, and compliance",
    capabilities: ADMIN_CAPABILITIES,
  },
  {
    key: "partner",
    name: "Partner",
    description: "Supervising lawyer with matter close and invite authority",
    capabilities: PARTNER_CAPABILITIES,
  },
  {
    key: "lawyer",
    name: "Lawyer",
    description: "Matter and document work",
    capabilities: LAWYER_CAPABILITIES,
  },
  {
    key: "paralegal",
    name: "Paralegal",
    description: "Matter and document support without org administration",
    capabilities: PARALEGAL_CAPABILITIES,
  },
  {
    key: "staff",
    name: "Staff",
    description: "Limited operational access",
    capabilities: STAFF_CAPABILITIES,
  },
  {
    key: "client_guest",
    name: "Client Guest",
    description: "View assigned matters and documents only",
    capabilities: CLIENT_GUEST_CAPABILITIES,
  },
] as const;
