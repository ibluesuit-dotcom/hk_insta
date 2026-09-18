import { defineConfig } from "@playwright/test";
if (
  !process.env.DATA_DIR?.startsWith("/tmp/") ||
  !process.env.E2E_ARTIFACT_DIR?.startsWith("/tmp/")
)
  throw new Error("Isolated /tmp DATA_DIR and E2E_ARTIFACT_DIR required");
export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 60000,
  workers: 1,
  outputDir: process.env.E2E_ARTIFACT_DIR + "/results",
  use: {
    baseURL: "http://127.0.0.1:4397",
    viewport: { width: 1512, height: 1100 },
  },
  webServer: {
    command: "MOCK_AI=1 MOCK_DELAY=800 PORT=4397 npm run dev",
    url: "http://127.0.0.1:4397/api/health",
    reuseExistingServer: false,
  },
});
