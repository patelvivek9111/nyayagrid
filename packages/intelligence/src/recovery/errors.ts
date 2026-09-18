export class LegalWorkError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "LegalWorkError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class LegalWorkConflictError extends LegalWorkError {
  constructor(message: string, details?: unknown) {
    super("NEWER_CHANGES_EXIST", message, 409, details);
    this.name = "LegalWorkConflictError";
  }
}

export class LegalWorkLockedError extends LegalWorkError {
  constructor(message = "This record is finalized and cannot be changed with Undo.") {
    super("LOCKED", message, 409);
    this.name = "LegalWorkLockedError";
  }
}

export class LegalWorkIrreversibleError extends LegalWorkError {
  constructor(message: string, details?: unknown) {
    super("IRREVERSIBLE", message, 409, details);
    this.name = "LegalWorkIrreversibleError";
  }
}

export class LegalWorkNotFoundError extends LegalWorkError {
  constructor(message = "Version not found in this case") {
    super("NOT_FOUND", message, 404);
    this.name = "LegalWorkNotFoundError";
  }
}

export class LegalWorkForbiddenError extends LegalWorkError {
  constructor(message = "You do not have permission to restore this work") {
    super("FORBIDDEN", message, 403);
    this.name = "LegalWorkForbiddenError";
  }
}
