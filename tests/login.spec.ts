// 공용 계정 로그인 검수 (Claude 단독). tests/login-review.config.ts + REVIEW_AUTH=1 로 실행한다.
import { test, expect, Page, BrowserContext } from "@playwright/test";
import fs from "node:fs/promises";
import sharp from "sharp";
const REVIEW_USERNAME = "test";
const REVIEW_PASSWORD = "review-pass-2026";
// The default suite uses the mock server without authentication.
test.skip(process.env.REVIEW_AUTH !== "1", "Run with the isolated authenticated login-review config");
const evidence = process.env.E2E_ARTIFACT_DIR + "/login";
const loginForm = (page: Page) =>
  page.getByRole("form", { name: "공용 계정 로그인" });
const createButtons = (page: Page) =>
  page.getByRole("button", { name: /첫 카드 만들기|새 카드 만들기/ });
async function login(page: Page, password = REVIEW_PASSWORD) {
  await page.getByLabel("아이디").fill(REVIEW_USERNAME);
  await page.getByLabel("비밀번호").fill(password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
}
async function projectCount(page: Page) {
  const res = await page.request.get("/api/projects");
  expect(res.status()).toBe(200);
  return ((await res.json()) as unknown[]).length;
}
test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
});

test("최초 화면: 가운데 박스에 로그인 폼, 만들기 버튼 없음, 3개 해상도 스크린샷", async ({
  page,
}) => {
  await page.goto("/");
  await expect(loginForm(page)).toBeVisible();
  await expect(page.getByRole("button", { name: "로그인", exact: true })).toBeEnabled();
  await expect(createButtons(page)).toHaveCount(0);
  await expect(page.getByLabel("통합 원문")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "카드 스튜디오" })).toBeDisabled();
  await expect(page.getByRole("button", { name: /작업 보관함/ })).toBeDisabled();
  for (const [w, h] of [
    [2048, 1000],
    [1512, 1100],
    [390, 844],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    const form = await loginForm(page).boundingBox();
    const copy = await page.locator(".welcome-copy").boundingBox();
    const card = page.locator(".welcome .welcome-card");
    expect(form).not.toBeNull();
    expect(form!.x).toBeGreaterThanOrEqual(0);
    expect(form!.x + form!.width).toBeLessThanOrEqual(w + 1);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, `${w}px 가로 넘침`).toBeLessThanOrEqual(0);
    if (w >= 1512) {
      // 소개 문구(왼쪽)와 표지 카드(오른쪽) 사이 가운데 열에 로그인 폼이 있어야 한다.
      await expect(card).toBeVisible();
      const cardBox = (await card.boundingBox())!;
      expect(copy!.x + copy!.width).toBeLessThanOrEqual(form!.x + 1);
      expect(form!.x + form!.width).toBeLessThanOrEqual(cardBox.x + 1);
      expect(form!.y).toBeLessThan(h);
    } else {
      // 모바일: 한 열, 카드 숨김, 폼이 화면 폭 안에 들어간다.
      await expect(card).toBeHidden();
      expect(form!.width).toBeLessThanOrEqual(w);
    }
    await page.screenshot({
      path: `${evidence}/login-${w}x${h}.png`,
      fullPage: w < 1000,
    });
  }
  await page.setViewportSize({ width: 1512, height: 1100 });
});

test("로그인 전 API·업로드·렌더 파일 차단, 정적 페이지는 공개", async ({
  page,
  request,
}) => {
  for (const url of [
    "/api/health",
    "/api/projects",
    "/uploads/any.jpg",
    "/renders/any.png",
  ]) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(401);
    expect((await res.json()).code).toBe("AUTH");
  }
  const create = await request.post("/api/projects");
  expect(create.status()).toBe(401);
  const session = await request.get("/api/session");
  expect(await session.json()).toEqual({ authenticated: false, configured: true });
  expect((await request.get("/")).status()).toBe(200);
  const fake = await request.get("/api/projects", {
    headers: { cookie: "studio_session=" + "0".repeat(64) },
  });
  expect(fake.status()).toBe(401);
  await page.goto("/");
  await expect(loginForm(page)).toBeVisible();
});

test("로그인 실패: 오류 메시지, 폼 유지, 여전히 차단", async ({ page }) => {
  await page.goto("/");
  await login(page, "wrong-password");
  await expect(page.getByRole("alert")).toContainText("아이디 또는 비밀번호를 확인하세요");
  await expect(loginForm(page)).toBeVisible();
  await expect(page.getByLabel("통합 원문")).toHaveCount(0);
  expect((await page.request.get("/api/projects")).status()).toBe(401);
  const cookies = await page.context().cookies();
  expect(cookies.find((c) => c.name === "studio_session")).toBeUndefined();
  await page.screenshot({ path: `${evidence}/login-failed.png` });
  // 실패 뒤 같은 폼에서 바로 성공할 수 있어야 한다.
  await login(page);
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("로그인 성공: 스튜디오 원문 탭 자동 진입, 세션 쿠키 속성, 새 카드 만들기 버튼", async ({
  page,
}) => {
  await page.goto("/");
  const before = await page.request.get("/api/projects");
  expect(before.status()).toBe(401);
  await login(page);
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect(loginForm(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /01.*원문과 제작 방향/ })).toHaveClass(/selected/);
  await expect(page.getByLabel("작업 이름")).toHaveValue("새로운 뉴스 카드");
  await expect(createButtons(page)).toHaveCount(1);
  await expect(page.getByRole("button", { name: "카드 스튜디오" })).toBeEnabled();
  const cookie = (await page.context().cookies()).find(
    (c) => c.name === "studio_session",
  )!;
  expect(cookie).toBeDefined();
  expect(cookie.httpOnly).toBe(true);
  expect(cookie.sameSite).toBe("Strict");
  expect(cookie.value).toMatch(/^[0-9a-f]{64}$/);
  const hours = (cookie.expires * 1000 - Date.now()) / 3_600_000;
  expect(hours).toBeGreaterThan(11.5);
  expect(hours).toBeLessThanOrEqual(12);
  expect((await page.request.get("/api/projects")).status()).toBe(200);
  await page.screenshot({ path: `${evidence}/studio-after-login.png` });
  await page.getByRole("button", { name: /작업 보관함/ }).click();
  await expect(page.locator(".archive-card").first()).toBeVisible();
  await expect(createButtons(page)).toHaveCount(1);
  await page.screenshot({ path: `${evidence}/archive-after-login.png` });
});

test("성공 후 직접 편집·자동 저장, 새로고침 시 같은 작업 복원(중복 생성 없음)", async ({
  page,
}) => {
  await page.goto("/");
  await login(page);
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  const count = await projectCount(page);
  const id = await page.evaluate(() => sessionStorage.getItem("studio-project"));
  expect(id).toBeTruthy();
  await page.getByLabel("작업 이름").fill("로그인 검수 작업");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page
    .getByLabel("통합 원문")
    .fill("한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.");
  await expect(page.locator(".project-bar small")).toHaveText("서버 저장 완료", {
    timeout: 10000,
  });
  for (let i = 0; i < 2; i++) {
    await page.reload();
    await expect(page.getByLabel("통합 원문")).toBeVisible();
    await expect(loginForm(page)).toHaveCount(0);
    await expect(page.getByLabel("작업 이름")).toHaveValue("로그인 검수 작업");
    await expect(page.getByLabel("원문 제목", { exact: true })).toHaveValue("금리와 수출 동향");
    expect(await page.evaluate(() => sessionStorage.getItem("studio-project"))).toBe(id);
    expect(await projectCount(page)).toBe(count);
  }
  await page.screenshot({ path: `${evidence}/studio-after-reload.png` });
  // 같은 브라우저의 새 탭은 세션 쿠키를 공유하지만 sessionStorage가 없어 새 작업을 만든다.
  const tab = await page.context().newPage();
  await tab.goto("/");
  await expect(tab.getByLabel("통합 원문")).toBeVisible();
  await expect(tab.getByLabel("작업 이름")).toHaveValue("새로운 뉴스 카드");
  expect(await projectCount(tab)).toBe(count + 1);
  await tab.close();
});

test("로그인 후 업로드 파일은 세션 있는 요청만 열람, 로그아웃 후 다시 로그인 화면", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await login(page);
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  const buffer = await sharp({
    create: { width: 1080, height: 1350, channels: 3, background: "#163044" },
  })
    .jpeg()
    .toBuffer();
  const upload = await page.request.post("/api/photos", {
    multipart: { file: { name: "cover.jpg", mimeType: "image/jpeg", buffer } },
  });
  expect(upload.status()).toBe(200);
  const { url } = await upload.json();
  expect(url).toMatch(/^\/uploads\//);
  expect((await page.request.get(url)).status()).toBe(200);
  const anonymous: BrowserContext = await browser.newContext();
  expect((await anonymous.request.get(url)).status()).toBe(401);
  await anonymous.close();
  const logout = await page.request.post("/api/logout");
  expect(logout.status()).toBe(200);
  expect((await page.request.get(url)).status()).toBe(401);
  await page.reload();
  await expect(loginForm(page)).toBeVisible();
  await expect(page.getByLabel("통합 원문")).toHaveCount(0);
});

test("연속 실패 10회 뒤 429 안내 (마지막 테스트: 1분 창 공유)", async ({
  page,
}) => {
  await page.goto("/");
  for (let i = 0; i < 10; i++) {
    const res = await page.request.post("/api/login", {
      data: { username: REVIEW_USERNAME, password: "wrong" },
    });
    expect(res.status()).toBe(401);
  }
  await login(page);
  await expect(page.getByRole("alert")).toContainText("로그인 시도가 많습니다");
  await expect(loginForm(page)).toBeVisible();
  await page.screenshot({ path: `${evidence}/login-rate-limited.png` });
});
