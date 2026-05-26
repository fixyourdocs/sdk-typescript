/**
 * Integration test for the `fixyourdocs` bin entrypoint.
 *
 * Regression guard for the silent-no-op bug: when installed via npm,
 * the bin is exposed as a symlink at `node_modules/.bin/fixyourdocs`
 * pointing at `dist/cli.js`. The previous `isMain` heuristic compared
 * `process.argv[1]` literally against `endsWith("/cli.js")`, which
 * never matched the symlink path — so `npx fixyourdocs --version`
 * silently exited 0 with no output. This test packs the SDK, installs
 * it into a temp project, and asserts the symlinked bin prints the
 * version.
 *
 * The test runs a real `npm install` against a local tarball so it is
 * a bit slower than the unit tests (~5–15s on a warm cache). It is
 * still much cheaper than the network-touching e2e suite.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VERSION } from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");

// File-symlink semantics differ on Windows; the bin shim is a `.cmd`
// wrapper rather than a POSIX symlink, so the realpath-resolution
// regression this test guards against does not apply there.
const SKIP_WIN = process.platform === "win32";

describe.skipIf(SKIP_WIN)("fixyourdocs bin (packed + installed)", () => {
  let workdir: string;
  let binPath: string;

  beforeAll(() => {
    // 1) Pack the SDK from the repo root into a temp dir.
    workdir = mkdtempSync(join(tmpdir(), "fyd-bin-test-"));

    // `npm run build` is a prerequisite — `npm pack` packages whatever
    // is in `dist/` per `files` in package.json. Run build defensively
    // so the test passes from a clean checkout too.
    execFileSync("npm", ["run", "build"], {
      cwd: REPO_ROOT,
      stdio: "pipe",
    });

    const packOut = execFileSync(
      "npm",
      ["pack", "--pack-destination", workdir, "--json"],
      { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] },
    ).toString();
    const packInfo = JSON.parse(packOut) as Array<{ filename: string }>;
    const first = packInfo[0];
    if (!first) throw new Error("npm pack produced no tarball");
    const tarball = join(workdir, first.filename);
    expect(existsSync(tarball)).toBe(true);

    // 2) Install the tarball into a fresh project in another temp dir.
    const projectDir = join(workdir, "project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "package.json"),
      JSON.stringify(
        { name: "fyd-bin-test-fixture", version: "0.0.0", private: true },
        null,
        2,
      ),
    );
    execFileSync("npm", ["install", "--no-audit", "--no-fund", tarball], {
      cwd: projectDir,
      stdio: "pipe",
    });

    binPath = join(projectDir, "node_modules", ".bin", "fixyourdocs");
    expect(existsSync(binPath)).toBe(true);
  }, 120_000);

  afterAll(() => {
    if (workdir) {
      rmSync(workdir, { recursive: true, force: true });
    }
  });

  it("prints the version when invoked via the symlinked bin", () => {
    const result = spawnSync(binPath, ["--version"], {
      encoding: "utf8",
      // Inherit PATH so the `#!/usr/bin/env node` shebang resolves.
      env: process.env,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(VERSION);
    expect(result.stderr).toBe("");
  }, 15_000);

  it("prints usage on --help via the symlinked bin", () => {
    const result = spawnSync(binPath, ["--help"], {
      encoding: "utf8",
      env: process.env,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage: fixyourdocs/);
  }, 15_000);
});
