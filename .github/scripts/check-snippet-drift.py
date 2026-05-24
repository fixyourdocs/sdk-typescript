#!/usr/bin/env python3
"""Verify the vendored AGENTS.md snippet matches the canonical upstream.

Pulls https://raw.githubusercontent.com/fixyourdocs/agents-md-snippet/main/README.md,
extracts the fenced ```markdown block, hashes it, and compares to the
SHA-256 of the SNIPPET constant exported by ``src/snippet.ts``.

Run from the repo root:

    python3 .github/scripts/check-snippet-drift.py

Exit code 0 on match, 1 on drift.
"""

from __future__ import annotations

import hashlib
import pathlib
import re
import sys
import urllib.request

UPSTREAM_RAW = (
    "https://raw.githubusercontent.com/fixyourdocs/agents-md-snippet/main/README.md"
)
ROOT = pathlib.Path(__file__).resolve().parents[2]
VENDORED = ROOT / "src" / "snippet.ts"


def fail(msg: str) -> "None":
    print(f"snippet-drift: {msg}", file=sys.stderr)
    sys.exit(1)


def fetch_upstream_block() -> str:
    with urllib.request.urlopen(UPSTREAM_RAW, timeout=30) as resp:
        text = resp.read().decode("utf-8")
    matches = re.findall(r"```markdown\n(.*?)\n```", text, flags=re.DOTALL)
    if len(matches) != 1:
        fail(
            f"upstream README must contain exactly one ```markdown block; "
            f"found {len(matches)}"
        )
    return matches[0]


def extract_vendored_block(path: pathlib.Path) -> str:
    text = path.read_text()
    # Match: export const SNIPPET = `...`; with the heading interpolation.
    match = re.search(
        r"export const SNIPPET = `(\$\{SNIPPET_HEADING\}\n.*?)`;",
        text,
        flags=re.DOTALL,
    )
    if not match:
        fail(f"could not find `export const SNIPPET = ` in {path.relative_to(ROOT)}")
    raw = match.group(1)
    # Substitute the heading interpolation and decode TS string escapes.
    raw = raw.replace("${SNIPPET_HEADING}", "## Documentation feedback")
    raw = raw.replace("\\\\", "\\")
    raw = raw.replace("\\`", "`")
    return raw.rstrip("\n")


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def main() -> "None":
    upstream = fetch_upstream_block()
    vendored = extract_vendored_block(VENDORED)
    if upstream == vendored:
        print(f"snippet-drift: in sync (sha256 {sha256(upstream)[:12]}…)")
        return

    u = sha256(upstream)
    v = sha256(vendored)
    diff_pos = next(
        (i for i, (a, b) in enumerate(zip(upstream, vendored)) if a != b),
        min(len(upstream), len(vendored)),
    )
    fail(
        "vendored snippet has drifted from the upstream block.\n"
        f"  upstream sha256: {u}\n"
        f"  vendored sha256: {v}\n"
        f"  first byte diff at offset {diff_pos}:\n"
        f"    upstream: {upstream[max(0, diff_pos - 16): diff_pos + 64]!r}\n"
        f"    vendored: {vendored[max(0, diff_pos - 16): diff_pos + 64]!r}\n"
        "Re-vendor src/snippet.ts from "
        "https://github.com/fixyourdocs/agents-md-snippet (README block)."
    )


if __name__ == "__main__":
    main()
