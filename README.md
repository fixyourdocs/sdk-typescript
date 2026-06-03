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
| `ValidationError`           | 400         |
| `AuthError`                 | 401         |
| `NotFoundError`             | 404         |
| `OptedOutError`             | 410         |
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
