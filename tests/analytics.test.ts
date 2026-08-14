import { describe, expect, it, vi } from "vitest";

/**
 * §19: analytics failure must never stop the habit action. The tracker owns a
 * try/catch, so a broken database is a reporting gap, not a lost completion.
 */
vi.mock("next/headers", () => ({ headers: () => new Map() }));
vi.mock("@/lib/db/pool", () => ({
  query: vi.fn().mockRejectedValue(new Error("analytics table is unreachable")),
}));

describe("trackEvent", () => {
  it("resolves rather than throwing when the database is down", async () => {
    const { trackEvent } = await import("../src/lib/analytics/track");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      trackEvent({ userId: "11111111-2222-4333-8444-555555555555", event: "habit_completed" }),
    ).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();   // it complains, but it does not throw
    spy.mockRestore();
  });
});
