/**
 * Typed exceptions raised by the SDK. All extend {@link FixYourDocsError}
 * so callers can `instanceof FixYourDocsError` for a single catch-all.
 */

export class FixYourDocsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixYourDocsError";
  }
}

export interface ValidationErrorDetail {
  path: string;
  message: string;
}

/** HTTP 400 — schema or top-level validation failure. */
export class ValidationError extends FixYourDocsError {
  readonly details: ValidationErrorDetail[];
  constructor(message: string, details: ValidationErrorDetail[] = []) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

/** HTTP 401 — auth required or invalid. */
export class AuthError extends FixYourDocsError {
  constructor(message: string = "auth_required") {
    super(message);
    this.name = "AuthError";
  }
}

/** HTTP 404 — endpoint does not correspond to a known receiving org. */
export class NotFoundError extends FixYourDocsError {
  constructor(message: string = "not_found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** HTTP 410 — receiving organisation has opted out. */
export class OptedOutError extends FixYourDocsError {
  readonly since?: string;
  constructor(message: string = "opted_out", since?: string) {
    super(message);
    this.name = "OptedOutError";
    this.since = since;
  }
}

/** HTTP 413 — body exceeds the server's size limit. */
export class PayloadTooLargeError extends FixYourDocsError {
  readonly maxBytes?: number;
  constructor(message: string = "payload_too_large", maxBytes?: number) {
    super(message);
    this.name = "PayloadTooLargeError";
    this.maxBytes = maxBytes;
  }
}

/** HTTP 415 — Content-Type was not JSON. */
export class UnsupportedMediaTypeError extends FixYourDocsError {
  constructor(message: string = "unsupported_media_type") {
    super(message);
    this.name = "UnsupportedMediaTypeError";
  }
}

/** HTTP 422 — body validated but server rejected on policy. */
export class PolicyRejectedError extends FixYourDocsError {
  readonly reason?: string;
  constructor(message: string = "policy_rejected", reason?: string) {
    super(message);
    this.name = "PolicyRejectedError";
    this.reason = reason;
  }
}

/** HTTP 429 — rate limited. */
export class RateLimitedError extends FixYourDocsError {
  /** Parsed Retry-After header (seconds), if the server provided one. */
  readonly retryAfter?: number;
  constructor(message: string = "rate_limited", retryAfter?: number) {
    super(message);
    this.name = "RateLimitedError";
    this.retryAfter = retryAfter;
  }
}

/** HTTP 5xx — server-side failure or unavailability. */
export class ServerError extends FixYourDocsError {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ServerError";
    this.status = status;
  }
}
