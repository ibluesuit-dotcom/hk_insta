// 운영 모드(NODE_ENV=production, Secure 쿠키) 로그인과 서버 재시작 후 세션 만료 동작을 확인한다.
// 실행: DATA_DIR=/tmp/... E2E_ARTIFACT_DIR=/tmp/... npx tsx tests/login-prod-check.ts  (npm run build 선행)
import { spawn, ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import bcrypt from "bcryptjs";
import { chromium } from "playwright";
if (
  !process.env.DATA_DIR?.startsWith("/tmp/") ||
  !process.env.E2E_ARTIFACT_DIR?.startsWith("/tmp/")
)
  throw new Error("Isolated /tmp DATA_DIR and E2E_ARTIFACT_DIR required");
const port = Number(process.env.REVIEW_PORT || 4399);
const base = `http://127.0.0.1:${port}`;
const evidence = process.env.E2E_ARTIFACT_DIR + "/prod";
await fs.mkdir(evidence, { recursive: true });
const password = "review-pass-2026";
const env = {
  ...process.env,
  NODE_ENV: "production",
  MOCK_AI: "1",
  PORT: String(port),
  AUTH_USERNAME: "test",
  AUTH_PASSWORD_HASH: bcrypt.hashSync(password, 10),
};
let server: ChildProcess;
async function start() {
  server = spawn("npx", ["tsx", "server/index.ts"], { env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    try {
      const res = await fetch(base + "/api/session");
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server did not start");
}
async function stop() {
  server.kill();
  await new Promise((r) => server.once("exit", r));
}
const log: Record<string, unknown> = {};
await start();
const browser = await chromium.launch();
try {
  for (const host of ["127.0.0.1", "localhost"]) {
    const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
    await page.goto(`http://${host}:${port}/`);
    await page.getByLabel("아이디").fill("test");
    await page.getByLabel("비밀번호").fill(password);
    const response = page.waitForResponse((r) => r.url().endsWith("/api/login"));
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const setCookie = (await (await response).headersArray())
      .filter((h) => h.name.toLowerCase() === "set-cookie")
      .map((h) => h.value)
      .join("\n");
    const entered = await page
      .getByLabel("통합 원문")
      .waitFor({ timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    const cookies = await page.context().cookies();
    log[host] = {
      secureFlagInHeader: /;\s*Secure/i.test(setCookie),
      cookieStored: cookies.some((c) => c.name === "studio_session"),
      studioEntered: entered,
      error: entered ? "" : await page.locator(".error, [role=alert]").allInnerTexts(),
    };
    await page.screenshot({ path: `${evidence}/prod-${host}.png` });
    if (host === "127.0.0.1" && entered) {
      // 서버 재시작 → 메모리 세션 소멸. 편집 시 UI가 어떻게 반응하는지 기록한다.
      await stop();
      await start();
      await page.getByLabel("작업 이름").fill("재시작 뒤 편집");
      await page.waitForTimeout(2500);
      log.afterRestart = {
        stillOnStudio: await page.getByLabel("통합 원문").isVisible(),
        saveStatus: await page.locator(".project-bar small").innerText(),
        banner: await page.locator(".error").allInnerTexts(),
        apiStatus: (await page.request.get(base + "/api/projects")).status(),
      };
      await page.screenshot({ path: `${evidence}/prod-after-restart.png` });
      await page.reload();
      log.afterRestartReload = {
        loginFormShown: await page
          .getByRole("form", { name: "공용 계정 로그인" })
          .isVisible(),
      };
    }
    await page.close();
  }
} finally {
  await browser.close();
  await stop();
}
await fs.writeFile(`${evidence}/prod-check.json`, JSON.stringify(log, null, 2));
console.log(JSON.stringify(log, null, 2));
