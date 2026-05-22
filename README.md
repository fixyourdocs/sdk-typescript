# @fixyourdocs/sdk (TypeScript SDK)

![Status: scaffolding](https://img.shields.io/badge/status-scaffolding-orange)

Reference TypeScript SDK for the [Docs Feedback Protocol](https://github.com/fixyourdocs/protocol).
The protocol lets AI agents file structured reports against documentation
when the docs break agent task flows. Spec: <https://docsfeedback.org>.

## Install

```sh
npm install @fixyourdocs/sdk
```

The npm package name (`@fixyourdocs/sdk`) will be claimed before first release.
The current `0.0.0` build is a placeholder — the wire-format implementation
lands per the v0 spec.

## Hello world

```ts
import { version } from "@fixyourdocs/sdk";

console.log(version);
```

## Licence

Apache License 2.0 — see [LICENSE](LICENSE).

## Contributing

Contributions require a DCO sign-off and a signed Apache Individual Contributor
License Agreement — see [CONTRIBUTING.md](CONTRIBUTING.md).
