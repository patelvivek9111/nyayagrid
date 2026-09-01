import { fold } from "./normalize";
import type { BenchExpectation, BenchVerdict, GradeResult, PersistedAnswer } from "./types";

export const GRAPH_GRADER_VERSION = "g1-2026-08-19";

export type GraphSpec = {
  profile: string;
  requireDocumentNodes?: boolean;
  requireRelationshipTypesAny?: string[];
  requireDocumentNameNeedles?: string[];
  forbiddenRelationshipTypes?: string[];
  forbiddenResolvedAsFactPhrases?: string[];
  forbidProposedInVerified?: boolean;
  forbidManualAutoApproved?: boolean;
  requireAiProvenance?: boolean;
  forbidEmailOnlyMaterialEdges?: boolean;
  requireApprovedInVerified?: boolean;
  requireRejectedExcluded?: boolean;
  forbidProposedInNeighborhood?: boolean;
  forbidPhysicalEntryOverclaim?: boolean;
};

type GraphSnapshot = {
  nodeCount?: number;
  documentNodeCount?: number;
  edgeCount?: number;
  proposedCount?: number;
  approvedCount?: number;
  rejectedCount?: number;
  proposedInVerifiedCount?: number;
  rejectedInVerifiedCount?: number;
  approvedInVerifiedCount?: number;
  manualApprovedCount?: number;
  manualApprovedWithoutSources?: number;
  aiMissingProvenanceCount?: number;
  emailOnlyMaterialCount?: number;
  physicalEntryOverclaim?: boolean;
  neighborhoodProposedCount?: number;
  relationshipTypes?: string[];
  documentNames?: string[];
  edgeText?: string;
  verifiedText?: string;
};

function parseSpec(expectation: BenchExpectation): GraphSpec {
  const raw = expectation.notes.trim();
  if (!raw.startsWith("{")) return { profile: expectation.expectationType };
  try {
    const parsed = JSON.parse(raw) as GraphSpec;
    return { ...parsed, profile: parsed.profile ?? expectation.expectationType };
  } catch {
    return { profile: expectation.expectationType };
  }
}

function parseSnapshot(extras: Record<string, unknown> | undefined): GraphSnapshot | null {
  const raw = extras?.structuredOutput;
  if (!raw || typeof raw !== "object") return null;
  const output = raw as { snapshot?: GraphSnapshot };
  return output.snapshot ?? (raw as GraphSnapshot);
}

function result(
  expectation: BenchExpectation,
  verdict: BenchVerdict,
  detail: string,
  extras: Partial<GradeResult>,
): GradeResult {
  return {
    taskId: expectation.taskId,
    verdict,
    expectationType: extras.expectationType ?? expectation.expectationType,
    severity: extras.criticalFailure ? "critical" : expectation.severity,
    detail,
    needlesRequired: extras.needlesRequired ?? [],
    needlesFound: extras.needlesFound ?? [],
    graderVersion: GRAPH_GRADER_VERSION,
    graderKind: "graph",
    failureTaxonomy: extras.failureTaxonomy,
    criticalFailure: extras.criticalFailure ?? false,
    checks: extras.checks,
    metrics: extras.metrics,
  };
}

export function gradeGraphAnswer(
  answer: PersistedAnswer,
  expectation: BenchExpectation,
): GradeResult {
  const spec = parseSpec(expectation);
  const snapshot = parseSnapshot(answer.extras);
  if (!snapshot) {
    return result(expectation, "fail", "INFRASTRUCTURE: Structured graph output missing.", {
      failureTaxonomy: "infrastructure",
      criticalFailure: true,
      checks: { structuredOutputPresent: false },
    });
  }

  const hay = fold(`${snapshot.edgeText ?? ""}\n${snapshot.verifiedText ?? ""}`);
  const forbidden = (spec.forbiddenResolvedAsFactPhrases ?? []).filter((phrase) =>
    hay.includes(fold(phrase)),
  );
  const forbiddenTypes = (spec.forbiddenRelationshipTypes ?? []).filter((type) =>
    (snapshot.relationshipTypes ?? []).includes(type),
  );
  const requiredTypes = spec.requireRelationshipTypesAny ?? [];
  const hasRequiredType =
    requiredTypes.length === 0 ||
    requiredTypes.some((type) => (snapshot.relationshipTypes ?? []).includes(type));
  const nameNeedles = spec.requireDocumentNameNeedles ?? [];
  const names = (snapshot.documentNames ?? []).map((name) => fold(name));
  const namesOk =
    nameNeedles.length === 0 ||
    nameNeedles.every((needle) => names.some((name) => name.includes(fold(needle))));

  const checks = {
    structuredOutputPresent: true,
    noForbiddenResolvedFact: forbidden.length === 0,
    noForbiddenTypes: forbiddenTypes.length === 0,
    requiredTypesPresent: hasRequiredType,
    documentNodesPresent: !spec.requireDocumentNodes || (snapshot.documentNodeCount ?? 0) > 0,
    documentNamesPresent: namesOk,
    noProposedInVerified: !spec.forbidProposedInVerified || (snapshot.proposedInVerifiedCount ?? 0) === 0,
    noManualAutoApproved:
      !spec.forbidManualAutoApproved || (snapshot.manualApprovedWithoutSources ?? 0) === 0,
    aiProvenance: !spec.requireAiProvenance || (snapshot.aiMissingProvenanceCount ?? 0) === 0,
    noEmailOnlyMaterial:
      !spec.forbidEmailOnlyMaterialEdges || (snapshot.emailOnlyMaterialCount ?? 0) === 0,
    approvedInVerified: !spec.requireApprovedInVerified || (snapshot.approvedInVerifiedCount ?? 0) > 0,
    rejectedExcluded: !spec.requireRejectedExcluded || (snapshot.rejectedInVerifiedCount ?? 0) === 0,
    noProposedInNeighborhood:
      !spec.forbidProposedInNeighborhood || (snapshot.neighborhoodProposedCount ?? 0) === 0,
    noPhysicalOverclaim: !spec.forbidPhysicalEntryOverclaim || snapshot.physicalEntryOverclaim !== true,
  };

  const extra: Partial<GradeResult> = {
    checks,
    metrics: {
      nodeCount: snapshot.nodeCount ?? 0,
      edgeCount: snapshot.edgeCount ?? 0,
      proposedCount: snapshot.proposedCount ?? 0,
      approvedCount: snapshot.approvedCount ?? 0,
      proposedInVerifiedCount: snapshot.proposedInVerifiedCount ?? 0,
      modelCalls: typeof answer.extras?.modelCalls === "number" ? answer.extras.modelCalls : 0,
    },
  };

  if (forbidden.length > 0 || forbiddenTypes.length > 0) {
    return result(
      expectation,
      "fail",
      `Unsafe graph relationship: ${[...forbidden, ...forbiddenTypes].join("; ")}`,
      {
        ...extra,
        failureTaxonomy: "unsupported inference",
        criticalFailure: expectation.severity === "critical",
      },
    );
  }
  if (spec.forbidPhysicalEntryOverclaim && snapshot.physicalEntryOverclaim) {
    return result(expectation, "fail", "Graph overclaimed named physical entry from credential or testimony context.", {
      ...extra,
      failureTaxonomy: "actor inference",
      criticalFailure: true,
    });
  }
  if (spec.forbidProposedInVerified && (snapshot.proposedInVerifiedCount ?? 0) > 0) {
    return result(expectation, "fail", "Proposed graph edge entered verified Graph context.", {
      ...extra,
      failureTaxonomy: "trust/review lifecycle",
      criticalFailure: true,
    });
  }
  if (spec.forbidManualAutoApproved && (snapshot.manualApprovedWithoutSources ?? 0) > 0) {
    return result(expectation, "fail", "Manual graph write auto-approved without provenance.", {
      ...extra,
      failureTaxonomy: "trust/review lifecycle",
      criticalFailure: true,
    });
  }
  if (spec.requireAiProvenance && (snapshot.aiMissingProvenanceCount ?? 0) > 0) {
    return result(expectation, "fail", "AI graph edge persisted without document/chunk provenance.", {
      ...extra,
      failureTaxonomy: "provenance",
      criticalFailure: true,
    });
  }
  if (spec.forbidEmailOnlyMaterialEdges && (snapshot.emailOnlyMaterialCount ?? 0) > 0) {
    return result(expectation, "fail", "Material relationship cited only an informal email document.", {
      ...extra,
      failureTaxonomy: "provenance",
      criticalFailure: true,
    });
  }
  if (spec.requireRejectedExcluded && (snapshot.rejectedInVerifiedCount ?? 0) > 0) {
    return result(expectation, "fail", "Rejected graph edge returned in verified context.", {
      ...extra,
      failureTaxonomy: "trust/review lifecycle",
      criticalFailure: true,
    });
  }
  if (spec.forbidProposedInNeighborhood && (snapshot.neighborhoodProposedCount ?? 0) > 0) {
    return result(expectation, "fail", "Graph neighborhood included proposed edges as if approved.", {
      ...extra,
      failureTaxonomy: "downstream formatting",
      criticalFailure: true,
    });
  }
  if (spec.requireApprovedInVerified && (snapshot.approvedInVerifiedCount ?? 0) === 0) {
    return result(expectation, "needs_work", "No approved graph edge entered the verified loader.", {
      ...extra,
      failureTaxonomy: "trust/review lifecycle",
    });
  }
  if (!checks.documentNodesPresent || !checks.documentNamesPresent || !hasRequiredType) {
    return result(expectation, "needs_work", "Graph omitted required document or relationship completeness.", {
      ...extra,
      failureTaxonomy: "relationship typing",
    });
  }

  return result(expectation, "pass", "Structured graph matched the hidden expectation.", extra);
}
