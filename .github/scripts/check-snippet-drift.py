#!/usr/bin/env python3
"""Verify the vendored AGENTS.md snippet matches the canonical upstream.

Pulls https://raw.githubusercontent.com/fixyourdocs/agents-md-snippet/main/README.md,
extracts the fenced ```markdown block, hashes it, and compares to the
SHA-256 of the SNIPPET constant exported by ``src/snippet.ts``.

Run from the repo root:

    python3 .github/scripts/check-snippet-drift.py

Tolerance for cross-repo content locks: if upstream `main` does not match
but an open PR on `agents-md-snippet` carries a matching block, this exits
0 with a warning. This is the legitimate "the SDK PR re-vendors what the
upstream PR is about to merge" case — the alternative would be that every
content-lock requires manually re-running this job after upstream merges.
Once that upstream PR merges, the warning goes away.

Exit code 0 on match (or matched open PR), 1 on real drift.
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

OWNER = "fixyourdocs"
REPO = "agents-md-snippet"
RAW_TEMPLATE = "https://raw.githubusercontent.com/{owner}/{repo}/{ref}/README.md"
PULLS_URL = f"https://api.github.com/repos/{OWNER}/{REPO}/pulls?state=open&per_page=30"

ROOT = pathlib.Path(__file__).resolve().parents[2]
VENDORED = ROOT / "src" / "snippet.ts"


def fail(msg: str) -> "None":
    print(f"snippet-drift: {msg}", file=sys.stderr)
    sys.exit(1)


def fetch_text(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "snippet-drift"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8")


def fetch_block_at_ref(ref: str) -> "str | None":
    url = RAW_TEMPLATE.format(owner=OWNER, repo=REPO, ref=ref)
    try:
        text = fetch_text(url)
    except urllib.error.HTTPError:
        return None
    matches = re.findall(r"```markdown\n(.*?)\n```", text, flags=re.DOTALL)
    if len(matches) != 1:
        return None
    return matches[0]


def extract_vendored_block(path: pathlib.Path) -> str:
    text = path.read_text()
    match = re.search(
        r"export const SNIPPET = `(\$\{SNIPPET_HEADING\}\n.*?)`;",
        text,
        flags=re.DOTALL,
    )
    if not match:
        fail(f"could not find `export const SNIPPET = ` in {path.relative_to(ROOT)}")
    raw = match.group(1)
    raw = raw.replace("${SNIPPET_HEADING}", "## Documentation feedback")
    raw = raw.replace("\\\\", "\\")
    raw = raw.replace("\\`", "`")
    return raw.rstrip("\n")


def sha256(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def matching_open_pr(vendored: str) -> "dict | None":
    try:
        body = fetch_text(PULLS_URL)
    except urllib.error.HTTPError:
        return None
    prs = json.loads(body)
    for pr in prs:
        ref = pr.get("head", {}).get("ref")
        if not ref:
            continue
        block = fetch_block_at_ref(ref)
        if block is not None and block == vendored:
            return pr
    return None


def main() -> "None":
    upstream = fetch_block_at_ref("main")
    if upstream is None:
        fail("could not extract a single ```markdown block from upstream main README")
    vendored = extract_vendored_block(VENDORED)
    if upstream == vendored:
        print(f"snippet-drift: in sync with main (sha256 {sha256(upstream)[:12]}…)")
        return

    pr = matching_open_pr(vendored)
    if pr is not None:
        print(
            "snippet-drift: WARNING — main is out of sync with the vendored copy, "
            f"but open upstream PR #{pr['number']} ({pr['title']!r}) matches it "
            f"(sha256 {sha256(vendored)[:12]}…).\n"
            "  This is the cross-repo content-lock window. Re-run after that PR "
            "merges to confirm."
        )
        return

    u = sha256(upstream)
    v = sha256(vendored)
    diff_pos = next(
        (i for i, (a, b) in enumerate(zip(upstream, vendored)) if a != b),
        min(len(upstream), len(vendored)),
    )
    fail(
        "vendored snippet has drifted from the upstream block; no open PR "
        "carries a matching block either.\n"
        f"  upstream main sha256: {u}\n"
        f"  vendored sha256:      {v}\n"
        f"  first byte diff at offset {diff_pos}:\n"
        f"    upstream: {upstream[max(0, diff_pos - 16): diff_pos + 64]!r}\n"
        f"    vendored: {vendored[max(0, diff_pos - 16): diff_pos + 64]!r}\n"
        "Re-vendor src/snippet.ts from "
        "https://github.com/fixyourdocs/agents-md-snippet (README block)."
    )


if __name__ == "__main__":
    main()
