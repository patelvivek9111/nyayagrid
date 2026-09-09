/**
 * Frozen four-provider certification overlay from nyaya-four-provider-cert-v1.
 * Scores are measured. Unmeasured subsystems remain CANDIDATE.
 * Never put secrets here.
 */
import type { CertificationSubsystem } from "../provider-contract";
import type { ModelLifecycle, SubsystemCertification } from "./registry";

export type CertificationEvidenceModel = {
  provider: string;
  modelId: string;
  aliases?: string[];
  status: ModelLifecycle;
  certification: Partial<SubsystemCertification>;
  qualityScore: number | null;
  safetyScore: number | null;
  citationReliability: number | null;
  structuredReliability: number | null;
  notes: string;
  benchmarkId: string;
};

export type CertificationEvidence = {
  benchmarkId: "nyaya-four-provider-cert-v1";
  applied: boolean;
  preferredAuto: Partial<Record<CertificationSubsystem, { provider: string; modelId: string }>>;
  models: CertificationEvidenceModel[];
};

export const CERTIFICATION_EVIDENCE: CertificationEvidence = {
  "benchmarkId": "nyaya-four-provider-cert-v1",
  "applied": true,
  "preferredAuto": {
    "ask": {
      "provider": "xai",
      "modelId": "grok-3"
    },
    "research": {
      "provider": "xai",
      "modelId": "grok-3"
    },
    "draft": {
      "provider": "xai",
      "modelId": "grok-3"
    },
    "contract": {
      "provider": "xai",
      "modelId": "grok-3"
    },
    "deposition": {
      "provider": "openai",
      "modelId": "gpt-4o-mini"
    },
    "evidence": {
      "provider": "openai",
      "modelId": "gpt-4o-mini"
    },
    "compare": {
      "provider": "openai",
      "modelId": "gpt-4o-mini"
    },
    "contradiction": {
      "provider": "xai",
      "modelId": "grok-3"
    },
    "timeline": {
      "provider": "openai",
      "modelId": "gpt-4o-mini"
    },
    "graph": {
      "provider": "openai",
      "modelId": "gpt-4o-mini"
    },
    "memory": {
      "provider": "openai",
      "modelId": "gpt-4o-mini"
    }
  },
  "models": [
    {
      "provider": "openai",
      "modelId": "gpt-4o-mini",
      "aliases": [
        "gpt-4o-mini",
        "gpt-4o-mini-2024-07-18"
      ],
      "status": "VALIDATED",
      "certification": {
        "ask": "CANDIDATE",
        "research": "LIMITED",
        "draft": "CANDIDATE",
        "contract": "VALIDATED",
        "deposition": "ACTIVE",
        "evidence": "ACTIVE",
        "compare": "ACTIVE",
        "contradiction": "CANDIDATE",
        "timeline": "ACTIVE",
        "graph": "ACTIVE",
        "memory": "ACTIVE"
      },
      "qualityScore": 0.8431372549019608,
      "safetyScore": 0.9803921568627451,
      "citationReliability": null,
      "structuredReliability": null,
      "notes": "nyaya-four-provider-cert-v1 quality remediation measured openai.",
      "benchmarkId": "nyaya-four-provider-cert-v1"
    },
    {
      "provider": "anthropic",
      "modelId": "claude-sonnet-4-5-20250929",
      "status": "CANDIDATE",
      "certification": {
        "ask": "CANDIDATE",
        "research": "LIMITED",
        "draft": "CANDIDATE",
        "contract": "CANDIDATE",
        "deposition": "CANDIDATE",
        "evidence": "CANDIDATE",
        "compare": "DISABLED",
        "contradiction": "CANDIDATE",
        "timeline": "DISABLED",
        "graph": "CANDIDATE",
        "memory": "CANDIDATE"
      },
      "qualityScore": 0.8431372549019608,
      "safetyScore": 0.9803921568627451,
      "citationReliability": null,
      "structuredReliability": null,
      "notes": "nyaya-four-provider-cert-v1 quality remediation measured anthropic.",
      "benchmarkId": "nyaya-four-provider-cert-v1"
    },
    {
      "provider": "xai",
      "modelId": "grok-3",
      "status": "ACTIVE",
      "certification": {
        "ask": "ACTIVE",
        "research": "ACTIVE",
        "draft": "ACTIVE",
        "contract": "ACTIVE",
        "deposition": "LIMITED",
        "evidence": "VALIDATED",
        "compare": "VALIDATED",
        "contradiction": "ACTIVE",
        "timeline": "VALIDATED",
        "graph": "VALIDATED",
        "memory": "VALIDATED"
      },
      "qualityScore": 0.9411764705882352,
      "safetyScore": 1,
      "citationReliability": null,
      "structuredReliability": null,
      "notes": "nyaya-four-provider-cert-v1 quality remediation measured xai.",
      "benchmarkId": "nyaya-four-provider-cert-v1"
    },
    {
      "provider": "google",
      "modelId": "gemini-3.6-flash",
      "status": "VALIDATED",
      "certification": {
        "ask": "LIMITED",
        "research": "LIMITED",
        "draft": "CANDIDATE",
        "contract": "CANDIDATE",
        "deposition": "CANDIDATE",
        "evidence": "CANDIDATE",
        "compare": "CANDIDATE",
        "contradiction": "VALIDATED",
        "timeline": "CANDIDATE",
        "graph": "CANDIDATE",
        "memory": "CANDIDATE"
      },
      "qualityScore": 0.7058823529411765,
      "safetyScore": 1,
      "citationReliability": null,
      "structuredReliability": null,
      "notes": "nyaya-four-provider-cert-v1 quality remediation measured google.",
      "benchmarkId": "nyaya-four-provider-cert-v1"
    }
  ]
} as CertificationEvidence;
