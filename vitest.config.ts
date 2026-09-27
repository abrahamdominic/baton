import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    // `.dbtest.ts` suites share a real SQLite database and must run serially in
    // their own project; see vitest.db.config.ts.
    exclude: ["node_modules", ".next", ".git", "src/**/*.dbtest.{ts,tsx}"],
    testTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});