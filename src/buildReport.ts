import { FixYourDocsError } from "./errors.js";
import type {
  BuildReportInput,
  Evidence,
  Report,
  ReportBody,
  AgentInfo,
} from "./types.js";

const AGENT_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]+$/;
const LOCALE_PATTERN = /^[A-Za-z]{1,8}(-[A-Za-z0-9]{1,8})*$/;
const CAPABILITY_PATTERN = /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

function assertMaxLength(name: string, value: string, max: number): void {
  if (value.length > max) {
    throw new FixYourDocsError(
      `${name} exceeds maximum length of ${max} characters (got ${value.length})`,
    );
  }
}

function assertMinLength(name: string, value: string, min: number): void {
  if (value.length < min) {
    throw new FixYourDocsError(
      `${name} must be at least ${min} character(s) long`,
    );
  }
}

function validateEvidence(evidence: Evidence[]): void {
  if (evidence.length > 20) {
    throw new FixYourDocsError(
      `evidence exceeds maximum of 20 items (got ${evidence.length})`,
    );
  }
  for (const [i, item] of evidence.entries()) {
    assertMinLength(`evidence[${i}].text`, item.text, 1);
    assertMaxLength(`evidence[${i}].text`, item.text, 4000);
  }
}

/**
 * Build a v0 wire-format {@link Report} from a flat, ergonomic input.
 *
 * Performs the same length / pattern checks the JSON Schema enforces,
 * so most server-side `400`s surface as a local throw instead.
 * Throws {@link FixYourDocsError} on any violation.
 */
export function buildReport(input: BuildReportInput): Report {
  // agent.name
  if (!AGENT_NAME_PATTERN.test(input.agentName)) {
    throw new FixYourDocsError(
      `agentName "${input.agentName}" does not match required pattern ` +
        `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`,
    );
  }
  assertMaxLength("agentName", input.agentName, 64);

  // doc_url
  assertMinLength("docUrl", input.docUrl, 1);
  assertMaxLength("docUrl", input.docUrl, 2048);

  // summary
  assertMinLength("summary", input.summary, 1);
  assertMaxLength("summary", input.summary, 500);

  if (input.agentVersion !== undefined) {
    assertMaxLength("agentVersion", input.agentVersion, 64);
  }
  if (input.agentVendor !== undefined) {
    assertMaxLength("agentVendor", input.agentVendor, 128);
  }
  if (input.details !== undefined) {
    assertMaxLength("details", input.details, 8000);
  }
  if (input.suggestedFix !== undefined) {
    assertMaxLength("suggestedFix", input.suggestedFix, 4000);
  }
  if (input.evidence !== undefined) {
    validateEvidence(input.evidence);
  }
  if (input.idempotencyKey !== undefined) {
    assertMinLength("idempotencyKey", input.idempotencyKey, 1);
    assertMaxLength("idempotencyKey", input.idempotencyKey, 128);
    if (!IDEMPOTENCY_KEY_PATTERN.test(input.idempotencyKey)) {
      throw new FixYourDocsError(
        "idempotencyKey must be ASCII-printable (0x21–0x7e)",
      );
    }
  }
  if (input.locale !== undefined) {
    assertMaxLength("locale", input.locale, 35);
    if (!LOCALE_PATTERN.test(input.locale)) {
      throw new FixYourDocsError(
        `locale "${input.locale}" is not a valid BCP-47 tag`,
      );
    }
  }
  if (input.taskContext?.task_summary !== undefined) {
    assertMaxLength(
      "taskContext.task_summary",
      input.taskContext.task_summary,
      500,
    );
  }
  if (input.taskContext?.transcript_excerpt !== undefined) {
    assertMaxLength(
      "taskContext.transcript_excerpt",
      input.taskContext.transcript_excerpt,
      4000,
    );
  }
  if (input.clientCapabilities !== undefined) {
    if (input.clientCapabilities.length > 32) {
      throw new FixYourDocsError(
        `clientCapabilities exceeds maximum of 32 items (got ${input.clientCapabilities.length})`,
      );
    }
    for (const [i, cap] of input.clientCapabilities.entries()) {
      assertMaxLength(`clientCapabilities[${i}]`, cap, 64);
      if (!CAPABILITY_PATTERN.test(cap)) {
        throw new FixYourDocsError(
          `clientCapabilities[${i}] "${cap}" is not a valid capability token`,
        );
      }
    }
  }

  const agent: AgentInfo = { name: input.agentName };
  if (input.agentVersion !== undefined) agent.version = input.agentVersion;
  if (input.agentVendor !== undefined) agent.vendor = input.agentVendor;

  const reportBody: ReportBody = {
    kind: input.kind,
    summary: input.summary,
  };
  if (input.details !== undefined) reportBody.details = input.details;
  if (input.evidence !== undefined) reportBody.evidence = input.evidence;
  if (input.suggestedFix !== undefined) {
    reportBody.suggested_fix = input.suggestedFix;
  }

  const report: Report = {
    protocol_version: "0",
    doc_url: input.docUrl,
    agent,
    report: reportBody,
  };
  if (input.taskContext !== undefined) report.task_context = input.taskContext;
  if (input.idempotencyKey !== undefined) {
    report.idempotency_key = input.idempotencyKey;
  }
  if (input.submittedAt !== undefined) report.submitted_at = input.submittedAt;
  if (input.locale !== undefined) report.locale = input.locale;
  if (input.clientCapabilities !== undefined) {
    report.client_capabilities = input.clientCapabilities;
  }

  return report;
}
