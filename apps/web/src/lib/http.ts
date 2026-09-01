import { NextResponse } from "next/server";
import { AuthorizationError } from "@nyayagrid/permissions";
import { InviteError, UnauthenticatedError, userFacingInviteMessage, USER_FACING_AUTH } from "@nyayagrid/auth";
import { StudentAccessError, GuideAuthorizationError } from "@nyayagrid/workspaces";
import { DocumentDownloadError } from "@nyayagrid/documents";
import {
  RateLimitExceededError,
  LegalHoldActiveError,
  LifecycleNotFoundError,
  LifecycleValidationError,
} from "@nyayagrid/platform";
import { ZodError } from "zod";
import { InviteRoleNotFoundError } from "./invites";
import { FeatureDisabledError } from "./features";
import { InvalidJurisdictionError } from "@nyayagrid/jurisdiction";
import { RouterUnavailableError, ROUTER_UNAVAILABLE_USER_MESSAGE } from "@nyayagrid/ai";
import { createLogger } from "@nyayagrid/observability";

const logger = createLogger("web.http");
const PUBLIC_INTERNAL_ERROR = "An unexpected error occurred";

const INVITE_ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  REVOKED: 409,
  EXPIRED: 409,
  ALREADY_ACCEPTED: 409,
  EMAIL_MISMATCH: 403,
  ROLE_NOT_INVITEABLE: 400,
  INTERNAL: 500,
};

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data, init);
}

export function jsonError(code: string, message: string, status: number, details?: unknown) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        details,
      },
    },
    { status },
  );
}

export function handleRouteError(error: unknown) {
  if (error instanceof UnauthenticatedError) {
    return jsonError(error.code, USER_FACING_AUTH.unauthenticated, 401);
  }
  if (error instanceof AuthorizationError) {
    return jsonError(error.code, USER_FACING_AUTH.forbidden, 403);
  }
  if (error instanceof StudentAccessError || error instanceof GuideAuthorizationError) {
    return jsonError(error.code, error.message, 404);
  }
  if (error instanceof DocumentDownloadError) {
    return jsonError(error.code, error.message, error.code === "NOT_FOUND" ? 404 : 409);
  }
  if (error instanceof InviteRoleNotFoundError) {
    return jsonError(error.code, error.message, 400);
  }
  if (error instanceof InviteError) {
    return jsonError(
      error.code,
      userFacingInviteMessage(error.code),
      INVITE_ERROR_STATUS[error.code] ?? 400,
    );
  }
  if (error instanceof RateLimitExceededError) {
    return NextResponse.json(
      { error: { code: error.code, message: error.message } },
      {
        status: 429,
        headers: { "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))) },
      },
    );
  }
  if (error instanceof FeatureDisabledError) {
    return jsonError(error.code, error.message, 404);
  }
  if (error instanceof LegalHoldActiveError) {
    return jsonError(error.code, error.message, 409);
  }
  if (error instanceof LifecycleNotFoundError) {
    return jsonError(error.code, error.message, 404);
  }
  if (error instanceof LifecycleValidationError) {
    return jsonError(error.code, error.message, 400);
  }
  if (error instanceof InvalidJurisdictionError) {
    return jsonError(error.code, error.message, 400);
  }
  if (error instanceof RouterUnavailableError) {
    return jsonError(error.code, ROUTER_UNAVAILABLE_USER_MESSAGE, 503);
  }
  if (error instanceof ZodError) {
    return jsonError("VALIDATION_ERROR", "Invalid request", 400, error.flatten());
  }
  logger.error("Unhandled route error", {
    name: error instanceof Error ? error.name : "unknown",
  });
  return jsonError("INTERNAL_ERROR", PUBLIC_INTERNAL_ERROR, 500);
}
