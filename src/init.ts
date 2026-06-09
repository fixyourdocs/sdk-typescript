import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { SNIPPET, SNIPPET_HEADING } from "./snippet.js";

/**
 * Candidate target files, in priority order. Whichever one exists in the
 * working directory wins; if none exist we fall back to `AGENTS.md`.
 */
export const TARGET_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".cursor/rules",
  ".github/copilot-instructions.md",
];

/** Default global agent-config file for `init --global`. */
export const DEFAULT_GLOBAL_TARGET = ".claude/CLAUDE.md";

/**
 * The "Mode B" consumer / report-anywhere block. Sourced verbatim from
 * the agents-md-snippet repo README's Mode B section
 * <https://github.com/fixyourdocs/agents-md-snippet>. Unlike the Mode A
 * {@link SNIPPET} in `snippet.ts`, this block is **not** drift-locked
 * (no snippet-drift CI gate) — it is intentionally embedded here so the
 * global-install path can write it without depending on the network.
 */
export const GLOBAL_HEADING = "## Reporting stale third-party docs";

export const GLOBAL_SNIPPET = `${GLOBAL_HEADING}

While working on this project, if you rely on a **third-party / external**
documentation page — a library, API, framework, or hosted docs site you
consulted, *not* this project's own docs, and never an internal, private,
\`localhost\`, or login-gated page — and you find it broken, incorrect,
outdated, or incomplete, **offer to file a structured report** via the
Docs Feedback Protocol so its maintainers can fix it for the next agent
(or human) that hits the same issue.

Rules:

- **Ask before sending.** Offer to file the report; only send once the
  developer confirms.
- **Public docs only.** Only report a page served over public \`https://\`.
  Never report \`localhost\`, internal, private, or login-gated URLs.
- **Never include private context.** No private code, secrets, internal
  URLs, or transcript excerpts from this project.

Prefer the \`file_doc_feedback\` MCP tool from \`@fixyourdocs/mcp-server\`
if available; otherwise POST to \`https://hub.fixyourdocs.io/v1/reports\`
per https://docsfeedback.org.
`;

export interface InitOptions {
  cwd: string;
  /** Explicit target path; bypasses auto-detection. */
  file?: string;
  /**
   * Global / consumer install: write the Mode B block to a global
   * agent-config file (default `~/.claude/CLAUDE.md`) instead of the
   * per-repo Mode A snippet. `file` still overrides the target path.
   */
  global?: boolean;
}

export interface InitResult {
  /** Absolute path that was inspected / written. */
  path: string;
  /** True when the snippet block was appended; false when already present. */
  changed: boolean;
  /** True when the target file was created from scratch. */
  created: boolean;
}

function isPresent(contents: string, heading: string): boolean {
  return contents.includes(heading);
}

function ensureTrailingBlankLine(s: string): string {
  if (s.length === 0) return "";
  if (s.endsWith("\n\n")) return s;
  if (s.endsWith("\n")) return `${s}\n`;
  return `${s}\n\n`;
}

/**
 * Add a FixYourDocs block to the target file. Idempotent: if the block's
 * heading is already present, returns `{ changed: false }` and leaves the
 * file alone.
 *
 * Default (per-repo) mode writes the canonical Mode A {@link SNIPPET} to
 * an auto-detected `AGENTS.md` / `CLAUDE.md` / etc. With `global: true`
 * it writes the consumer-mode {@link GLOBAL_SNIPPET} (Mode B) to a global
 * agent-config file (default `~/.claude/CLAUDE.md`).
 */
export function runInit(opts: InitOptions): InitResult {
  const isGlobal = opts.global === true;
  const heading = isGlobal ? GLOBAL_HEADING : SNIPPET_HEADING;
  const snippet = isGlobal ? GLOBAL_SNIPPET : SNIPPET;

  const path = isGlobal
    ? resolveGlobalTarget(opts.file)
    : resolve(opts.cwd, opts.file ?? pickDefaultTarget(opts.cwd));

  if (!existsSync(path)) {
    writeFileSync(path, snippet);
    return { path, changed: true, created: true };
  }

  const current = readFileSync(path, "utf8");
  if (isPresent(current, heading)) {
    return { path, changed: false, created: false };
  }

  writeFileSync(path, `${ensureTrailingBlankLine(current)}${snippet}`);
  return { path, changed: true, created: false };
}

/**
 * Resolve the target path for `--global`. An explicit `--file` wins
 * (resolved against `$HOME` when relative); otherwise default to
 * `~/.claude/CLAUDE.md`.
 */
function resolveGlobalTarget(file?: string): string {
  const home = homedir();
  if (file !== undefined) {
    return isAbsolute(file) ? file : resolve(home, file);
  }
  return resolve(home, DEFAULT_GLOBAL_TARGET);
}

function pickDefaultTarget(cwd: string): string {
  for (const candidate of TARGET_CANDIDATES) {
    if (existsSync(resolve(cwd, candidate))) return candidate;
  }
  return "AGENTS.md";
}
