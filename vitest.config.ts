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
      // Order matters: `@/locales/*` is the more specific mapping declared in
      // tsconfig, and Vite matches aliases in declaration order. A bare `@`
      // entry listed first would capture `@/locales/...` and resolve it under
      // `src/`, where those JSON files do not exist, so every test that
      // transitively imports the i18n bundle loader would fail to resolve.
      "@/locales": fileURLToPath(new URL("./locales", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
});