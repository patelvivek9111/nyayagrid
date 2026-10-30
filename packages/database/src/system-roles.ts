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
  "prosecution.case.manage",
  "prosecution.charge.manage",
  "prosecution.evidence.manage",
  "prosecution.witness.manage",
  "prosecution.discovery.manage",
  "prosecution.disclosure.review",
  "prosecution.procedure.manage",
  "prosecution.motion.manage",
  "prosecution.task.manage",
];

const PROSECUTION_VIEW = [
  "prosecution.view",
  "documents.view",
] as const satisfies readonly Capability[];

/** Full operational case-work capabilities shared by prosecutors and supervisors. */
const PROSECUTION_OPERATIONAL = [
  "prosecution.view",
  "prosecution.case.manage",
  "prosecution.charge.manage",
  "prosecution.evidence.manage",
  "prosecution.witness.manage",
  "prosecution.discovery.manage",
  "prosecution.procedure.manage",
  "prosecution.motion.manage",
  "prosecution.task.manage",
  "documents.view",
  "documents.upload",
  "timeline.manage",
  "research.run",
  "drafts.create",
] as const satisfies readonly Capability[];

/**
 * Broad `prosecution.edit` is retained for Owner and office admin backward compatibility.
 * Legal Support must NOT receive prosecution.edit or charge/plea/disclosure finalization.
 */
export const PROSECUTION_ROLE_DEFINITIONS = [
  {
    key: "prosecution_office_admin",
    name: "Prosecution office admin",
    description: "Administer a prosecution office inside the organization",
    capabilities: [
      ...PROSECUTION_OPERATIONAL,
      "prosecution.edit",
      "prosecution.review",
      "prosecution.disclosure.review",
      "audit.view",
      "organization.manage",
    ] as Capability[],
  },
  {
    key: "supervising_prosecutor",
    name: "Supervising prosecutor",
    description: "Review prosecutors' work, including disclosure review",
    capabilities: [
      ...PROSECUTION_OPERATIONAL,
      "prosecution.review",
      "prosecution.disclosure.review",
      "audit.view",
    ] as Capability[],
  },
  {
    key: "prosecutor",
    name: "Prosecutor",
    description: "Work a criminal case. Disclosure decisions stay with a reviewer.",
    capabilities: [...PROSECUTION_OPERATIONAL] as Capability[],
  },
  {
    key: "investigator",
    name: "Investigator",
    description: "Add evidence and documents. Cannot edit charges or disclosure decisions.",
    capabilities: [
      "prosecution.view",
      "prosecution.evidence.manage",
      "prosecution.witness.manage",
      "documents.view",
      "documents.upload",
    ] as Capability[],
  },
  {
    key: "legal_support",
    name: "Legal support",
    description:
      "Prepare files and discovery intake without charge edit or final disclosure authority",
    capabilities: [
      "prosecution.view",
      "prosecution.discovery.manage",
      "prosecution.task.manage",
      "documents.view",
      "documents.upload",
    ] as Capability[],
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

export const STAFF_CAPABILITIES: Capability[] = [
  "clients.view",
  "matters.view",
  "documents.upload",
  "documents.view",
];

export const CLIENT_GUEST_CAPABILITIES: Capability[] = ["matters.view", "documents.view"];

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
  {
    key: "client_guest",
    name: "Client Guest",
    description: "View assigned matters and documents only",
    capabilities: CLIENT_GUEST_CAPABILITIES,
  },
] as const;
