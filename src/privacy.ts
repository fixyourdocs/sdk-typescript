/**
 * Client-side privacy guard for consumer / report-anywhere mode.
 *
 * Refuses to send a report when `doc_url` does not point at a public
 * HTTPS documentation page — i.e. it is plaintext HTTP, a local /
 * private / link-gated host, or an IP literal in a non-public range.
 * This keeps an agent operating in "report any third-party doc" mode
 * from leaking the existence of internal hosts to the Hub.
 *
 * Dependency-free by design: IP classification is implemented inline so
 * the SDK keeps zero runtime dependencies.
 */

import { PrivacyError } from "./errors.js";

/** Hostname suffixes that always denote a non-public host. */
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal"];

function isIpv4Literal(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (p.length === 0 || p.length > 3) return false;
    if (!/^[0-9]+$/.test(p)) return false;
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

function ipv4Octets(host: string): number[] {
  return host.split(".").map((p) => Number(p));
}

/** True when an IPv4 literal is loopback / private / link-local. */
function isPrivateIpv4(host: string): boolean {
  const [a, b] = ipv4Octets(host);
  if (a === undefined || b === undefined) return false;
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  return false;
}

/**
 * Normalise a `new URL().hostname` for an IPv6 literal: strip the
 * surrounding brackets if present.
 */
function stripIpv6Brackets(host: string): string {
  if (host.startsWith("[") && host.endsWith("]")) {
    return host.slice(1, -1);
  }
  return host;
}

function looksLikeIpv6(host: string): boolean {
  return host.includes(":");
}

/**
 * Classify an IPv6 literal as loopback / link-local / unique-local, or
 * an IPv4-mapped form whose embedded IPv4 is private.
 */
function isPrivateIpv6(raw: string): boolean {
  const host = stripIpv6Brackets(raw).toLowerCase();

  // Loopback ::1 (also tolerate a leading-zero spelling).
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

  // IPv4-mapped / IPv4-embedded forms with a dotted tail, e.g.
  // ::ffff:127.0.0.1 or ::127.0.0.1.
  const lastColon = host.lastIndexOf(":");
  if (lastColon !== -1) {
    const tail = host.slice(lastColon + 1);
    if (isIpv4Literal(tail) && isPrivateIpv4(tail)) return true;
  }

  // IPv4-mapped form after WHATWG-URL normalisation, where the embedded
  // IPv4 is serialised as two hex hextets, e.g. ::ffff:7f00:1 for
  // ::ffff:127.0.0.1. Decode the last two hextets back to dotted v4.
  const mapped = embeddedIpv4FromMapped(host);
  if (mapped !== undefined && isPrivateIpv4(mapped)) return true;

  // Work on the first hextet for the prefix-based ranges below.
  const firstGroup = host.split(":")[0] ?? "";
  const first = Number.parseInt(firstGroup || "0", 16);
  if (Number.isNaN(first)) return false;

  // Link-local fe80::/10  → first 10 bits are 1111 1110 10.
  if ((first & 0xffc0) === 0xfe80) return true;
  // Unique-local fc00::/7 → first 7 bits are 1111 110.
  if ((first & 0xfe00) === 0xfc00) return true;

  return false;
}

/**
 * For an IPv4-mapped IPv6 address whose embedded IPv4 was normalised to
 * two hex hextets (e.g. `::ffff:7f00:1`), return the dotted-quad IPv4
 * string (`127.0.0.1`). Returns `undefined` when `host` is not such a
 * `::ffff:`-prefixed mapped address.
 */
function embeddedIpv4FromMapped(host: string): string | undefined {
  // Normalise: split out the hextets, accounting for the leading "::".
  const idx = host.indexOf("ffff:");
  if (idx === -1) return undefined;
  // Must be the IPv4-mapped prefix ::ffff: (i.e. preceded only by ":").
  const prefix = host.slice(0, idx);
  if (prefix !== "::" && prefix !== "0:0:0:0:0:") return undefined;
  const rest = host.slice(idx + "ffff:".length);
  const groups = rest.split(":");
  if (groups.length !== 2) return undefined;
  const hi = Number.parseInt(groups[0] ?? "", 16);
  const lo = Number.parseInt(groups[1] ?? "", 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return undefined;
  if (hi < 0 || hi > 0xffff || lo < 0 || lo > 0xffff) return undefined;
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

/**
 * Throw {@link PrivacyError} unless `docUrl` is a public HTTPS doc page.
 *
 * Rejection rules (see P0-18):
 *  - scheme is not `https`
 *  - empty host
 *  - host is `localhost`, or ends with `.localhost` / `.local` / `.internal`
 *  - host is a bare single-label hostname (no dot) that is not an IP literal
 *  - host is an IP literal in a non-public range (v4 loopback/private/link-local,
 *    v6 loopback/link-local/unique-local, and IPv4-mapped-IPv6 private forms)
 */
export function assertPublicDocUrl(docUrl: string): void {
  let url: URL;
  try {
    url = new URL(docUrl);
  } catch {
    throw new PrivacyError(
      `doc_url "${docUrl}" is not a valid absolute URL; refusing to report`,
    );
  }

  if (url.protocol !== "https:") {
    throw new PrivacyError(
      `doc_url must use https:// (got "${url.protocol}//"); refusing to report a non-public-HTTPS page`,
    );
  }

  const rawHost = url.hostname;
  if (rawHost.length === 0) {
    throw new PrivacyError("doc_url has an empty host; refusing to report");
  }

  const host = rawHost.toLowerCase();

  if (host === "localhost") {
    throw new PrivacyError(
      `doc_url host "${rawHost}" is local; refusing to report`,
    );
  }
  for (const suffix of PRIVATE_SUFFIXES) {
    if (host.endsWith(suffix)) {
      throw new PrivacyError(
        `doc_url host "${rawHost}" is a private / local host; refusing to report`,
      );
    }
  }

  // IPv6 literal (URL hostname keeps the brackets).
  if (looksLikeIpv6(rawHost)) {
    if (isPrivateIpv6(rawHost)) {
      throw new PrivacyError(
        `doc_url host "${rawHost}" is a non-public IPv6 address; refusing to report`,
      );
    }
    return;
  }

  // IPv4 literal.
  if (isIpv4Literal(host)) {
    if (isPrivateIpv4(host)) {
      throw new PrivacyError(
        `doc_url host "${rawHost}" is a non-public IPv4 address; refusing to report`,
      );
    }
    return;
  }

  // Bare single-label hostname (no dot) that is not an IP literal — e.g.
  // an intranet shortname like "wiki".
  if (!host.includes(".")) {
    throw new PrivacyError(
      `doc_url host "${rawHost}" is a bare hostname (no public domain); refusing to report`,
    );
  }
}
