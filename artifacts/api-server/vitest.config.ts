import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // lib/ledgerData.ts imports @workspace/db, which needs a DATABASE_URL to load.
    // The tests only call pure functions; this address is never connected to.
    env: { DATABASE_URL: "postgres://unit-test@127.0.0.1:1/never-connected" },
  },
});
