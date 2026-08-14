import path from "node:path";
import { defineConfig } from "vitest/config";

// `@/` resolves the same way it does in tsconfig, so tests can import the
// modules under src without relative-path chains.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
});
