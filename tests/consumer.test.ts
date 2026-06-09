import { describe, expect, it, vi } from "vitest";

import {
  Client,
  OptedOutError,
  PrivacyError,
  buildReport,
} from "../src/index.js";
import type { Report } from "../src/index.js";

/** First argument type of the global `fetch`. */
type FetchInput = Parameters<typeof fetch>[0];

const API_BASE = "https://hub.example.test";
const ENDPOINT = `${API_BASE}/v1/reports`;

function reportFor(docUrl: string, withTranscript = false): Report {
  return buildReport({
    docUrl,
    summary: "ListBuckets returns AccessDenied with the quickstart policy.",
    kind: "incorrect",
    agentName: "claude-code",
    taskContext: withTranscript
      ? {
          task_summary: "wiring up S3 access",
          transcript_excerpt: "secret internal chatter that must not leak",
        }
      : undefined,
  });
}

/** A `fetch` mock that 201s on the POST and 404s on any well-known GET. */
function okFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (input: FetchInput) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/.well-known/docs-feedback.json")) {
      return new Response(null, { status: 404 });
    }
    return new Response(
      JSON.stringify({
        id: "rep_ok",
        received_at: "2026-06-09T00:00:00Z",
        protocol_version: "0",
        server_capabilities: [],
      }),
      { status: 201, headers: { "content-type": "application/json" } },
    );
  });
}

describe("privacy guard (enforcePrivacy)", () => {
  const refusedUrls = [
    "http://docs.example.com/page", // not https
    "https://localhost/docs",
    "https://wiki.local/page",
    "https://app.internal/docs",
    "https://127.0.0.1/docs",
    "https://10.0.0.1/docs",
    "https://172.16.5.4/docs",
    "https://192.168.1.1/docs",
    "https://169.254.1.1/docs",
    "https://[::1]/docs",
    "https://[fe80::1]/docs",
    "https://[fc00::1]/docs",
    "https://[::ffff:127.0.0.1]/docs",
    "https://intranet/docs", // bare single-label hostname
  ];

  for (const url of refusedUrls) {
    it(`refuses ${url} and makes NO fetch`, async () => {
      const fetchImpl = okFetch();
      const client = new Client({ apiUrl: API_BASE, fetch: fetchImpl });
      await expect(client.send(reportFor(url))).rejects.toBeInstanceOf(
        PrivacyError,
      );
      expect(fetchImpl).not.toHaveBeenCalled();
    });
  }

  it("allows a public https doc URL", async () => {
    const fetchImpl = okFetch();
    const client = new Client({ apiUrl: API_BASE, fetch: fetchImpl });
    const res = await client.send(
      reportFor("https://docs.example.com/s3/quickstart"),
    );
    expect(res.id).toBe("rep_ok");
  });

  it("allows a public IPv4 literal", async () => {
    const fetchImpl = okFetch();
    const client = new Client({ apiUrl: API_BASE, fetch: fetchImpl });
    const res = await client.send(reportFor("https://93.184.216.34/docs"));
    expect(res.id).toBe("rep_ok");
  });

  it("skips the guard when enforcePrivacy is false", async () => {
    const fetchImpl = okFetch();
    const client = new Client({
      apiUrl: API_BASE,
      fetch: fetchImpl,
      enforcePrivacy: false,
      discoverOptOut: false,
    });
    const res = await client.send(reportFor("https://localhost/docs"));
    expect(res.id).toBe("rep_ok");
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});

describe("transcript stripping (includeTranscript)", () => {
  async function capturePostBody(opts: {
    includeTranscript?: boolean;
  }): Promise<Record<string, unknown>> {
    let posted: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/docs-feedback.json")) {
        return new Response(null, { status: 404 });
      }
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "rep_ok",
          received_at: "2026-06-09T00:00:00Z",
          protocol_version: "0",
          server_capabilities: [],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    const client = new Client({
      apiUrl: API_BASE,
      fetch: fetchImpl,
      includeTranscript: opts.includeTranscript,
    });
    await client.send(reportFor("https://docs.example.com/p", true));
    return posted;
  }

  it("omits transcript_excerpt by default and drops empty task_context", async () => {
    const body = await capturePostBody({});
    const ctx = body.task_context as Record<string, unknown> | undefined;
    expect(ctx?.transcript_excerpt).toBeUndefined();
    expect(ctx?.task_summary).toBe("wiring up S3 access");
  });

  it("drops task_context entirely when only transcript was present", async () => {
    let posted: Record<string, unknown> = {};
    const fetchImpl = vi.fn(async (input: FetchInput, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/.well-known/docs-feedback.json")) {
        return new Response(null, { status: 404 });
      }
      posted = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(
        JSON.stringify({
          id: "rep_ok",
          received_at: "2026-06-09T00:00:00Z",
          protocol_version: "0",
          server_capabilities: [],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    const report = buildReport({
      docUrl: "https://docs.example.com/p",
      summary: "x summary that is long enough",
      kind: "other",
      agentName: "claude-code",
      taskContext: { transcript_excerpt: "leaky transcript" },
    });
    const client = new Client({ apiUrl: API_BASE, fetch: fetchImpl });
    await client.send(report);
    expect("task_context" in posted).toBe(false);
    // Caller's object is not mutated.
    expect(report.task_context?.transcript_excerpt).toBe("leaky transcript");
  });

  it("includes transcript_excerpt when includeTranscript is true", async () => {
    const body = await capturePostBody({ includeTranscript: true });
    const ctx = body.task_context as Record<string, unknown>;
    expect(ctx.transcript_excerpt).toBe(
      "secret internal chatter that must not leak",
    );
  });
});

describe("opt-out discovery (discoverOptOut)", () => {
  const DOC = "https://docs.example.com/page";
  const WELL_KNOWN = "https://docs.example.com/.well-known/docs-feedback.json";

  function makeFetch(
    wellKnown: () => Response,
  ): { fn: ReturnType<typeof vi.fn>; posts: number } {
    const state = { posts: 0 };
    const fn = vi.fn(async (input: FetchInput) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === WELL_KNOWN) return wellKnown();
      if (url === ENDPOINT) {
        state.posts++;
        return new Response(
          JSON.stringify({
            id: "rep_ok",
            received_at: "2026-06-09T00:00:00Z",
            protocol_version: "0",
            server_capabilities: [],
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected url ${url}`);
    });
    return { fn, get posts() { return state.posts; } };
  }

  it("throws OptedOutError and does NOT POST when opt_in:false", async () => {
    const { fn } = makeFetch(() =>
      new Response(JSON.stringify({ opt_in: false, since: "2026-01-01" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new Client({ apiUrl: API_BASE, fetch: fn });
    await expect(client.send(reportFor(DOC))).rejects.toMatchObject({
      name: "OptedOutError",
      since: "2026-01-01",
    });
    await expect(client.send(reportFor(DOC))).rejects.toBeInstanceOf(
      OptedOutError,
    );
    // No POST to the endpoint ever happened.
    const postCalls = fn.mock.calls.filter(
      (c) => String(c[0]) === ENDPOINT,
    );
    expect(postCalls).toHaveLength(0);
  });

  it("posts when opt_in:true", async () => {
    const probe = makeFetch(() =>
      new Response(JSON.stringify({ opt_in: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = new Client({ apiUrl: API_BASE, fetch: probe.fn });
    const res = await client.send(reportFor(DOC));
    expect(res.id).toBe("rep_ok");
    expect(probe.posts).toBe(1);
  });

  it("posts when the well-known is absent (404)", async () => {
    const probe = makeFetch(() => new Response(null, { status: 404 }));
    const client = new Client({ apiUrl: API_BASE, fetch: probe.fn });
    const res = await client.send(reportFor(DOC));
    expect(res.id).toBe("rep_ok");
    expect(probe.posts).toBe(1);
  });

  it("caches an opt-out: a second send does NOT re-fetch the well-known", async () => {
    const fn = vi.fn(async (input: FetchInput) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === WELL_KNOWN) {
        return new Response(JSON.stringify({ opt_in: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(null, { status: 201 });
    });
    const client = new Client({ apiUrl: API_BASE, fetch: fn });
    await expect(client.send(reportFor(DOC))).rejects.toBeInstanceOf(
      OptedOutError,
    );
    await expect(client.send(reportFor(DOC))).rejects.toBeInstanceOf(
      OptedOutError,
    );
    const wellKnownCalls = fn.mock.calls.filter(
      (c) => String(c[0]) === WELL_KNOWN,
    );
    // Only fetched once despite two sends — second was a cache hit.
    expect(wellKnownCalls).toHaveLength(1);
  });

  it("does not cache a network error (re-fetches next time)", async () => {
    let wellKnownHits = 0;
    const fn = vi.fn(async (input: FetchInput) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === WELL_KNOWN) {
        wellKnownHits++;
        throw new TypeError("network down");
      }
      return new Response(
        JSON.stringify({
          id: "rep_ok",
          received_at: "2026-06-09T00:00:00Z",
          protocol_version: "0",
          server_capabilities: [],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    const client = new Client({ apiUrl: API_BASE, fetch: fn });
    await client.send(reportFor(DOC));
    await client.send(reportFor(DOC));
    expect(wellKnownHits).toBe(2);
  });

  it("skips discovery entirely when discoverOptOut is false", async () => {
    let wellKnownHits = 0;
    const fn = vi.fn(async (input: FetchInput) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === WELL_KNOWN) {
        wellKnownHits++;
      }
      return new Response(
        JSON.stringify({
          id: "rep_ok",
          received_at: "2026-06-09T00:00:00Z",
          protocol_version: "0",
          server_capabilities: [],
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      );
    });
    const client = new Client({
      apiUrl: API_BASE,
      fetch: fn,
      discoverOptOut: false,
    });
    const res = await client.send(reportFor(DOC));
    expect(res.id).toBe("rep_ok");
    expect(wellKnownHits).toBe(0);
  });
});
