/**
 * Adapter contract for external prosecution validation.
 * Silent model substitution during scoring is forbidden.
 */

export type ModelPinRecord = {
  logicalModel: string;
  requestedApiModel: string;
  servedModel: string | null;
  adapterSubstitution: boolean;
  providerResponseModel: string | null;
  pinStatus: "PINNED" | "MODEL_PIN_UNAVAILABLE" | "SUBSTITUTED_FORBIDDEN";
};

export function recordModelPin(input: {
  logicalModel: string;
  requestedApiModel: string;
  servedModel?: string | null;
  providerResponseModel?: string | null;
}): ModelPinRecord {
  const served = input.servedModel ?? null;
  const providerModel = input.providerResponseModel ?? served;
  const matches =
    served != null &&
    (served === input.requestedApiModel ||
      served === input.logicalModel ||
      served.startsWith(`${input.requestedApiModel}-`) ||
      served.startsWith(`${input.logicalModel}-`));

  if (served == null) {
    return {
      logicalModel: input.logicalModel,
      requestedApiModel: input.requestedApiModel,
      servedModel: null,
      adapterSubstitution: false,
      providerResponseModel: providerModel,
      pinStatus: "MODEL_PIN_UNAVAILABLE",
    };
  }

  if (!matches) {
    return {
      logicalModel: input.logicalModel,
      requestedApiModel: input.requestedApiModel,
      servedModel: served,
      adapterSubstitution: true,
      providerResponseModel: providerModel,
      pinStatus: "SUBSTITUTED_FORBIDDEN",
    };
  }

  return {
    logicalModel: input.logicalModel,
    requestedApiModel: input.requestedApiModel,
    servedModel: served,
    adapterSubstitution: false,
    providerResponseModel: providerModel,
    pinStatus: "PINNED",
  };
}

/** Known from live canary: logical gpt-6.1-sol was not served. */
export const GPT_61_SOL_LIVE_VERIFIED = false;

export function assertNoSilentSubstitution(pin: ModelPinRecord): void {
  if (pin.pinStatus === "SUBSTITUTED_FORBIDDEN") {
    throw new Error(
      `MODEL_PIN_UNAVAILABLE_OR_SUBSTITUTED: logical=${pin.logicalModel} requested=${pin.requestedApiModel} served=${pin.servedModel}`,
    );
  }
}
