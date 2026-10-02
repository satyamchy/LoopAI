import { defineConfig } from "vitest/config";

/** Real Groq and public job boards. Run with `corepack pnpm test:live`. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["apps/api/src/live.test.ts"],
    testTimeout: 60_000,
  },
});
