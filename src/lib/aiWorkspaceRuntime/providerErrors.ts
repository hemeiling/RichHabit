import type { FailureDetail, MessageErrorCode } from "@/lib/aiWorkspace/types";
import { ProviderFailure } from "./provider";

/**
 * Provider errors, normalized: one place that decides what an error from
 * Anthropic or Google means for the admin.
 *
 *   rate_limited       temporary: too many requests; trying again shortly works
 *   quota_unavailable  the account's quota or billing does not allow the request
 *                      at all (a quota of 0, billing not enabled, no credit)
 *   provider_outage    the provider is down or overloaded (5xx)
 *   provider_config    the key, model or account is not usable as configured
 *   timeout, context_too_long, unreadable_file
 *   generation_failed  anything else
 *
 * A safety refusal is not an error: the reply completes with stop reason
 * `refusal` and says so.
 *
 * The adapters pass the HTTP status, the provider's error type and its message.
 * The message is read here only to classify, and is then dropped: it can carry
 * quota internals, project ids or parts of the request, so it never reaches a
 * log, the database or the browser.
 */

export type ProviderErrorKind =
  | "rate_limited" | "quota_unavailable" | "provider_outage" | "provider_config"
  | "timeout" | "context_too_long" | "unreadable_file" | "generation_failed";

export interface ProviderErrorInput {
  /** The HTTP status, when there was a response. */
  status: number | null;
  /** The provider's own error type or status, such as `RESOURCE_EXHAUSTED` or `rate_limit_error`. */
  type?: string | null;
  /** The provider's message. Classified, then dropped. */
  message?: string | null;
}

const QUOTA_OR_BILLING = /\blimit:\s*0\b|credit balance is too low|billing (?:is )?not enabled|requires billing|enable billing|billing account|payment required/;
const BAD_KEY = /api key not valid|invalid api key|invalid x-api-key|api key expired|api_key_invalid/;
const TOO_LONG = /prompt is too long|too many (?:input )?tokens|context (?:window|length)|input token count|exceeds the maximum number of tokens/;
const FILE_PROBLEM = /\b(?:pdf|image|document|file|mime|inline)\b/;

export function classifyProviderError(input: ProviderErrorInput): ProviderErrorKind {
  const status = input.status ?? 0;
  const type = String(input.type ?? "").toLowerCase();
  const message = String(input.message ?? "").toLowerCase();

  // Checked first: a quota of 0 also arrives as a 429, and waiting will not help.
  if (status === 402 || QUOTA_OR_BILLING.test(message)) return "quota_unavailable";
  if (status === 429 || type === "resource_exhausted" || type === "rate_limit_error") return "rate_limited";
  if (status === 401 || status === 403 || BAD_KEY.test(message)
    || ["unauthenticated", "permission_denied", "authentication_error", "permission_error", "failed_precondition"].includes(type)) {
    return "provider_config";
  }
  if (status === 408 || status === 504 || type === "deadline_exceeded" || type === "timeout_error") return "timeout";
  if (status === 413 || type === "request_too_large" || TOO_LONG.test(message)) return "context_too_long";
  if ((status === 400 || status === 404) && FILE_PROBLEM.test(message)) return "unreadable_file";
  // A model that does not exist, or is no longer offered to this account.
  if (status === 404 || type === "not_found" || type === "not_found_error") return "provider_config";
  if (status >= 500 || ["unavailable", "internal", "overloaded_error", "api_error"].includes(type)) return "provider_outage";
  return "generation_failed";
}

/** How each kind is stored: an existing error code, plus a detail where the code alone would mislead. */
const STORED: Record<ProviderErrorKind, { code: MessageErrorCode; detail: FailureDetail | null }> = {
  rate_limited: { code: "rate_limited", detail: null },
  quota_unavailable: { code: "provider_error", detail: "quota_unavailable" },
  provider_outage: { code: "overloaded", detail: null },
  provider_config: { code: "provider_error", detail: "provider_config" },
  timeout: { code: "timeout", detail: null },
  context_too_long: { code: "context_too_long", detail: null },
  unreadable_file: { code: "unreadable_file", detail: null },
  generation_failed: { code: "provider_error", detail: null },
};

export function providerFailure(input: ProviderErrorInput): ProviderFailure {
  const stored = STORED[classifyProviderError(input)];
  return new ProviderFailure(stored.code, input.status || null, stored.detail);
}

/** The normalized name of a failure, for logs: the detail when there is one. */
export const failureName = (failure: ProviderFailure): string => failure.detail ?? failure.code;

/** An HTTP status as a category safe to log: "4xx", "5xx", or "none". */
export const statusClass = (status: number | null): string => (status ? `${Math.floor(status / 100)}xx` : "none");
