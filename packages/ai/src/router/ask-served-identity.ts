/**
 * Ask-route served-model recertification after xAI reported grok-4.3
 * when grok-3 was requested. Does not rewrite nyaya-four-provider-cert-v1.
 */
export const ASK_SERVED_MODEL_RECERT = {
  id: "nyaya-v3-1-ask-recert-v1",
  parentOverlay: "nyaya-four-provider-cert-v1",
  requested: "grok-3",
  served: "grok-4.3",
  provider: "xai",
  subsystem: "ask",
  recertifiedAt: "2026-09-09T16:00:00.000Z",
  contract:
    "xAI accepts grok-3 and returns response.model grok-4.3. Evaluated served identity is grok-4.3. Not a silent provider substitution.",
} as const;
