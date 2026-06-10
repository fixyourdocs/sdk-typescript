# @fixyourdocs/sdk (TypeScript SDK)

Reference TypeScript SDK for the [Docs Feedback Protocol](https://github.com/fixyourdocs/protocol).
The protocol lets AI agents file structured reports against documentation
when the docs break agent task flows.

- Full docs: <https://docs.fixyourdocs.io/sdk/typescript/>.
- Spec: <https://docsfeedback.org>.
- Why this exists: [the FixYourDocs manifesto](https://github.com/fixyourdocs/manifesto/blob/main/MANIFESTO.md).

## Install

```sh
npm install @fixyourdocs/sdk
```

Requires Node.js 20 or later (the SDK uses the built-in global `fetch`).
No runtime dependencies.

## CLI

The package ships a `fixyourdocs` binary covering the two one-liners
from the [agents-md-snippet](https://github.com/fixyourdocs/agents-md-snippet)
README:

```sh
# Adds the canonical AGENTS.md block to your repo. Idempotent.
npx @fixyourdocs/sdk init

# Sends a single report to the Hub.
npx @fixyourdocs/sdk report \
  --doc-url https://example.com/docs/install \
  --summary "Install fails on macOS 14" \
  --agent claude-code \
  --kind broken
```

`init` auto-detects `AGENTS.md`, `CLAUDE.md`, `.cursor/rules`, or
`.github/copilot-instructions.md` and appends to whichever exists
(falling back to creating `AGENTS.md`). Pass `--file <path>` to override.

`report` accepts `--details`, `--suggested-fix`, `--api-url`, `--token`,
and `--json` for machine-readable output. Exit codes: `0` success,
`2` user error (unknown / missing flag), `1` transport or server error.

### Consumer mode (`init --global`)

```sh
# Writes a "report stale third-party docs" block to your GLOBAL agent
# config (default ~/.claude/CLAUDE.md), so any project you work on can
# offer to report broken external docs. Idempotent.
npx @fixyourdocs/sdk init --global
```

Pass `--file <path>` to target a different global config file (a relative
path resolves against `$HOME`). This is distinct from the per-repo `init`,
which adds the project-docs feedback block to `AGENTS.md` / `CLAUDE.md`.

## Consumer-mode client options

When an agent reports against arbitrary third-party docs (rather than its
own project's docs), three `ClientOptions` keep that safe. All are on by
default:

| Option              | Default | Behaviour                                                                                                                                              |
| ------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `enforcePrivacy`    | `true`  | Refuse (throw `PrivacyError`, no network call) when `doc_url` is not a public HTTPS page — `http://`, `localhost`/`.local`/`.internal`, bare hostnames, or loopback/private/link-local IPs. |
| `includeTranscript` | `false` | When `false`, omit `task_context.transcript_excerpt` from the POST body (and drop `task_context` if that empties it). The caller's object is not mutated. |
| `discoverOptOut`    | `true`  | Before posting, GET `https://<doc-host>/.well-known/docs-feedback.json`; an `opt_in: false` response throws `OptedOutError` with no POST. Cached per host for 24h. |

```ts
const client = new Client({
  apiUrl: "https://hub.fixyourdocs.io",
  // defaults shown; pass to override
  enforcePrivacy: true,
  includeTranscript: false,
  discoverOptOut: true,
});
```

## Quick start

```ts
import { Client, buildReport } from "@fixyourdocs/sdk";

const client = new Client({
  apiUrl: "https://hub.fixyourdocs.io",
  // token: "<opaque-bearer-token>", // optional — only needed if the endpoint requires auth
});

const report = buildReport({
  docUrl: "https://docs.example.com/s3/quickstart",
  summary:
    "ListBuckets returns AccessDenied with the IAM policy from the quickstart.",
  kind: "incorrect",
  agentName: "claude-code",
  agentVersion: "1.4.2",
  agentVendor: "Anthropic",
  evidence: [
    { kind: "attempted_action", text: "aws s3 ls" },
    {
      kind: "error_message",
      text: "An error occurred (AccessDenied) when calling the ListBuckets operation",
    },
  ],
  suggestedFix: "Add `s3:ListAllMyBuckets` to the policy in step 3.",
});

const result = await client.send(report);
console.log(result.id, result.isDuplicate ? "(duplicate)" : "(new)");
```

## Advanced: build the wire-format object directly

If you prefer to construct the nested wire-format object by hand, the
underlying types are exported too:

```ts
import { Client, type Report } from "@fixyourdocs/sdk";

const report: Report = {
  protocol_version: "0",
  doc_url: "https://docs.example.com/getting-started",
  agent: { name: "aider" },
  report: {
    kind: "missing",
    summary: "The page does not document how to set the AIDER_API_KEY env var.",
  },
};

const client = new Client({ apiUrl: "https://hub.fixyourdocs.io" });
await client.send(report, { idempotencyKey: "01HZA4F8PD9YQF1XGM3KQ8E5VR" });
```

## API shape

The protocol's wire format is a nested object: `{ protocol_version,
doc_url, agent: { name, ... }, report: { kind, summary, ... }, ... }`.
The SDK ships two ways to produce it:

- `buildReport({ docUrl, summary, kind, agentName, ... })` — flat,
  ergonomic input. Validates lengths and patterns locally so most
  shape mistakes throw before the network round-trip.
- The exported types (`Report`, `AgentInfo`, `ReportBody`, `Evidence`,
  `TaskContext`) for callers that prefer to build the nested object
  themselves — useful when copying a payload verbatim from another
  source.

Both paths go through `Client.send(report, opts?)`.

## Errors

`Client.send` throws subclasses of `FixYourDocsError`:

| Class                       | HTTP status |
| --------------------------- | ----------- |
| `PrivacyError`              | — (client)  |
| `ValidationError`           | 400         |
| `AuthError`                 | 401         |
| `NotFoundError`             | 404         |
| `OptedOutError`             | 410 / client |
| `PayloadTooLargeError`      | 413         |
| `UnsupportedMediaTypeError` | 415         |
| `PolicyRejectedError`       | 422         |
| `RateLimitedError`          | 429         |
| `ServerError`               | 5xx         |

Where the error response body carries extra context, the typed error
exposes it (`OptedOutError.since`, `PolicyRejectedError.reason`,
`RateLimitedError.retryAfter`, `ValidationError.details`).

The client retries once on 502 / 503 / 504. It does not auto-retry on
429 — callers should respect `RateLimitedError.retryAfter`.

`PrivacyError` and `OptedOutError` can also be thrown **client-side**,
before any POST: `PrivacyError` from the privacy guard (`enforcePrivacy`)
and `OptedOutError` from `.well-known` opt-out discovery
(`discoverOptOut`). See [Consumer-mode client options](#consumer-mode-client-options).

## Development

```sh
npm install
npm run lint
npm run typecheck
npm run test
npm run build
```

## Licence

Apache License 2.0 — see [LICENSE](LICENSE).

## Contributing

Contributions require a DCO sign-off and a signed Apache Individual Contributor
License Agreement — see [CONTRIBUTING.md](CONTRIBUTING.md).
