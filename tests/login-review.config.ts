// Claude 단독 검수용 격리 설정. /tmp 하위 DATA_DIR·E2E_ARTIFACT_DIR 필수, 포트는 REVIEW_PORT.
// REVIEW_AUTH=1 이면 테스트용 계정(test / 아래 REVIEW_PASSWORD)을 bcrypt 해시로 서버에 주입한다.
// 비밀번호는 검수 전용 고정값이며 운영 계정과 무관하다.
import { defineConfig } from "@playwright/test";
import bcrypt from "bcryptjs";
if (
  !process.env.DATA_DIR?.startsWith("/tmp/") ||
  !process.env.E2E_ARTIFACT_DIR?.startsWith("/tmp/")
)
  throw new Error("Isolated /tmp DATA_DIR and E2E_ARTIFACT_DIR required");
export const REVIEW_USERNAME = "test";
export const REVIEW_PASSWORD = "review-pass-2026";
const port = Number(process.env.REVIEW_PORT || 4396);
const auth: Record<string, string> =
  process.env.REVIEW_AUTH === "1"
    ? {
        AUTH_USERNAME: REVIEW_USERNAME,
        AUTH_PASSWORD_HASH: bcrypt.hashSync(REVIEW_PASSWORD, 10),
      }
    : {};
export default defineConfig({
  testDir: ".",
  testMatch: process.env.REVIEW_MATCH || "*.spec.ts",
  timeout: 60000,
  workers: 1,
  outputDir: process.env.E2E_ARTIFACT_DIR + "/results",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1512, height: 1100 },
  },
  webServer: {
    command: "npm run dev",
    env: {
      MOCK_AI: "1",
      MOCK_DELAY: "300",
      PORT: String(port),
      DATA_DIR: process.env.DATA_DIR!,
      ...auth,
    },
    url: `http://127.0.0.1:${port}/api/session`,
    reuseExistingServer: false,
  },
});
