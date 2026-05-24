/**
 * Hand-typed mirror of `schema/v0/report.schema.json` from
 * <https://github.com/fixyourdocs/protocol>. The JSON Schema is
 * normative; these types follow it.
 */

export type ReportKind =
  | "broken"
  | "incorrect"
  | "outdated"
  | "missing"
  | "unclear"
  | "other";

export type EvidenceKind =
  | "error_message"
  | "attempted_action"
  | "expected"
  | "observed"
  | "code_snippet"
  | "quote";

export interface Evidence {
  kind: EvidenceKind;
  text: string;
}

export interface AgentInfo {
  name: string;
  version?: string;
  vendor?: string;
}

export interface ReportBody {
  kind: ReportKind;
  summary: string;
  details?: string;
  evidence?: Evidence[];
  suggested_fix?: string;
}

export interface TaskContext {
  task_summary?: string;
  transcript_excerpt?: string;
}

export interface Report {
  protocol_version: "0";
  doc_url: string;
  agent: AgentInfo;
  report: ReportBody;
  task_context?: TaskContext;
  idempotency_key?: string;
  submitted_at?: string;
  locale?: string;
  client_capabilities?: string[];
}

export interface SendResult {
  id: string;
  received_at: string;
  protocol_version: string;
  server_capabilities: string[];
  /** True when the server returned 200 (duplicate); false on 201 (new). */
  isDuplicate: boolean;
}

/**
 * Ergonomic flat input to {@link buildReport}. Maps to the nested
 * wire-format {@link Report} object.
 */
export interface BuildReportInput {
  docUrl: string;
  summary: string;
  kind: ReportKind;
  agentName: string;
  agentVersion?: string;
  agentVendor?: string;
  details?: string;
  evidence?: Evidence[];
  suggestedFix?: string;
  taskContext?: TaskContext;
  idempotencyKey?: string;
  submittedAt?: string;
  locale?: string;
  clientCapabilities?: string[];
}
