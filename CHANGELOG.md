# Changelog

## v0.2.1 — 2026-06-03

- Publish the dropped `View:` CLI line: `fixyourdocs report` no longer
  prints a `View: https://hub.fixyourdocs.io/r/<id>` link (that route
  404s; the code change merged in 0.2.0 but was never released). The Hub
  also retired the public `GET /v1/reports/{id}` read endpoint — the SDK
  is POST-only (`Client.send()`), so this is a release-only change with
  no client API difference.

## v0.2.0 — 2026-05-26

- Add `fixyourdocs init` CLI (appends canonical snippet from `agents-md-snippet` to `AGENTS.md` / `CLAUDE.md` / `.cursor/rules` / `.github/copilot-instructions.md`; idempotent).
- Add `fixyourdocs report` CLI (sends a Docs Feedback Protocol v0 report; supports `--json`, exit codes 0/1/2).
- Embed canonical snippet from `agents-md-snippet`; CI fails on drift.
- Fix `npx fixyourdocs` silently no-op'ing when invoked via the npm bin symlink (`isMain` now resolves the symlink before comparison).

## v0.1.0 — initial release

- Typed client for Docs Feedback Protocol v0.
