import { defineConfig } from "@playwright/test";
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
    command: "MOCK_AI=1 MOCK_DELAY=800 DATA_DIR=data/e2e PORT=4311 npm run dev",
    url: "http://127.0.0.1:4311/api/health",
    reuseExistingServer: true,
  },
});
