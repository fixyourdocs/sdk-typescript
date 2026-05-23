/**
 * Reference TypeScript SDK for the Docs Feedback Protocol v0.
 * See <https://github.com/fixyourdocs/protocol>.
 */

export * from "./types.js";
export * from "./errors.js";
export { Client } from "./client.js";
export type { ClientOptions, SendOptions } from "./client.js";
export { buildReport } from "./buildReport.js";

export const VERSION = "0.1.0";
