// "추출된 원문과 제목·발행 시점을 확인했습니다" 체크박스 제거 검수 프로브 (Claude 단독).
// tests/login-review.config.ts + REVIEW_AUTH=1 + REVIEW_MATCH=source-confirmation-removal-review.spec.ts 로 격리 실행한다.
import { test, expect, Page } from "@playwright/test";
import fs from "node:fs/promises";
test.skip(process.env.REVIEW_AUTH !== "1", "Run with the isolated authenticated login-review config");
const evidence = process.env.E2E_ARTIFACT_DIR + "/source-confirmation-removal";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("아이디").fill("test");
  await page.getByLabel("비밀번호").fill("review-pass-2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
}
const activeId = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("studio-project"));
const project = async (page: Page, id: string) =>
  (await (await page.request.get("/api/projects/" + id)).json()) as any;
const current = (body: any) => body.current ?? body;
test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
});

test("체크박스 없음 · 원문+사진으로 생성·렌더 (sourceConfirmed=false) · 부분 생성 · 키워드", async ({ page }) => {
  await login(page);
  await expect(page.getByText(/추출된 원문과 제목/)).toHaveCount(0);
  await expect(page.getByText(/확인했습니다/)).toHaveCount(0);
  await expect(page.locator('.editor input[type="checkbox"]')).toHaveCount(0);
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const generate = page.getByRole("button", { name: "생성", exact: true });
  await expect(generate).toBeEnabled();
  await page.screenshot({ path: `${evidence}/01-source-tab.png`, fullPage: true });
  const gen = page.waitForResponse((r) => r.url().endsWith("/generate"));
  const render = page.waitForResponse((r) => r.url().endsWith("/render"));
  await generate.click();
  expect((await gen).status()).toBe(200);
  expect((await render).status()).toBe(200);
  const id = (await activeId(page))!;
  let p = current(await project(page, id));
  expect(p.sourceConfirmed).toBe(false);
  expect(p.status).not.toBe("draft");
  expect(p.copy.headline).toBeTruthy();
  expect(p.copy.pages.length).toBe(p.count);
  await page.screenshot({ path: `${evidence}/02-generated.png`, fullPage: true });

  // 키워드 추천 (UI)
  const kw = page.waitForResponse((r) => r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "사진 키워드 추천받기" }).click();
  const kwRes = await kw;
  expect(kwRes.status()).toBe(200);
  expect(kwRes.request().postDataJSON().scope).toBe("keywords");
  p = current(await project(page, id));
  expect(p.sourceConfirmed).toBe(false);
  console.log("keywords:", JSON.stringify(p.copy.keywords ?? p.copy.photoKeywords));

  // 부분 생성 (UI, 02 탭의 첫 "↻ 다시 생성")
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  const part = page.waitForResponse((r) => r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "↻ 다시 생성" }).first().click();
  const partRes = await part;
  console.log("partial scope:", partRes.request().postDataJSON().scope);
  expect(partRes.status()).toBe(200);
  await page.screenshot({ path: `${evidence}/03-partial.png`, fullPage: true });
});

test("서버 게이트: 짧은/빈 원문 거절 메시지, 키워드 빈 원문, 제목 우회, sourceConfirmed=false 허용", async ({ page }) => {
  await login(page);
  const created = await (await page.request.post("/api/projects", { data: {} })).json();
  let p = current(created);
  const put = async (patch: any) => {
    const r = await page.request.put("/api/projects/" + p.id, { data: { ...p, ...patch } });
    expect(r.ok(), await r.text()).toBe(true);
    p = current(await r.json());
  };
  const gen = (scope: string) =>
    page.request.post(`/api/projects/${p.id}/generate`, { data: { revision: p.revision, scope } });
  expect(p.sourceConfirmed).toBe(false);

  // 빈 원문
  for (const scope of ["all", "headline", "caption", "pages", "page:0"]) {
    const r = await gen(scope);
    expect(r.status(), scope).toBeGreaterThanOrEqual(400);
    const b = await r.json();
    console.log("empty", scope, r.status(), JSON.stringify(b));
    expect(JSON.stringify(b)).toContain("원문을 30자 이상 입력하세요.");
  }
  let r = await gen("keywords");
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(await r.json())).toContain("기사나 파일 원문을 불러오거나 붙여넣어 주세요.");

  // 29자 원문
  await put({ source: "가".repeat(29) });
  r = await gen("all");
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(await r.json())).toContain("원문을 30자 이상 입력하세요.");
  r = await gen("caption");
  expect(JSON.stringify(await r.json())).toContain("원문을 30자 이상 입력하세요.");
  // 키워드는 비어 있지 않으면 통과
  r = await gen("keywords");
  expect(r.status(), await r.text()).toBe(200);
  p = current(await r.json());

  // 제목이 있으면 headline 은 짧은 원문에서도 우회 (기존 동작 유지)
  await put({ sourceTitle: "금리와 수출 동향" });
  r = await gen("headline");
  expect(r.status(), await r.text()).toBe(200);
  // all 은 제목이 있어도 30자 게이트 유지
  r = await gen("all");
  expect(JSON.stringify(await r.json())).toContain("원문을 30자 이상 입력하세요.");

  // 유효 원문이나 사진 없음 → IMAGE 게이트 유지
  await put({ source });
  r = await gen("all");
  expect(r.status()).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(await r.json())).toContain("생성 전에 표지 사진을 첨부하세요.");
  // 사진 없이도 부분 생성은 sourceConfirmed=false 로 가능
  r = await gen("caption");
  expect(r.status(), await r.text()).toBe(200);
  expect(p.sourceConfirmed).toBe(false);

  // 저장된 구버전 프로젝트(sourceConfirmed=true) 호환: 스키마가 그대로 받아들임
  await put({ sourceConfirmed: true });
  expect(p.sourceConfirmed).toBe(true);
});

test("인증 게이트 불변: 비로그인 generate 는 401", async ({ playwright, baseURL }) => {
  const anon = await playwright.request.newContext({ baseURL });
  const r = await anon.post("/api/projects/x/generate", { data: { revision: 0, scope: "all" } });
  expect(r.status()).toBe(401);
  expect((await anon.get("/api/projects")).status()).toBe(401);
  await anon.dispose();
});

test("UI: 짧은 원문으로 생성 시 명확한 오류 표시, AI 미호출", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "+ 새 카드 만들기", exact: true }).click();
  await page.getByLabel("통합 원문").fill("짧은 원문");
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const gen = page.waitForResponse((r) => r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  expect((await gen).status()).toBe(400);
  await expect(page.getByText(/원문을 30자 이상 입력하세요/)).toBeVisible();
  await page.screenshot({ path: `${evidence}/04-short-source-error.png`, fullPage: true });
  const p = current(await project(page, (await activeId(page))!));
  expect(p.copy.headline).toBeFalsy();
});
