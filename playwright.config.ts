import { defineConfig } from "@playwright/test";
// Specs write evidence to E2E_ARTIFACT_DIR; unset, `${undefined}/x` used to
// create an `undefined/` folder in the repo root. Default to an ignored path.
process.env.E2E_ARTIFACT_DIR ||= "test-results/e2e-artifacts";
export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.ts",
  timeout: 60000,
  use: {
    baseURL: "http://127.0.0.1:4311",
    viewport: { width: 1512, height: 1100 },
  },
  workers: 1,
  webServer: {
    command:
      "MOCK_AI=1 MOCK_DELAY=800 AI_BACKGROUND_GENERATE=1 AI_POST_PER_MINUTE=100000 AI_DAILY_POST_TEXT_LIMIT=100000 AI_DAILY_POST_VERIFY_LIMIT=100000 DATA_DIR=data/e2e PORT=4311 npm run dev",
    url: "http://127.0.0.1:4311/api/health",
    reuseExistingServer: true,
  },
});
