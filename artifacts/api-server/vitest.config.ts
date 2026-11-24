import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    env: {
      // lib/ledgerData.ts imports @workspace/db, which needs a DATABASE_URL to load. This address is never
      // connected to: pure tests do not touch a database, and route tests swap in an in-memory PGlite database.
      DATABASE_URL: "postgres://unit-test@127.0.0.1:1/never-connected",
      // Dummy values so the Express app can load in route tests. Test-only, not real secrets.
      SESSION_SECRET: "test-only-session-secret-not-used-in-production-0123456789",
      RESEND_API_KEY: "re_test_dummy_key",
      LOG_LEVEL: "silent",
    },
  },
});
