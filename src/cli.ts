/**
 * `fixyourdocs` CLI — the `init` + `report` one-liners.
 *
 * Exit codes:
 *   0 — success.
 *   2 — user / argument error (unknown flag, missing required flag,
 *       unknown subcommand, malformed value).
 *   1 — transport / server error (network failure, 4xx/5xx from the hub).
 */

import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { Client } from "./client.js";
import { buildReport } from "./buildReport.js";
import { FixYourDocsError } from "./errors.js";
import { VERSION } from "./index.js";
import { runInit } from "./init.js";
import type { ReportKind } from "./types.js";

const DEFAULT_API_URL = "https://hub.fixyourdocs.io";
const USAGE = `Usage: fixyourdocs <command> [options]

Commands:
  init                Append the canonical AGENTS.md block to your repo.
  report              Send a Docs Feedback Protocol v0 report to the Hub.

Options:
  -h, --help          Show help for fixyourdocs or a subcommand.
  -v, --version       Print the CLI version.

Run "fixyourdocs <command> --help" for command-specific options.`;

const INIT_USAGE = `Usage: fixyourdocs init [options]

Adds the canonical AGENTS.md block to your repo. If an existing
AGENTS.md / CLAUDE.md / .cursor/rules / .github/copilot-instructions.md
is found, the block is appended to that file; otherwise AGENTS.md is
created.

With --global, writes the consumer-mode "report stale third-party docs"
block to your GLOBAL agent config (default ~/.claude/CLAUDE.md) instead,
so any project you work on can offer to report broken external docs.

Options:
  --global            Write the consumer-mode block to your global agent
                      config (default ~/.claude/CLAUDE.md). Idempotent.
  --file <path>       Explicit target file (skips auto-detection; under
                      --global a relative path resolves against $HOME).
  --json              Emit machine-readable JSON instead of plain text.
  -h, --help          Show this message.`;

const REPORT_USAGE = `Usage: fixyourdocs report [options]

Sends a single Docs Feedback Protocol v0 report to the Hub.

Required:
  --doc-url <url>     URL or path of the documentation the agent was reading.
  --summary <text>    One-line description of the problem (≤ 500 chars).
  --agent <name>      Agent identifier (e.g. claude-code, cursor, aider).

Optional:
  --kind <kind>       One of: broken, incorrect, outdated, missing,
                      unclear, other. Default: other.
  --details <text>    Longer description (≤ 8000 chars).
  --suggested-fix <text>
                      Suggested resolution (≤ 4000 chars).
  --api-url <url>     Hub base URL. Default: ${DEFAULT_API_URL}.
  --token <token>     Bearer token, if the Hub requires auth.
  --json              Emit machine-readable JSON instead of plain text.
  -h, --help          Show this message.`;

const REPORT_KINDS: readonly ReportKind[] = [
  "broken",
  "incorrect",
  "outdated",
  "missing",
  "unclear",
  "other",
];

export interface CliIO {
  stdout: (line: string) => void;
  stderr: (line: string) => void;
}

interface ParsedArgs {
  flags: Map<string, string>;
  switches: Set<string>;
}

class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UsageError";
  }
}

function parseArgs(
  argv: readonly string[],
  knownFlags: readonly string[],
  knownSwitches: readonly string[],
): ParsedArgs {
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    if (knownSwitches.includes(arg)) {
      switches.add(arg);
      continue;
    }
    if (knownFlags.includes(arg)) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`flag ${arg} requires a value`);
      }
      flags.set(arg, value);
      i++;
      continue;
    }
    throw new UsageError(`unknown argument: ${arg}`);
  }
  return { flags, switches };
}

function requireFlag(args: ParsedArgs, name: string): string {
  const v = args.flags.get(name);
  if (v === undefined || v.length === 0) {
    throw new UsageError(`missing required flag: ${name}`);
  }
  return v;
}

function asReportKind(value: string): ReportKind {
  if ((REPORT_KINDS as readonly string[]).includes(value)) {
    return value as ReportKind;
  }
  throw new UsageError(
    `--kind must be one of: ${REPORT_KINDS.join(", ")} (got "${value}")`,
  );
}

async function runReport(
  argv: readonly string[],
  io: CliIO,
): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    io.stdout(REPORT_USAGE);
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(
      argv,
      [
        "--doc-url",
        "--summary",
        "--agent",
        "--kind",
        "--details",
        "--suggested-fix",
        "--api-url",
        "--token",
      ],
      ["--json"],
    );
  } catch (err) {
    io.stderr(
      `error: ${err instanceof Error ? err.message : String(err)}`,
    );
    io.stderr(REPORT_USAGE);
    return 2;
  }

  let docUrl: string;
  let summary: string;
  let agentName: string;
  let kind: ReportKind = "other";
  try {
    docUrl = requireFlag(parsed, "--doc-url");
    summary = requireFlag(parsed, "--summary");
    agentName = requireFlag(parsed, "--agent");
    const rawKind = parsed.flags.get("--kind");
    if (rawKind !== undefined) kind = asReportKind(rawKind);
  } catch (err) {
    io.stderr(
      `error: ${err instanceof Error ? err.message : String(err)}`,
    );
    io.stderr(REPORT_USAGE);
    return 2;
  }

  const apiUrl = parsed.flags.get("--api-url") ?? DEFAULT_API_URL;
  const token = parsed.flags.get("--token");
  const details = parsed.flags.get("--details");
  const suggestedFix = parsed.flags.get("--suggested-fix");
  const wantJson = parsed.switches.has("--json");

  let report;
  try {
    report = buildReport({
      docUrl,
      summary,
      kind,
      agentName,
      details,
      suggestedFix,
    });
  } catch (err) {
    io.stderr(
      `error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 2;
  }

  const client = new Client({
    apiUrl,
    token,
    userAgent: `fixyourdocs-cli/${VERSION}`,
  });
  try {
    const result = await client.send(report);
    if (wantJson) {
      io.stdout(
        JSON.stringify({
          id: result.id,
          received_at: result.received_at,
          is_duplicate: result.isDuplicate,
        }),
      );
    } else {
      const label = result.isDuplicate ? "Duplicate report" : "Report accepted";
      io.stdout(`${label}: ${result.id}`);
    }
    return 0;
  } catch (err) {
    const msg = err instanceof FixYourDocsError ? err.message : String(err);
    if (wantJson) {
      io.stdout(
        JSON.stringify({
          error: err instanceof Error ? err.name : "error",
          message: msg,
        }),
      );
    } else {
      io.stderr(`error: ${msg}`);
    }
    return 1;
  }
}

async function runInitCommand(
  argv: readonly string[],
  io: CliIO,
): Promise<number> {
  if (argv.includes("-h") || argv.includes("--help")) {
    io.stdout(INIT_USAGE);
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, ["--file"], ["--json", "--global"]);
  } catch (err) {
    io.stderr(
      `error: ${err instanceof Error ? err.message : String(err)}`,
    );
    io.stderr(INIT_USAGE);
    return 2;
  }

  const isGlobal = parsed.switches.has("--global");
  const result = runInit({
    cwd: process.cwd(),
    file: parsed.flags.get("--file"),
    global: isGlobal,
  });

  const what = isGlobal
    ? "consumer-mode (third-party docs) block"
    : "FixYourDocs snippet";

  if (parsed.switches.has("--json")) {
    io.stdout(
      JSON.stringify({
        path: result.path,
        changed: result.changed,
        created: result.created,
        global: isGlobal,
      }),
    );
  } else if (result.created) {
    io.stdout(`Created ${result.path} with the ${what}.`);
  } else if (result.changed) {
    io.stdout(`Appended the ${what} to ${result.path}.`);
  } else {
    io.stdout(`No changes — ${what} already present in ${result.path}.`);
  }
  return 0;
}

/**
 * Entry point used by both the binary and the tests. Returns the
 * process exit code; never calls `process.exit` directly.
 */
export async function runCli(
  argv: readonly string[],
  io: CliIO = { stdout: console.log, stderr: console.error },
): Promise<number> {
  const first = argv[0];
  if (first === undefined || first === "-h" || first === "--help") {
    io.stdout(USAGE);
    return 0;
  }
  if (first === "-v" || first === "--version") {
    io.stdout(VERSION);
    return 0;
  }
  const rest = argv.slice(1);
  switch (first) {
    case "init":
      return runInitCommand(rest, io);
    case "report":
      return runReport(rest, io);
    default:
      io.stderr(`error: unknown command "${first}"`);
      io.stderr(USAGE);
      return 2;
  }
}

// Only auto-run when executed as a script (node dist/cli.js …), not when
// imported by tests.
//
// When installed via npm, the `fixyourdocs` bin is exposed as a symlink at
// `node_modules/.bin/fixyourdocs` pointing at `dist/cli.js`. In that case
// `process.argv[1]` is the symlink path, not the resolved target, so a
// literal compare against `import.meta.url`'s path — or an `endsWith("/cli.js")`
// — never matches and the CLI silently exits 0. Resolve the symlink with
// `realpathSync` and compare URLs, falling back to `false` on any failure
// (e.g. ENOENT) so importing this module from tests stays a no-op.
const isMain = (() => {
  if (typeof process === "undefined") return false;
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    const resolved = realpathSync(entry);
    return import.meta.url === pathToFileURL(resolved).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  runCli(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: unknown) => {
      console.error(
        `fatal: ${err instanceof Error ? err.stack ?? err.message : String(err)}`,
      );
      process.exit(1);
    },
  );
}
