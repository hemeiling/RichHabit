import { afterEach, describe, expect, it, vi } from "vitest";
import { coach } from "../src/lib/coach";

/**
 * The wire contract between the Insights screen and /api/coach. The point of
 * these is that the browser sends a question and nothing else — the route reads
 * the account itself, so context can't be shaped or spoofed on the client.
 */

const respond = (body: unknown, ok = true, status = 200) =>
  vi.fn().mockResolvedValue({ ok, status, json: async () => body });

afterEach(() => { vi.unstubAllGlobals(); });

describe("coach.ask", () => {
  it("sends only the question", async () => {
    const fetchMock = respond({ answer: "Focus on evenings." });
    vi.stubGlobal("fetch", fetchMock);

    await coach.ask("What should I change this week?");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/coach");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ question: "What should I change this week?" });
  });

  it("returns the answer", async () => {
    vi.stubGlobal("fetch", respond({ answer: "Evenings are at 41%." }));
    await expect(coach.ask("Why?")).resolves.toBe("Evenings are at 41%.");
  });

  it("surfaces the route's error message", async () => {
    vi.stubGlobal("fetch", respond({ error: "No coach model connected." }, false, 501));
    await expect(coach.ask("Why?")).rejects.toThrow("No coach model connected.");
  });

  it("falls back to the status when the body has no error", async () => {
    vi.stubGlobal("fetch", respond(null, false, 500));
    await expect(coach.ask("Why?")).rejects.toThrow("500");
  });

  it("rejects an empty answer rather than rendering nothing", async () => {
    vi.stubGlobal("fetch", respond({ answer: "" }));
    await expect(coach.ask("Why?")).rejects.toThrow("empty");
  });
});
