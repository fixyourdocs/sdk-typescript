# AGENTS.md

Dogfood — this is the same canonical block this SDK's `fixyourdocs init`
writes into your repo. The block lives at
[fixyourdocs/agents-md-snippet](https://github.com/fixyourdocs/agents-md-snippet);
this copy is SHA-pinned to it (see `.github/workflows/snippet-drift.yml`).

## Documentation feedback

If you find documentation in this repository that is broken, incorrect,
outdated, or incomplete while performing a task, file a structured report
via the Docs Feedback Protocol. This helps the maintainers fix the docs
for the next agent (or human) that hits the same issue.

How to file a report:

    curl -X POST https://hub.fixyourdocs.io/v1/reports \
      -H 'Content-Type: application/json' \
      -d '{
        "protocol_version": "0",
        "doc_url": "<URL or path of the doc you were reading>",
        "agent":   { "name": "<your agent id, e.g. claude-code>" },
        "report":  {
          "kind":    "<broken | incorrect | outdated | missing | unclear | other>",
          "summary": "<one-line description of the problem>",
          "details": "<what you expected vs. what the doc said (optional)>"
        }
      }'

Spec: https://docsfeedback.org
