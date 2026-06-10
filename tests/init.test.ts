import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GLOBAL_HEADING, GLOBAL_SNIPPET, runInit } from "../src/init.js";
import { SNIPPET, SNIPPET_HEADING } from "../src/snippet.js";

describe("runInit", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "fyd-init-"));
  });

  afterEach(() => {
    // Tests stay self-contained — the mkdtemp dirs are tiny and the OS
    // cleans them up; no rmSync here to keep failure forensics easy.
  });

  it("creates AGENTS.md from scratch when nothing exists", () => {
    const result = runInit({ cwd });
    expect(result.created).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.path).toBe(join(cwd, "AGENTS.md"));
    expect(readFileSync(result.path, "utf8")).toBe(SNIPPET);
  });

  it("appends to an existing AGENTS.md", () => {
    const path = join(cwd, "AGENTS.md");
    writeFileSync(path, "# My repo\n\nDo things.");
    const result = runInit({ cwd });
    expect(result.created).toBe(false);
    expect(result.changed).toBe(true);
    const after = readFileSync(path, "utf8");
    expect(after.startsWith("# My repo\n\nDo things.")).toBe(true);
    expect(after).toContain(SNIPPET_HEADING);
  });

  it("is idempotent — running twice leaves the file untouched", () => {
    runInit({ cwd });
    const path = join(cwd, "AGENTS.md");
    const first = readFileSync(path, "utf8");
    const result = runInit({ cwd });
    expect(result.changed).toBe(false);
    expect(readFileSync(path, "utf8")).toBe(first);
  });

  it("prefers CLAUDE.md when only CLAUDE.md exists", () => {
    const path = join(cwd, "CLAUDE.md");
    writeFileSync(path, "# Claude rules\n");
    const result = runInit({ cwd });
    expect(result.path).toBe(path);
    expect(readFileSync(path, "utf8")).toContain(SNIPPET_HEADING);
  });

  it("prefers AGENTS.md when both AGENTS.md and CLAUDE.md exist", () => {
    writeFileSync(join(cwd, "AGENTS.md"), "# Agents\n");
    writeFileSync(join(cwd, "CLAUDE.md"), "# Claude\n");
    const result = runInit({ cwd });
    expect(result.path).toBe(join(cwd, "AGENTS.md"));
  });

  it("targets .cursor/rules when present", () => {
    mkdirSync(join(cwd, ".cursor"));
    const path = join(cwd, ".cursor/rules");
    writeFileSync(path, "Be polite.\n");
    const result = runInit({ cwd });
    expect(result.path).toBe(path);
    expect(readFileSync(path, "utf8")).toContain(SNIPPET_HEADING);
  });

  it("honours an explicit --file override", () => {
    const path = join(cwd, "INSTRUCTIONS.md");
    const result = runInit({ cwd, file: "INSTRUCTIONS.md" });
    expect(result.path).toBe(path);
    expect(result.created).toBe(true);
  });
});

describe("runInit --global", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "fyd-init-global-"));
  });

  it("writes the Mode B block to an absolute --file target", () => {
    const target = join(cwd, "GLOBAL.md");
    const result = runInit({ cwd, global: true, file: target });
    expect(result.created).toBe(true);
    expect(result.changed).toBe(true);
    expect(result.path).toBe(target);
    const written = readFileSync(target, "utf8");
    expect(written).toBe(GLOBAL_SNIPPET);
    expect(written).toContain(GLOBAL_HEADING);
    // It is the consumer block, not the per-repo Mode A snippet.
    expect(written).not.toContain(SNIPPET_HEADING);
    // Must never claim it is about "this repository".
    expect(written).not.toContain("this repository");
  });

  it("creates missing parent directories for the global target", () => {
    // First-time `--global` users have no ~/.claude dir yet; the write must
    // not throw ENOENT.
    const target = join(cwd, "nested", "deeper", "CLAUDE.md");
    const result = runInit({ cwd, global: true, file: target });
    expect(result.created).toBe(true);
    expect(readFileSync(target, "utf8")).toBe(GLOBAL_SNIPPET);
  });

  it("is idempotent on re-run", () => {
    const target = join(cwd, "GLOBAL.md");
    runInit({ cwd, global: true, file: target });
    const first = readFileSync(target, "utf8");
    const result = runInit({ cwd, global: true, file: target });
    expect(result.changed).toBe(false);
    expect(readFileSync(target, "utf8")).toBe(first);
  });

  it("appends to an existing global file without duplicating", () => {
    const target = join(cwd, "GLOBAL.md");
    writeFileSync(target, "# My global agent config\n");
    const result = runInit({ cwd, global: true, file: target });
    expect(result.created).toBe(false);
    expect(result.changed).toBe(true);
    const after = readFileSync(target, "utf8");
    expect(after.startsWith("# My global agent config\n")).toBe(true);
    expect(after).toContain(GLOBAL_HEADING);
  });
});
