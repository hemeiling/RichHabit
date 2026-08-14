import { beforeEach, describe, expect, it } from "vitest";
import { MAX_ATTEMPTS, WINDOW_MS, clearThrottle, resetThrottle, throttle } from "../src/lib/throttle";

beforeEach(resetThrottle);

describe("sign-in throttle", () => {
  it("allows up to the limit, then blocks", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      expect(throttle("ip:a@example.com"), `attempt ${i + 1}`).toBe(true);
    }
    expect(throttle("ip:a@example.com")).toBe(false);
  });

  it("counts each email separately", () => {
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) throttle("ip:a@example.com");
    expect(throttle("ip:b@example.com")).toBe(true);
  });

  it("forgets once the window has passed", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < MAX_ATTEMPTS + 1; i++) throttle("ip:a@example.com", t0);
    expect(throttle("ip:a@example.com", t0)).toBe(false);
    expect(throttle("ip:a@example.com", t0 + WINDOW_MS + 1)).toBe(true);
  });

  it("resets on a successful sign-in", () => {
    for (let i = 0; i < MAX_ATTEMPTS; i++) throttle("ip:a@example.com");
    clearThrottle("ip:a@example.com");
    expect(throttle("ip:a@example.com")).toBe(true);
  });
});
