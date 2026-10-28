import { defineConfig } from "@playwright/test";
import { resolve } from "node:path";
process.env.DB_DRIVER = "pglite";
process.env.PGLITE_PATH = resolve(`.data/e2e-${Date.now()}`);
process.env.SEED_PASSWORD = "e2e-only-fake-password";
process.env.SEED_DEMO = "true";
export default defineConfig({
  testDir: "tests/e2e",
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: "http://localhost:3100",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npx tsx scripts/migrate.ts && npx tsx scripts/seed.ts && npm run dev -- --port 3100",
    url: "http://localhost:3100/login",
    reuseExistingServer: false,
    timeout: 120000,
  },
});
