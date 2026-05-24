import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

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

export interface InitOptions {
  cwd: string;
  /** Explicit target path; bypasses auto-detection. */
  file?: string;
}

export interface InitResult {
  /** Absolute path that was inspected / written. */
  path: string;
  /** True when the snippet block was appended; false when already present. */
  changed: boolean;
  /** True when the target file was created from scratch. */
  created: boolean;
}

function isSnippetPresent(contents: string): boolean {
  return contents.includes(SNIPPET_HEADING);
}

function ensureTrailingBlankLine(s: string): string {
  if (s.length === 0) return "";
  if (s.endsWith("\n\n")) return s;
  if (s.endsWith("\n")) return `${s}\n`;
  return `${s}\n\n`;
}

/**
 * Add the canonical AGENTS.md block to the target file. Idempotent: if the
 * heading is already present, returns `{ changed: false }` and leaves the
 * file alone.
 */
export function runInit(opts: InitOptions): InitResult {
  const targetRel = opts.file ?? pickDefaultTarget(opts.cwd);
  const path = resolve(opts.cwd, targetRel);

  if (!existsSync(path)) {
    writeFileSync(path, SNIPPET);
    return { path, changed: true, created: true };
  }

  const current = readFileSync(path, "utf8");
  if (isSnippetPresent(current)) {
    return { path, changed: false, created: false };
  }

  writeFileSync(path, `${ensureTrailingBlankLine(current)}${SNIPPET}`);
  return { path, changed: true, created: false };
}

function pickDefaultTarget(cwd: string): string {
  for (const candidate of TARGET_CANDIDATES) {
    if (existsSync(resolve(cwd, candidate))) return candidate;
  }
  return "AGENTS.md";
}
