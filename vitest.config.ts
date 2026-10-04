import path from "node:path";
import { defineConfig } from "vitest/config";

// `@/` resolves the same way it does in tsconfig, so tests can import the
// modules under src without relative-path chains.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    // The migration-parity tests each build fresh PGlite databases from the full
    // schema. Alone they take 1–3 s; with the whole suite running in parallel
    // they can pass the 5 s default and fail as timeouts, not as differences.
    testTimeout: 30_000,
  },
});
