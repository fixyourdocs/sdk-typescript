import {
  AuthError,
  FixYourDocsError,
  NotFoundError,
  OptedOutError,
  PayloadTooLargeError,
  PolicyRejectedError,
  RateLimitedError,
  ServerError,
  UnsupportedMediaTypeError,
  ValidationError,
  type ValidationErrorDetail,
} from "./errors.js";
import type { Report, SendResult } from "./types.js";

const DEFAULT_USER_AGENT = "fixyourdocs-typescript/0.2.0";

export interface ClientOptions {
  /**
   * Base URL of the receiving endpoint, e.g. `https://hub.fixyourdocs.io`.
   * The SDK appends `/v1/reports`.
   */
  apiUrl: string;
  /** Optional opaque bearer token. */
  token?: string;
  /** Override the global `fetch`. Useful for tests / Node ≤18 polyfills. */
  fetch?: typeof fetch;
  /** Override the `User-Agent` request header. */
  userAgent?: string;
}

export interface SendOptions {
  /** Override / supply an `Idempotency-Key` request header. */
  idempotencyKey?: string;
}

interface ServerErrorBody {
  error?: string;
  details?: unknown;
  since?: string;
  reason?: string;
  max_bytes?: number;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function parseValidationDetails(raw: unknown): ValidationErrorDetail[] {
  if (!Array.isArray(raw)) return [];
  const out: ValidationErrorDetail[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const path = typeof item.path === "string" ? item.path : "";
    const message = typeof item.message === "string" ? item.message : "";
    out.push({ path, message });
  }
  return out;
}

function throwForStatus(
  status: number,
  body: ServerErrorBody,
  response: Response,
): never {
  const error = body.error ?? "";
  switch (status) {
    case 400:
      throw new ValidationError(
        error || "validation_error",
        parseValidationDetails(body.details),
      );
    case 401:
      throw new AuthError(error || "auth_required");
    case 404:
      throw new NotFoundError(error || "not_found");
    case 410:
      throw new OptedOutError(error || "opted_out", body.since);
    case 413:
      throw new PayloadTooLargeError(
        error || "payload_too_large",
        body.max_bytes,
      );
    case 415:
      throw new UnsupportedMediaTypeError(error || "unsupported_media_type");
    case 422:
      throw new PolicyRejectedError(error || "policy_rejected", body.reason);
    case 429:
      throw new RateLimitedError(
        error || "rate_limited",
        parseRetryAfter(response.headers.get("retry-after")),
      );
    default:
      if (status >= 500) {
        throw new ServerError(error || `server_error_${status}`, status);
      }
      throw new FixYourDocsError(
        `unexpected status ${status}${error ? `: ${error}` : ""}`,
      );
  }
}

/**
 * Minimal HTTP client for the Docs Feedback Protocol v0.
 * One method: {@link Client.send}.
 */
export class Client {
  private readonly endpoint: string;
  private readonly token?: string;
  private readonly fetchImpl: typeof fetch;
  private readonly userAgent: string;

  constructor(opts: ClientOptions) {
    if (typeof opts.apiUrl !== "string" || opts.apiUrl.length === 0) {
      throw new FixYourDocsError("apiUrl is required");
    }
    this.endpoint = `${opts.apiUrl.replace(/\/$/, "")}/v1/reports`;
    this.token = opts.token;
    const f = opts.fetch ?? (globalThis.fetch as typeof fetch | undefined);
    if (typeof f !== "function") {
      throw new FixYourDocsError(
        "no fetch implementation available; pass `fetch` in ClientOptions or run on Node >=20",
      );
    }
    this.fetchImpl = f;
    this.userAgent = opts.userAgent ?? DEFAULT_USER_AGENT;
  }

  /**
   * Submit a report. Retries once on 502 / 503 / 504. Does not auto-retry
   * on 429 — callers should respect `RateLimitedError.retryAfter`.
   */
  async send(report: Report, opts: SendOptions = {}): Promise<SendResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Docs-Feedback-Protocol-Version": "0",
      "User-Agent": this.userAgent,
      Accept: "application/json",
    };
    if (this.token !== undefined) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    if (opts.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = opts.idempotencyKey;
    }
    const body = JSON.stringify(report);

    const doRequest = () =>
      this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body,
      });

    let response: Response;
    try {
      response = await doRequest();
    } catch (err) {
      throw new FixYourDocsError(
        `network error contacting ${this.endpoint}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    if (
      response.status === 502 ||
      response.status === 503 ||
      response.status === 504
    ) {
      // One retry on transient upstream failures.
      try {
        response = await doRequest();
      } catch (err) {
        throw new FixYourDocsError(
          `network error contacting ${this.endpoint} on retry: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    if (response.status === 200 || response.status === 201) {
      const parsed = await parseJson(response);
      if (!isObject(parsed)) {
        throw new FixYourDocsError(
          `server returned ${response.status} with invalid JSON body`,
        );
      }
      const id = typeof parsed.id === "string" ? parsed.id : "";
      const receivedAt =
        typeof parsed.received_at === "string" ? parsed.received_at : "";
      const protocolVersion =
        typeof parsed.protocol_version === "string"
          ? parsed.protocol_version
          : "0";
      const caps = Array.isArray(parsed.server_capabilities)
        ? parsed.server_capabilities.filter(
            (c): c is string => typeof c === "string",
          )
        : [];
      return {
        id,
        received_at: receivedAt,
        protocol_version: protocolVersion,
        server_capabilities: caps,
        isDuplicate: response.status === 200,
      };
    }

    const parsed = await parseJson(response);
    const errBody: ServerErrorBody = isObject(parsed) ? parsed : {};
    throwForStatus(response.status, errBody, response);
  }
}
