import { NextResponse } from "next/server";
import { AuthorizationError } from "@nyayagrid/permissions";
import { InviteError, UnauthenticatedError } from "@nyayagrid/auth";
import { StudentAccessError, GuideAuthorizationError } from "@nyayagrid/workspaces";
import { DocumentDownloadError } from "@nyayagrid/documents";
import { RateLimitExceededError } from "@nyayagrid/platform";
import { ZodError } from "zod";
import { InviteRoleNotFoundError } from "./invites";

const INVITE_ERROR_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  REVOKED: 409,
  EXPIRED: 409,
  ALREADY_ACCEPTED: 409,
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
    return jsonError(error.code, error.message, 401);
  }
  if (error instanceof AuthorizationError) {
    return jsonError(error.code, error.message, 403);
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
    return jsonError(error.code, error.message, INVITE_ERROR_STATUS[error.code] ?? 400);
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
  if (error instanceof ZodError) {
    return jsonError("VALIDATION_ERROR", "Invalid request", 400, error.flatten());
  }
  if (error instanceof Error) {
    return jsonError("INTERNAL_ERROR", error.message, 500);
  }
  return jsonError("INTERNAL_ERROR", "Unknown error", 500);
}
