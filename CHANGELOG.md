# Changelog

## v0.3.0 — 2026-06-09

Consumer / report-anywhere mode. New `ClientOptions` make it safe for an
agent to report against arbitrary third-party docs without leaking
private context or pestering hosts that have opted out.

- **Privacy guard (`enforcePrivacy`, default `true`).** `Client.send`
  now refuses — before any network call — to report a `doc_url` that is
  not a public HTTPS page: plaintext `http://`, `localhost` / `.local` /
  `.internal` hosts, bare single-label hostnames, and IP literals in
  loopback / private / link-local ranges (IPv4 and IPv6, including
  IPv4-mapped IPv6). Throws the new `PrivacyError`. Set `false` to skip.
- **Transcript stripping (`includeTranscript`, default `false`).**
  `task_context.transcript_excerpt` is omitted from the POST body by
  default (and `task_context` is dropped if that leaves it empty). The
  caller's report object is never mutated. Set `true` to send as-is.
- **`.well-known` opt-out discovery (`discoverOptOut`, default `true`).**
  Before posting, the client GETs
  `https://<doc-host>/.well-known/docs-feedback.json`; an
  `opt_in: false` response makes `send` throw `OptedOutError` with no
  POST. Results are cached per host in-memory for 24h. Network errors are
  treated as "no opt-out" and are not cached. v0 honours opt-out +
  default-hub only; a custom `endpoint` in the well-known is not yet
  honoured.
- **`fixyourdocs init --global`.** Writes the consumer-mode "report stale
  third-party docs" block to a global agent-config file (default
  `~/.claude/CLAUDE.md`; override with `--file`). Idempotent. The
  per-repo canonical snippet is unchanged.

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
