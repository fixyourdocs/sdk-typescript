import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";

import { runCli } from "../src/cli.js";
import { VERSION } from "../src/index.js";
import { SNIPPET_HEADING } from "../src/snippet.js";

const API_BASE = "https://hub.example.test";
const ENDPOINT = `${API_BASE}/v1/reports`;
const server = setupServer();

// The report subcommand reports against example.com docs; with opt-out
// discovery on by default, each send() makes a .well-known GET. Answer it
// with a 404 (no opt-out) so the POST proceeds.
const DEFAULT_HANDLERS = [
  http.get(
    "https://example.com/.well-known/docs-feedback.json",
    () => new HttpResponse(null, { status: 404 }),
  ),
];

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
beforeEach(() => server.use(...DEFAULT_HANDLERS));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function captureIO() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    out,
    err,
  };
}

describe("runCli — top-level", () => {
  it("--version prints the package version and exits 0", async () => {
    const io = captureIO();
    const code = await runCli(["--version"], io);
    expect(code).toBe(0);
    expect(io.out).toEqual([VERSION]);
  });

  it("--help prints usage and exits 0", async () => {
    const io = captureIO();
    const code = await runCli(["--help"], io);
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("Usage: fixyourdocs");
  });

  it("returns 2 on unknown subcommand", async () => {
    const io = captureIO();
    const code = await runCli(["bogus"], io);
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain('unknown command "bogus"');
  });
});

describe("runCli — init", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), "fyd-cli-")));
    originalCwd = process.cwd();
    process.chdir(cwd);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it("creates AGENTS.md and prints a friendly message", async () => {
    const io = captureIO();
    const code = await runCli(["init"], io);
    expect(code).toBe(0);
    const written = readFileSync(join(cwd, "AGENTS.md"), "utf8");
    expect(written).toContain(SNIPPET_HEADING);
    expect(io.out.join("\n")).toContain("Created");
  });

  it("--json emits machine-readable output", async () => {
    const io = captureIO();
    const code = await runCli(["init", "--json"], io);
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out[0] ?? "") as {
      path: string;
      changed: boolean;
      created: boolean;
    };
    expect(parsed.created).toBe(true);
    expect(parsed.changed).toBe(true);
    expect(parsed.path).toBe(join(cwd, "AGENTS.md"));
  });

  it("is idempotent on second run", async () => {
    await runCli(["init"], captureIO());
    const io = captureIO();
    const code = await runCli(["init"], io);
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("No changes");
  });

  it("rejects unknown flags with exit code 2", async () => {
    const io = captureIO();
    const code = await runCli(["init", "--nope"], io);
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("unknown argument");
  });

  it("--global --file writes the Mode B block; idempotent on re-run", async () => {
    const target = join(cwd, "GLOBAL.md");
    const io1 = captureIO();
    const code1 = await runCli(["init", "--global", "--file", target], io1);
    expect(code1).toBe(0);
    const written = readFileSync(target, "utf8");
    expect(written).toContain("## Reporting stale third-party docs");
    expect(written).not.toContain("## Documentation feedback");
    expect(written).not.toContain("this repository");
    expect(io1.out.join("\n")).toContain("Created");

    const io2 = captureIO();
    const code2 = await runCli(["init", "--global", "--file", target], io2);
    expect(code2).toBe(0);
    expect(io2.out.join("\n")).toContain("No changes");
  });

  it("--global --json reports the global flag", async () => {
    const target = join(cwd, "GLOBAL.md");
    const io = captureIO();
    const code = await runCli(
      ["init", "--global", "--file", target, "--json"],
      io,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out[0] ?? "") as {
      path: string;
      global: boolean;
      created: boolean;
    };
    expect(parsed.global).toBe(true);
    expect(parsed.created).toBe(true);
    expect(parsed.path).toBe(target);
  });
});

describe("runCli — report", () => {
  it("sends a report and prints the returned id", async () => {
    let captured: unknown;
    server.use(
      http.post(ENDPOINT, async ({ request }) => {
        captured = await request.json();
        return HttpResponse.json(
          {
            id: "rep_cli_01",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        );
      }),
    );
    const io = captureIO();
    const code = await runCli(
      [
        "report",
        "--api-url",
        API_BASE,
        "--doc-url",
        "https://example.com/docs/install",
        "--summary",
        "Install fails on macOS 14",
        "--agent",
        "claude-code",
        "--kind",
        "broken",
      ],
      io,
    );
    expect(code).toBe(0);
    expect(io.out.join("\n")).toContain("rep_cli_01");
    expect(captured).toMatchObject({
      protocol_version: "0",
      doc_url: "https://example.com/docs/install",
      agent: { name: "claude-code" },
      report: { kind: "broken", summary: "Install fails on macOS 14" },
    });
  });

  it("returns 2 when required flags are missing", async () => {
    const io = captureIO();
    const code = await runCli(["report", "--api-url", API_BASE], io);
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("--doc-url");
  });

  it("returns 2 when --kind is not in the enum", async () => {
    const io = captureIO();
    const code = await runCli(
      [
        "report",
        "--api-url",
        API_BASE,
        "--doc-url",
        "https://example.com/docs",
        "--summary",
        "x",
        "--agent",
        "claude-code",
        "--kind",
        "weird",
      ],
      io,
    );
    expect(code).toBe(2);
    expect(io.err.join("\n")).toContain("--kind must be one of");
  });

  it("returns 1 and surfaces server error on 422", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          { error: "policy_rejected", reason: "unknown agent.name" },
          { status: 422 },
        ),
      ),
    );
    const io = captureIO();
    const code = await runCli(
      [
        "report",
        "--api-url",
        API_BASE,
        "--doc-url",
        "https://example.com/docs",
        "--summary",
        "x",
        "--agent",
        "claude-code",
      ],
      io,
    );
    expect(code).toBe(1);
    expect(io.err.join("\n")).toContain("policy_rejected");
  });

  it("emits JSON when --json is set", async () => {
    server.use(
      http.post(ENDPOINT, () =>
        HttpResponse.json(
          {
            id: "rep_cli_json",
            received_at: "2026-06-06T12:34:56Z",
            protocol_version: "0",
            server_capabilities: [],
          },
          { status: 201 },
        ),
      ),
    );
    const io = captureIO();
    const code = await runCli(
      [
        "report",
        "--api-url",
        API_BASE,
        "--doc-url",
        "https://example.com/docs",
        "--summary",
        "x",
        "--agent",
        "claude-code",
        "--json",
      ],
      io,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out[0] ?? "") as { id: string };
    expect(parsed.id).toBe("rep_cli_json");
  });
});
