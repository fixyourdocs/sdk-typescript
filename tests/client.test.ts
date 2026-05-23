import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import {
  AuthError,
  Client,
  PolicyRejectedError,
  RateLimitedError,
  ServerError,
  ValidationError,
  buildReport,
} from "../src/index.js";
import type { Report } from "../src/index.js";

const API_BASE = "https://hub.example.test";
const ENDPOINT = `${API_BASE}/v1/reports`;

const server = setupServer();

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function sampleReport(): Report {
  return buildReport({
    docUrl: "https://docs.example.com/getting-started",
    summary: "The page does not document how to set the AIDER_API_KEY env var.",
    kind: "missing",
    agentName: "aider",
  });
}

describe("Client.send", () => {
  it("returns isDuplicate=false on 201", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            id: "rep_01HZA4F8PD9YQF1XGM3KQ8E5VR",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        ),
      ),
    );
    const client = new Client({ apiUrl: API_BASE });
    const res = await client.send(sampleReport());
    expect(res.isDuplicate).toBe(false);
    expect(res.id).toBe("rep_01HZA4F8PD9YQF1XGM3KQ8E5VR");
    expect(res.received_at).toBe("2026-06-06T12:34:56Z");
    expect(res.protocol_version).toBe("0");
    expect(res.server_capabilities).toEqual([]);
  });

  it("returns isDuplicate=true on 200", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            id: "rep_dupe",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: ["cap.example"],
          },
          { status: 200 },
        ),
      ),
    );
    const client = new Client({ apiUrl: API_BASE });
    const res = await client.send(sampleReport());
    expect(res.isDuplicate).toBe(true);
    expect(res.id).toBe("rep_dupe");
    expect(res.server_capabilities).toEqual(["cap.example"]);
  });

  it("strips trailing slash from apiUrl", async () => {
    let seenUrl = "";
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(
          {
            id: "rep_1",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        );
      }),
    );
    const client = new Client({ apiUrl: `${API_BASE}/` });
    await client.send(sampleReport());
    expect(seenUrl).toBe(ENDPOINT);
  });

  it("sends the expected headers and body shape", async () => {
    let capturedHeaders: Headers | undefined;
    let capturedBody: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        capturedHeaders = request.headers;
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            id: "rep_x",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        );
      }),
    );

    const report = sampleReport();
    const client = new Client({ apiUrl: API_BASE });
    await client.send(report);

    expect(capturedHeaders?.get("content-type")).toBe("application/json");
    expect(capturedHeaders?.get("x-docs-feedback-protocol-version")).toBe("0");
    expect(capturedHeaders?.get("user-agent")).toBe(
      "fixyourdocs-typescript/0.1.0",
    );
    expect(capturedHeaders?.get("authorization")).toBeNull();
    expect(capturedHeaders?.get("idempotency-key")).toBeNull();
    expect(capturedBody).toEqual(report);
  });

  it("adds Authorization only when token is set", async () => {
    let capturedAuth: string | null = null;
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        capturedAuth = request.headers.get("authorization");
        return HttpResponse.json(
          {
            id: "rep_x",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        );
      }),
    );
    const client = new Client({ apiUrl: API_BASE, token: "tok_abc" });
    await client.send(sampleReport());
    expect(capturedAuth).toBe("Bearer tok_abc");
  });

  it("adds Idempotency-Key only when supplied", async () => {
    let capturedKey: string | null = null;
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        capturedKey = request.headers.get("idempotency-key");
        return HttpResponse.json(
          {
            id: "rep_x",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        );
      }),
    );
    const client = new Client({ apiUrl: API_BASE });
    await client.send(sampleReport(), { idempotencyKey: "abc-123" });
    expect(capturedKey).toBe("abc-123");
  });

  it("uses a custom User-Agent when provided", async () => {
    let ua: string | null = null;
    server.use(
      http.post(ENDPOINT, ({ request }) => {
        ua = request.headers.get("user-agent");
        return HttpResponse.json(
          {
            id: "rep_x",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        );
      }),
    );
    const client = new Client({
      apiUrl: API_BASE,
      userAgent: "my-bot/2.0",
    });
    await client.send(sampleReport());
    expect(ua).toBe("my-bot/2.0");
  });

  it("throws ValidationError with parsed details on 400", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            error: "validation_error",
            details: [
              { path: "/report/kind", message: "must be one of [...]" },
              { path: "/doc_url", message: "must match format \"uri\"" },
            ],
          },
          { status: 400 },
        ),
      ),
    );
    const client = new Client({ apiUrl: API_BASE });
    await expect(client.send(sampleReport())).rejects.toMatchObject({
      name: "ValidationError",
      details: [
        { path: "/report/kind", message: "must be one of [...]" },
        { path: "/doc_url", message: 'must match format "uri"' },
      ],
    });
    await expect(client.send(sampleReport())).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("throws AuthError on 401", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json({ error: "auth_required" }, { status: 401 }),
      ),
    );
    const client = new Client({ apiUrl: API_BASE });
    await expect(client.send(sampleReport())).rejects.toBeInstanceOf(AuthError);
  });

  it("throws OptedOutError with since on 410", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          { error: "opted_out", since: "2026-06-01T00:00:00Z" },
          { status: 410 },
        ),
      ),
    );
    const client = new Client({ apiUrl: API_BASE });
    await expect(client.send(sampleReport())).rejects.toMatchObject({
      name: "OptedOutError",
      since: "2026-06-01T00:00:00Z",
    });
  });

  it("throws PolicyRejectedError with reason on 422", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          { error: "policy_rejected", reason: "unknown agent.name" },
          { status: 422 },
        ),
      ),
    );
    const client = new Client({ apiUrl: API_BASE });
    await expect(client.send(sampleReport())).rejects.toMatchObject({
      name: "PolicyRejectedError",
      reason: "unknown agent.name",
    });
    await expect(client.send(sampleReport())).rejects.toBeInstanceOf(
      PolicyRejectedError,
    );
  });

  it("throws RateLimitedError with retryAfter parsed from header on 429", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          { error: "rate_limited" },
          { status: 429, headers: { "Retry-After": "42" } },
        ),
      ),
    );
    const client = new Client({ apiUrl: API_BASE });
    await expect(client.send(sampleReport())).rejects.toMatchObject({
      name: "RateLimitedError",
      retryAfter: 42,
    });
    await expect(client.send(sampleReport())).rejects.toBeInstanceOf(
      RateLimitedError,
    );
  });

  it("retries 503 exactly once and then throws ServerError", async () => {
    let calls = 0;
    server.use(
      http.post(ENDPOINT, () => {
        calls++;
        return HttpResponse.json({ error: "unavailable" }, { status: 503 });
      }),
    );
    const client = new Client({ apiUrl: API_BASE });
    await expect(client.send(sampleReport())).rejects.toBeInstanceOf(
      ServerError,
    );
    expect(calls).toBe(2);
  });

  it("recovers when the 503 retry succeeds", async () => {
    let calls = 0;
    server.use(
      http.post(ENDPOINT, () => {
        calls++;
        if (calls === 1) {
          return HttpResponse.json({ error: "unavailable" }, { status: 503 });
        }
        return HttpResponse.json(
          {
            id: "rep_after_retry",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        );
      }),
    );
    const client = new Client({ apiUrl: API_BASE });
    const res = await client.send(sampleReport());
    expect(res.id).toBe("rep_after_retry");
    expect(res.isDuplicate).toBe(false);
    expect(calls).toBe(2);
  });

  it("does NOT auto-retry on 429", async () => {
    let calls = 0;
    server.use(
      http.post(ENDPOINT, () => {
        calls++;
        return HttpResponse.json({ error: "rate_limited" }, { status: 429 });
      }),
    );
    const client = new Client({ apiUrl: API_BASE });
    await expect(client.send(sampleReport())).rejects.toBeInstanceOf(
      RateLimitedError,
    );
    expect(calls).toBe(1);
  });
});
