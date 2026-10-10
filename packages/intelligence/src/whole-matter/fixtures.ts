import { runComplexCivilClaimsFixture } from "../civil/claims-fixtures";
import { runComplexDiscoveryLedgerFixture } from "../discovery-ledger/fixtures";
import { buildPass6LitigationFixtureReview } from "../motions-communications/fixtures";
import { assembleWholeMatterIntelligence } from "./assemble";
import type { AuthorityContextItem, WholeMatterIntelligence } from "./types";

/**
 * D7 multi-domain fixture — composes D3 civil + D4 discovery + D6 motions/comms
 * with aligned authority buckets and cross-domain links for Ask/benchmark.
 */
export function runPass7WholeMatterFixture(): {
  intelligence: WholeMatterIntelligence;
  ids: {
    claimBreach: string;
    defense: string;
    deficiencyId: string;
    motionCompel: string;
    macComm: string;
    authorityResolved: string;
    authorityCorpus: string;
    authorityUnresolved: string;
  };
} {
  const civilFx = runComplexCivilClaimsFixture();
  const discoveryFx = runComplexDiscoveryLedgerFixture();
  const organizationId = "00000000-0000-4000-8000-0000000000a1";
  const matterId = "00000000-0000-4000-8000-0000000000m1";
  const mcReview = buildPass6LitigationFixtureReview({
    organizationId,
    matterId,
  });

  // Align Pass 6 motion claim link to the live civil breach claim when present.
  const claimBreach =
    civilFx.review.claims.find((c) => c.isCurrent && /breach/i.test(c.label))?.id ??
    civilFx.review.claims.find((c) => c.isCurrent)?.id ??
    "claim-breach";
  const defense =
    civilFx.review.defenses.find((d) => d.isCurrent)?.id ?? civilFx.review.defenses[0]?.id ?? "defense-1";

  const motionCompel = mcReview.motions[0]!.id;
  const macComm = mcReview.communications[0]!.id;
  const deficiencyFromMc =
    mcReview.motionLinks.find((l) => l.linkType === "DISCOVERY_DEFICIENCY")?.targetId ?? null;

  // Patch discovery deficiencies to use first-class Pass 6 UUIDs where the fixture has a compel link.
  const discovery = {
    ...discoveryFx.review,
    organizationId,
    matterId,
    deficiencies: discoveryFx.review.deficiencies.map((d, index) =>
      index === 0 || d.motionId
        ? {
            ...d,
            communicationId: macComm,
            motionId: motionCompel,
            meetAndConferId: discoveryFx.review.meetAndConferIssues[0]?.id ?? d.meetAndConferId,
          }
        : d,
    ),
    meetAndConferIssues: discoveryFx.review.meetAndConferIssues.map((m, index) =>
      index === 0 ? { ...m, communicationId: macComm } : m,
    ),
    motionLinks: discoveryFx.review.motionLinks.map((m) => ({
      ...m,
      motionId: motionCompel,
      documentId: mcReview.motionDocuments.find((d) => d.role === "MOTION")?.documentId ?? m.documentId,
    })),
  };

  const motionsComms = {
    ...mcReview,
    motionLinks: mcReview.motionLinks.map((l) =>
      l.linkType === "CLAIM" ? { ...l, targetId: claimBreach } : l,
    ),
  };

  const civil = {
    ...civilFx.review,
    organizationId,
    matterId,
  };

  const authorities: AuthorityContextItem[] = [
    {
      id: "auth-resolved-1",
      citation: "410 U.S. 113",
      title: "Synthetic resolved authority",
      resolution: "AUTHORITY_RESOLVED",
      treatmentVerified: false,
      relatedClaimIds: [claimBreach],
      relatedIssueIds: [],
    },
    {
      id: "auth-corpus-1",
      citation: "123 F. Supp. 3d 456",
      title: "Synthetic corpus-complete authority",
      resolution: "CORPUS_COMPLETE",
      treatmentVerified: true,
      relatedClaimIds: [claimBreach],
      relatedIssueIds: [],
    },
    {
      id: "auth-unresolved-1",
      citation: "999 Fake.Rep. 1",
      title: null,
      resolution: "IDENTITY_UNRESOLVED",
      treatmentVerified: false,
      relatedClaimIds: [],
      relatedIssueIds: [],
    },
  ];

  const intelligence = assembleWholeMatterIntelligence({
    organizationId,
    matterId,
    civil,
    discovery,
    motionsComms,
    verified: {
      facts: civil.facts.map((f) => ({
        id: f.id,
        label: f.text,
        value: f.text,
        status: "approved",
      })),
      events: [
        {
          id: "tl-notice",
          title: "Cure notice sent",
          eventType: "fact_event",
          eventDate: "2025-11-02T12:00:00.000Z",
        },
      ],
      deadlines: [
        {
          id: "dl-supplement",
          title: "Supplemental production due (order)",
          dueAt: "2025-12-02T23:59:00.000Z",
          dateKind: "explicit",
          status: "approved",
        },
      ],
      entities: civil.parties.map((p) => ({ id: p.id, displayName: p.displayName })),
    },
    tasks: [
      {
        id: "task-supplement",
        title: "Confirm supplemental production after partial grant",
        status: "open",
        dueAt: "2025-12-02T23:59:00.000Z",
      },
    ],
    authorities,
    now: new Date("2025-12-10T12:00:00.000Z"),
  });

  return {
    intelligence,
    ids: {
      claimBreach,
      defense,
      deficiencyId:
        deficiencyFromMc ??
        discovery.deficiencies.find((d) => d.motionId === motionCompel)?.id ??
        discovery.deficiencies[0]!.id,
      motionCompel,
      macComm,
      authorityResolved: authorities[0]!.id,
      authorityCorpus: authorities[1]!.id,
      authorityUnresolved: authorities[2]!.id,
    },
  };
}
