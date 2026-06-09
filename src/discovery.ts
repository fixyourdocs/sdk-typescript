/**
 * `.well-known/docs-feedback.json` opt-out discovery for consumer mode.
 *
 * Before posting a report about a third-party doc, the SDK checks
 * whether the doc's host has published an opt-out at
 * `https://<host>/.well-known/docs-feedback.json` with `opt_in: false`.
 * If so the report is refused client-side (no POST is made).
 *
 * Results are cached per host, in-memory, for 24h.
 *
 * v0 scope: opt-out check + default-hub fallback ONLY. A custom
 * `endpoint` advertised by an `opt_in: true` well-known is intentionally
 * NOT honoured yet — the caller always posts to its configured `apiUrl`.
 */

import { OptedOutError } from "./errors.js";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const WELL_KNOWN_PATH = "/.well-known/docs-feedback.json";
const DISCOVERY_TIMEOUT_MS = 5000;

interface CacheEntry {
  optIn: boolean;
  since?: string;
  /** Epoch ms when this entry was stored; used for TTL expiry. */
  storedAt: number;
}

/**
 * Per-instance, in-memory opt-out cache keyed by host. Construct one per
 * {@link Client} so caches do not leak across clients.
 */
export class OptOutCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(host: string, now: number): CacheEntry | undefined {
    const entry = this.entries.get(host);
    if (entry === undefined) return undefined;
    if (now - entry.storedAt >= CACHE_TTL_MS) {
      this.entries.delete(host);
      return undefined;
    }
    return entry;
  }

  set(host: string, value: Omit<CacheEntry, "storedAt">, now: number): void {
    this.entries.set(host, { ...value, storedAt: now });
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Resolve opt-out for the host of `docUrl`. Throws {@link OptedOutError}
 * when the host has opted out; otherwise returns normally.
 *
 * Behaviour per the protocol (§5.2):
 *  - cache hit `optIn:false` → throw without fetching
 *  - cache hit `optIn:true`  → return without fetching
 *  - 200 + `opt_in:false`    → cache + throw
 *  - 200 + otherwise         → cache opt-in, return
 *  - 404 / non-2xx / bad JSON → cache "absent" (opt-in), return
 *  - network error / timeout / abort → treat as absent, DO NOT cache, return
 */
export async function assertNotOptedOut(
  docUrl: string,
  fetchImpl: typeof fetch,
  cache: OptOutCache,
  now: number = Date.now(),
): Promise<void> {
  const host = new URL(docUrl).host;

  const cached = cache.get(host, now);
  if (cached !== undefined) {
    if (!cached.optIn) {
      throw optedOut(host, cached.since);
    }
    return;
  }

  const wellKnownUrl = `https://${host}${WELL_KNOWN_PATH}`;

  let response: Response;
  try {
    response = await fetchImpl(wellKnownUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      // Nice-to-have abort; absence of AbortSignal.timeout is tolerated.
      signal:
        typeof AbortSignal !== "undefined" &&
        typeof AbortSignal.timeout === "function"
          ? AbortSignal.timeout(DISCOVERY_TIMEOUT_MS)
          : undefined,
    });
  } catch {
    // Network error / timeout / abort → treat as absent, do not cache.
    return;
  }

  if (!response.ok) {
    // 404 / non-2xx → opt-out absent. Cache as opt-in.
    cache.set(host, { optIn: true }, now);
    return;
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    // Invalid JSON → treat as absent. Cache as opt-in.
    cache.set(host, { optIn: true }, now);
    return;
  }

  if (isObject(parsed) && parsed.opt_in === false) {
    const since = typeof parsed.since === "string" ? parsed.since : undefined;
    cache.set(host, { optIn: false, since }, now);
    throw optedOut(host, since);
  }

  // TODO(v0.x): honour custom endpoint from well-known (opt_in:true +
  // endpoint). For now we always post to the configured apiUrl.

  cache.set(host, { optIn: true }, now);
}

function optedOut(host: string, since?: string): OptedOutError {
  return new OptedOutError(
    `doc host ${host} has opted out (${WELL_KNOWN_PATH} opt_in:false)`,
    since,
  );
}
