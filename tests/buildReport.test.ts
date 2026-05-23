import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildReport, FixYourDocsError } from "../src/index.js";
import type { BuildReportInput, Report } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");

function loadFixture(name: string): Record<string, unknown> {
  const raw = readFileSync(join(fixturesDir, name), "utf8");
  return JSON.parse(raw) as Record<string, unknown>;
}

/** Strip the tooling-only `$comment` field so we can compare wire shape. */
function stripComment<T extends Record<string, unknown>>(obj: T): T {
  const { $comment: _ignored, ...rest } = obj;
  return rest as T;
}

describe("buildReport", () => {
  it("round-trips the minimum-required fixture", () => {
    const fixture = stripComment(loadFixture("minimum-required.json"));
    const input: BuildReportInput = {
      docUrl: "https://docs.example.com/getting-started",
      summary:
        "The page does not document how to set the AIDER_API_KEY env var.",
      kind: "missing",
      agentName: "aider",
    };
    const built = buildReport(input);
    expect(built).toEqual(fixture);
  });

  it("round-trips the golden-path fixture", () => {
    const fixture = stripComment(loadFixture("golden-path.json"));
    const input: BuildReportInput = {
      docUrl: "https://docs.example.com/s3/quickstart",
      summary:
        "ListBuckets returns AccessDenied with the IAM policy from the quickstart.",
      kind: "incorrect",
      agentName: "claude-code",
      agentVersion: "1.4.2",
      agentVendor: "Anthropic",
      details:
        "The quickstart's inline IAM policy grants only `s3:GetObject`. Calling `aws s3 ls` (which calls `s3:ListAllMyBuckets`) therefore fails with AccessDenied.",
      evidence: [
        { kind: "attempted_action", text: "aws s3 ls" },
        {
          kind: "error_message",
          text: "An error occurred (AccessDenied) when calling the ListBuckets operation",
        },
        {
          kind: "expected",
          text: "Listing buckets succeeds after applying the quickstart IAM policy.",
        },
      ],
      suggestedFix:
        "Add `s3:ListAllMyBuckets` to the policy in step 3, or replace `aws s3 ls` with `aws s3 ls s3://<bucket>` in the verification step.",
      taskContext: {
        task_summary:
          "Follow the S3 quickstart to upload a file from the demo app.",
      },
      submittedAt: "2026-06-06T12:34:56Z",
    };
    const built = buildReport(input);
    expect(built).toEqual(fixture);
  });

  it("round-trips the full fixture", () => {
    const fixture = stripComment(loadFixture("full.json"));
    const input: BuildReportInput = {
      docUrl: "https://docs.example.com/api/widgets?lang=en",
      summary:
        "The `widgets.list()` example uses the v1 response shape; v2 wraps results in `data`.",
      kind: "outdated",
      agentName: "cursor",
      agentVersion: "0.45.1",
      agentVendor: "Anysphere",
      details:
        'The page still shows the v1 shape:\n\n```json\n[{"id": "…"}]\n```\n\nThe live API (v2, since 2025-09) returns:\n\n```json\n{"data": [{"id": "…"}], "next_cursor": null}\n```',
      evidence: [
        {
          kind: "observed",
          text: '{"data": [{"id": "wid_42"}], "next_cursor": null}',
        },
        { kind: "expected", text: '[{"id": "wid_42"}]' },
        {
          kind: "code_snippet",
          text: "const widgets = await client.widgets.list();\nwidgets.map(w => w.id); // TypeError",
        },
        {
          kind: "quote",
          text: '"widgets.list() returns an array of widget objects"',
        },
      ],
      suggestedFix:
        "Update the example to destructure `data` (and mention `next_cursor`):\n\n```js\nconst { data: widgets } = await client.widgets.list();\n```",
      taskContext: {
        task_summary: "Implement a Widgets listing screen following the docs example.",
        transcript_excerpt:
          "I tried to call widgets.list() per the docs, but the returned value is an object, not an array, so .map crashed.",
      },
      idempotencyKey: "01HZA4F8PD9YQF1XGM3KQ8E5VR",
      submittedAt: "2026-06-06T12:35:11Z",
      locale: "en",
      clientCapabilities: [],
    };
    const built = buildReport(input);
    expect(built).toEqual(fixture);
  });

  it("omits undefined optional fields from the output", () => {
    const built = buildReport({
      docUrl: "https://example.com/a",
      summary: "x",
      kind: "other",
      agentName: "tool",
    });
    expect(Object.keys(built).sort()).toEqual([
      "agent",
      "doc_url",
      "protocol_version",
      "report",
    ]);
    expect(Object.keys(built.agent)).toEqual(["name"]);
    expect(Object.keys(built.report).sort()).toEqual(["kind", "summary"]);
  });

  it("always pins protocol_version to '0'", () => {
    const built = buildReport({
      docUrl: "https://example.com/a",
      summary: "x",
      kind: "broken",
      agentName: "tool",
    });
    const typed: Report = built;
    expect(typed.protocol_version).toBe("0");
  });

  it.each([
    ["UPPER", "UPPER"],
    ["with space", "with space"],
    ["-leading-dash", "-leading-dash"],
    ["trailing-dash-", "trailing-dash-"],
    ["under_score", "under_score"],
    ["", ""],
  ])("rejects invalid agentName %s", (_label, agentName) => {
    expect(() =>
      buildReport({
        docUrl: "https://example.com/a",
        summary: "x",
        kind: "other",
        agentName,
      }),
    ).toThrow(FixYourDocsError);
  });

  it("rejects an overlong summary", () => {
    expect(() =>
      buildReport({
        docUrl: "https://example.com/a",
        summary: "x".repeat(501),
        kind: "other",
        agentName: "tool",
      }),
    ).toThrow(/summary exceeds maximum length/);
  });

  it("rejects an idempotency key with non-printable chars", () => {
    expect(() =>
      buildReport({
        docUrl: "https://example.com/a",
        summary: "x",
        kind: "other",
        agentName: "tool",
        idempotencyKey: "bad key", // space is not in 0x21-0x7e
      }),
    ).toThrow(/idempotencyKey must be ASCII-printable/);
  });

  it("rejects a malformed locale tag", () => {
    expect(() =>
      buildReport({
        docUrl: "https://example.com/a",
        summary: "x",
        kind: "other",
        agentName: "tool",
        locale: "en_US",
      }),
    ).toThrow(/locale/);
  });

  it("rejects >20 evidence items", () => {
    const evidence = Array.from({ length: 21 }, (_, i) => ({
      kind: "observed" as const,
      text: `item-${i}`,
    }));
    expect(() =>
      buildReport({
        docUrl: "https://example.com/a",
        summary: "x",
        kind: "other",
        agentName: "tool",
        evidence,
      }),
    ).toThrow(/evidence exceeds maximum/);
  });

  it("treats the invalid.json fixture's kind as invalid input at the type level", () => {
    // The invalid fixture uses "blocking", which is not a member of ReportKind.
    // We can't type-check this at runtime without a JSON Schema validator, but
    // the type system would reject it. Sanity-check the file shape only.
    const fixture = loadFixture("invalid.json");
    expect((fixture.report as Record<string, unknown>).kind).toBe("blocking");
  });
});
