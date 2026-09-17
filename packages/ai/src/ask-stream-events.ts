import { z } from "zod";
import type { ProvenanceSummary, SourceCategory, SourceScope } from "./source-scope";

export const ASK_STREAM_EVENT_TYPES = [
  "request_started",
  "retrieval_started",
  "retrieval_completed",
  "related_retrieval_started",
  "related_retrieval_completed",
  "amendment_check_started",
  "amendment_check_completed",
  "contradiction_check_started",
  "contradiction_check_completed",
  "citation_check_started",
  "citation_check_completed",
  "generation_started",
  "text_delta",
  "source_added",
  "coverage_updated",
  "provenance_ready",
  "generation_completed",
  "generation_stopped",
  "generation_failed",
  "continue_available",
] as const;

export type AskStreamEventType = (typeof ASK_STREAM_EVENT_TYPES)[number];

export type AskProgressItem = {
  id: string;
  label: string;
  status: "pending" | "active" | "done" | "warning" | "error";
  detail?: string;
};

export type AskStreamSource = {
  id: string;
  category: SourceCategory;
  title: string;
  subtitle?: string;
  quote?: string;
  url?: string;
  retrievedAt?: string;
  documentId?: string;
  chunkId?: string;
  authorityId?: string;
};

export type AskCoverageRow = {
  id: string;
  label: string;
  status: "reviewed" | "searched" | "not_provided" | "failed" | "count";
  detail?: string;
};

export type AskStreamEvent =
  | {
      type: "request_started";
      sourceScope: SourceScope;
      conversationId?: string | null;
      usageActionId: string;
      at: string;
    }
  | {
      type: "retrieval_started";
      label: string;
      at: string;
    }
  | {
      type: "retrieval_completed";
      documentsReviewed?: number;
      passagesFound: number;
      label: string;
      at: string;
    }
  | {
      type: "related_retrieval_started";
      reason: string;
      at: string;
    }
  | {
      type: "related_retrieval_completed";
      passagesAdded: number;
      reason: string;
      at: string;
    }
  | {
      type: "amendment_check_started";
      at: string;
    }
  | {
      type: "amendment_check_completed";
      status: "controlling_identified" | "none_found" | "future_excluded" | "skipped";
      label: string;
      at: string;
    }
  | {
      type: "contradiction_check_started";
      at: string;
    }
  | {
      type: "contradiction_check_completed";
      unresolvedCount: number;
      label: string;
      at: string;
    }
  | {
      type: "citation_check_started";
      at: string;
    }
  | {
      type: "citation_check_completed";
      accepted: number;
      rejected: number;
      at: string;
    }
  | {
      type: "generation_started";
      at: string;
    }
  | {
      type: "text_delta";
      text: string;
      draft?: boolean;
      at: string;
    }
  | {
      type: "source_added";
      source: AskStreamSource;
      at: string;
    }
  | {
      type: "coverage_updated";
      rows: AskCoverageRow[];
      note?: string;
      at: string;
    }
  | {
      type: "provenance_ready";
      provenance: ProvenanceSummary;
      at: string;
    }
  | {
      type: "generation_completed";
      answer: string;
      conversationId: string;
      artifactId?: string;
      messageId?: string;
      status: "completed";
      provenance: ProvenanceSummary;
      at: string;
    }
  | {
      type: "generation_stopped";
      partialAnswer?: string;
      conversationId?: string | null;
      status: "cancelled";
      at: string;
    }
  | {
      type: "generation_failed";
      message: string;
      recoverable: boolean;
      at: string;
    }
  | {
      type: "continue_available";
      continueToken: string;
      at: string;
    };

export type AskStreamListener = (event: AskStreamEvent) => void;

export function nowIso(): string {
  return new Date().toISOString();
}

export function encodeSseEvent(event: AskStreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Progressive render of finalized answer text — not fake progress timers. */
export function chunkAnswerForStreaming(answer: string, chunkSize = 48): string[] {
  if (!answer) return [];
  const chunks: string[] = [];
  for (let i = 0; i < answer.length; i += chunkSize) {
    chunks.push(answer.slice(i, i + chunkSize));
  }
  return chunks;
}

export const askContinueContextSchema = z.object({
  continueToken: z.string().min(8).max(64),
  sourceScope: z.enum(["case", "legal_research", "web", "case_plus_legal"]),
  questionFingerprint: z.string().min(8).max(128),
  passageChunkIds: z.array(z.string()).max(40),
  authorityIds: z.array(z.string()).max(40).optional(),
  webSourceIds: z.array(z.string()).max(40).optional(),
  createdAt: z.string(),
});

export type AskContinueContext = z.infer<typeof askContinueContextSchema>;
