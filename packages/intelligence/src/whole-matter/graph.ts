import type { WholeMatterIntelligence } from "./types";

/**
 * Graph visualization plan derived from the whole-matter read model.
 * Not a separate truth system — mirrors assemble() relationships only.
 */
export type WholeMatterGraphNode = {
  key: string;
  entityType: string;
  entityId: string;
  displayName: string;
};

export type WholeMatterGraphEdge = {
  fromKey: string;
  toKey: string;
  relationshipType: string;
  label: string;
};

function nodeKey(entityType: string, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function planWholeMatterGraph(intelligence: WholeMatterIntelligence): {
  nodes: WholeMatterGraphNode[];
  edges: WholeMatterGraphEdge[];
} {
  const nodes = new Map<string, WholeMatterGraphNode>();
  const edges = new Map<string, WholeMatterGraphEdge>();

  function addNode(entityType: string, entityId: string, displayName: string) {
    const key = nodeKey(entityType, entityId);
    if (!nodes.has(key)) {
      nodes.set(key, { key, entityType, entityId, displayName });
    }
  }

  function addEdge(fromKey: string, toKey: string, relationshipType: string, label: string) {
    const id = `${fromKey}|${relationshipType}|${toKey}`;
    if (!edges.has(id)) {
      edges.set(id, { fromKey, toKey, relationshipType, label });
    }
  }

  for (const party of intelligence.parties) {
    addNode("party", party.id, party.displayName);
  }

  for (const claim of intelligence.claims) {
    const claimKey = nodeKey("claim", claim.claimId);
    addNode("claim", claim.claimId, claim.label);
    for (const evidenceId of claim.supportingEvidenceIds) {
      addNode("evidence", evidenceId, `Evidence ${evidenceId}`);
      addEdge(claimKey, nodeKey("evidence", evidenceId), "CLAIM_SUPPORTS_EVIDENCE", "SUPPORTS");
    }
    for (const evidenceId of claim.contradictingEvidenceIds) {
      addNode("evidence", evidenceId, `Evidence ${evidenceId}`);
      addEdge(claimKey, nodeKey("evidence", evidenceId), "CLAIM_CONTRADICTS_EVIDENCE", "CONTRADICTS");
    }
    for (const deficiencyId of claim.relatedDeficiencyIds) {
      addNode("discovery_deficiency", deficiencyId, `Deficiency ${deficiencyId}`);
      addEdge(claimKey, nodeKey("discovery_deficiency", deficiencyId), "CLAIM_RELATED_DEFICIENCY", "RELATED");
    }
    for (const motionId of claim.relatedMotionIds) {
      addNode("motion", motionId, `Motion ${motionId}`);
      addEdge(nodeKey("motion", motionId), claimKey, "MOTION_RELATED_CLAIM", "RELATED");
    }
    for (const authorityId of claim.relatedAuthorityIds) {
      addNode("authority", authorityId, `Authority ${authorityId}`);
      addEdge(claimKey, nodeKey("authority", authorityId), "CLAIM_RELATED_AUTHORITY", "RELATED");
    }
  }

  for (const defense of intelligence.defenses) {
    addNode("defense", defense.defenseId, defense.label);
    for (const claimId of defense.againstClaimIds) {
      addEdge(
        nodeKey("defense", defense.defenseId),
        nodeKey("claim", claimId),
        "DEFENSE_AGAINST_CLAIM",
        "AGAINST",
      );
    }
  }

  for (const chain of intelligence.discoveryChains) {
    if (chain.deficiencyId) {
      addNode("discovery_deficiency", chain.deficiencyId, `Deficiency ${chain.deficiencyId}`);
    }
    for (const communicationId of chain.communicationIds) {
      addNode("communication", communicationId, `Communication ${communicationId}`);
      if (chain.deficiencyId) {
        addEdge(
          nodeKey("communication", communicationId),
          nodeKey("discovery_deficiency", chain.deficiencyId),
          "COMMUNICATION_RELATED_DEFICIENCY",
          "MAC",
        );
      }
    }
    if (chain.motionId && chain.deficiencyId) {
      addNode("motion", chain.motionId, `Motion ${chain.motionId}`);
      addEdge(
        nodeKey("motion", chain.motionId),
        nodeKey("discovery_deficiency", chain.deficiencyId),
        "MOTION_RELATED_DEFICIENCY",
        "COMPEL",
      );
    }
    if (chain.motionId && chain.rulingDisposition) {
      addNode("order", chain.motionId, `Ruling ${chain.rulingDisposition}`);
      addEdge(
        nodeKey("order", chain.motionId),
        nodeKey("motion", chain.motionId),
        "ORDER_RESOLVES_MOTION",
        chain.rulingDisposition,
      );
    }
  }

  for (const motion of intelligence.motions) {
    addNode("motion", motion.motionId, motion.title);
    for (const communicationId of motion.relatedCommunicationIds) {
      addNode("communication", communicationId, `Communication ${communicationId}`);
      addEdge(
        nodeKey("communication", communicationId),
        nodeKey("motion", motion.motionId),
        "COMMUNICATION_RELATED_MOTION",
        "RELATED",
      );
    }
  }

  for (const auth of intelligence.authorities) {
    if (auth.resolution === "IDENTITY_UNRESOLVED") continue;
    addNode("authority", auth.id, auth.citation ?? auth.title ?? auth.id);
    for (const claimId of auth.relatedClaimIds) {
      addEdge(nodeKey("claim", claimId), nodeKey("authority", auth.id), "CLAIM_RELATED_AUTHORITY", auth.resolution);
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}
