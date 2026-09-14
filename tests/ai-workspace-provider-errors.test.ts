import { describe, expect, it } from "vitest";
import {
  classifyProviderError, failureName, providerFailure, statusClass, type ProviderErrorInput,
} from "../src/lib/aiWorkspaceRuntime/providerErrors";

/**
 * Provider errors from Anthropic and Google, normalized to what the admin can
 * act on. Messages are shaped like the real ones; none of their words may
 * survive into the failure.
 */

const SECRET_BITS = /limit: 0|free_tier|project 987654|billing account 01A2|credit balance|x-api-key|api key not valid|gemini-9|SENTINEL/i;

describe("classifying provider errors", () => {
  it.each<[string, ProviderErrorInput, string]>([
    // quota or billing that does not allow the request: waiting will not help
    ["Google quota of 0", { status: 429, type: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 0, model: gemini-3.1-flash-image, project 987654" }, "quota_unavailable"],
    ["Google billing required", { status: 403, type: "PERMISSION_DENIED", message: "This API method requires billing to be enabled. billing account 01A2" }, "quota_unavailable"],
    ["Anthropic credit", { status: 400, type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." }, "quota_unavailable"],
    ["payment required", { status: 402, message: "SENTINEL" }, "quota_unavailable"],
    // temporary rate limits
    ["Google per-minute limit", { status: 429, type: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted (e.g. check quota). SENTINEL" }, "rate_limited"],
    ["Anthropic rate limit", { status: 429, type: "rate_limit_error", message: "Number of request tokens has exceeded your per-minute rate limit" }, "rate_limited"],
    // outages
    ["Google unavailable", { status: 503, type: "UNAVAILABLE", message: "The model is overloaded. SENTINEL" }, "provider_outage"],
    ["Google internal", { status: 500, type: "INTERNAL", message: "SENTINEL" }, "provider_outage"],
    ["Anthropic overloaded", { status: 529, type: "overloaded_error", message: "Overloaded" }, "provider_outage"],
    // configuration
    ["Anthropic bad key", { status: 401, type: "authentication_error", message: "invalid x-api-key" }, "provider_config"],
    ["Google bad key", { status: 400, type: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key." }, "provider_config"],
    ["Google permission", { status: 403, type: "PERMISSION_DENIED", message: "Permission denied on resource project 987654." }, "provider_config"],
    ["unknown model", { status: 404, type: "NOT_FOUND", message: "models/gemini-9 is not found for API version v1beta" }, "provider_config"],
    ["unsupported location", { status: 400, type: "FAILED_PRECONDITION", message: "User location is not supported for the API use. SENTINEL" }, "provider_config"],
    // the rest
    ["timeout", { status: 504, type: "DEADLINE_EXCEEDED", message: "SENTINEL" }, "timeout"],
    ["too long", { status: 400, type: "INVALID_ARGUMENT", message: "The input token count exceeds the maximum number of tokens allowed" }, "context_too_long"],
    ["unreadable image", { status: 400, type: "INVALID_ARGUMENT", message: "Unable to process input image. SENTINEL" }, "unreadable_file"],
    ["anything else", { status: 400, type: "INVALID_ARGUMENT", message: "Request contains an invalid argument. SENTINEL" }, "generation_failed"],
    ["no response", { status: null }, "generation_failed"],
  ])("%s", (_label, input, kind) => {
    expect(classifyProviderError(input)).toBe(kind);
  });

  it("stores each kind as an existing error code, with a detail only where the code would mislead", () => {
    const cases: [ProviderErrorInput, string, string | null][] = [
      [{ status: 429, message: "limit: 0 project 987654" }, "provider_error", "quota_unavailable"],
      [{ status: 429, message: "SENTINEL" }, "rate_limited", null],
      [{ status: 503, message: "SENTINEL" }, "overloaded", null],
      [{ status: 401, message: "invalid x-api-key" }, "provider_error", "provider_config"],
      [{ status: 504 }, "timeout", null],
      [{ status: 413 }, "context_too_long", null],
      [{ status: 400, message: "Could not process image SENTINEL" }, "unreadable_file", null],
      [{ status: 400, message: "SENTINEL" }, "provider_error", null],
    ];
    for (const [input, code, detail] of cases) {
      const failure = providerFailure(input);
      expect(failure.code).toBe(code);
      expect(failure.detail).toBe(detail);
      expect(failure.status).toBe(input.status);
      expect(failureName(failure)).toBe(detail ?? code);
      expect(`${failure.message} ${String(failure)} ${JSON.stringify(failure)}`).not.toMatch(SECRET_BITS);
    }
  });

  it("describes a status only by its category", () => {
    expect(statusClass(429)).toBe("4xx");
    expect(statusClass(503)).toBe("5xx");
    expect(statusClass(null)).toBe("none");
  });
});
