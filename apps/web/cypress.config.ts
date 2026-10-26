import { defineConfig } from "cypress";

// Runs against a seeded stack (`pnpm db:seed --summary apps/web/cypress/fixtures/demo.json`, the API
// with DEMO_MODE=true and `vite preview`). CI does exactly that; see .github/workflows/ci.yml.
export default defineConfig({
  e2e: {
    baseUrl: process.env["CYPRESS_BASE_URL"] ?? "http://localhost:4173",
    specPattern: "cypress/e2e/**/*.cy.ts",
    supportFile: "cypress/support/e2e.ts",
    viewportWidth: 1440,
    viewportHeight: 900,
    defaultCommandTimeout: 10_000,
    retries: { runMode: 1, openMode: 0 },
    video: false,
  },
});
