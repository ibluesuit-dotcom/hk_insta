// "새 카드 만들기" 헤더 버튼 검수 프로브 (Claude 단독). tests/login-review.config.ts + REVIEW_AUTH=1 +
// REVIEW_MATCH=new-card-review.spec.ts 로 격리 실행한다. 제품 코드는 건드리지 않는다.
import { test, expect, Page } from "@playwright/test";
import fs from "node:fs/promises";
test.skip(process.env.REVIEW_AUTH !== "1", "Run with the isolated authenticated login-review config");
const evidence = process.env.E2E_ARTIFACT_DIR + "/new-card";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
const newCard = (page: Page) =>
  page.getByRole("button", { name: "+ 새 카드 만들기", exact: true });
const urlInput = (page: Page) => page.getByPlaceholder(/기사 주소를 입력하세요/);
const activeId = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("studio-project"));
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("아이디").fill("test");
  await page.getByLabel("비밀번호").fill("review-pass-2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
}
async function projects(page: Page) {
  return (await (await page.request.get("/api/projects")).json()) as any[];
}
test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
});

test("로그인 전 숨김, 로그인 후 표시, 데스크톱·모바일 버튼 맞춤", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("form", { name: "공용 계정 로그인" })).toBeVisible();
  await expect(page.getByRole("button", { name: /새 카드 만들기/ })).toHaveCount(0);
  await login(page);
  await expect(newCard(page)).toBeVisible();
  for (const [w, h] of [
    [2048, 1000],
    [1512, 1100],
    [1000, 900],
    [390, 844],
    [320, 640],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    const b = (await newCard(page).boundingBox())!;
    const head = (await page.locator("main header").boundingBox())!;
    const h1 = (await page.locator("main header h1").boundingBox())!;
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    console.log(`fit ${w}: btn=${JSON.stringify(b)} h1=${JSON.stringify(h1)} overflow=${overflow}`);
    // 390px 이하의 가로 넘침(+92px)은 버튼과 무관한 기존 .editor 최소 너비 문제(버튼 숨김 시에도 동일)라 단언하지 않는다.
    if (w >= 1000) expect(overflow, `${w}px 가로 넘침`).toBeLessThanOrEqual(0);
    expect(b.x).toBeGreaterThanOrEqual(head.x - 1);
    expect(b.x + b.width).toBeLessThanOrEqual(Math.min(w, head.x + head.width) + 1);
    expect(b.y).toBeGreaterThanOrEqual(head.y - 1);
    expect(b.y + b.height).toBeLessThanOrEqual(head.y + head.height + 1);
    // 한 줄 라벨 (줄바꿈 없음) 및 제목과 겹치지 않음
    expect(b.height, `${w}px 버튼 줄바꿈`).toBeLessThanOrEqual(50);
    const overlapX = b.x < h1.x + h1.width && h1.x < b.x + b.width;
    const overlapY = b.y < h1.y + h1.height && h1.y < b.y + b.height;
    expect(overlapX && overlapY, `${w}px 제목과 겹침`).toBe(false);
    await page.screenshot({ path: `${evidence}/fit-${w}.png` });
  }
});

test("플러시 후 새 카드, 새 필드 비어 있음, 새로고침 유지, 보관함 재열기 시 초안 복원", async ({ page }) => {
  await login(page);
  const oldId = await activeId(page);
  await urlInput(page).fill("https://example.com/old-article");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const render = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await render;
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByLabel("부제", { exact: true }).fill("미반영 부제 초안");
  await expect(page.getByRole("link", { name: "내보내기", exact: true })).toHaveAttribute("aria-disabled", "true");

  // 저장 대기 중인 직접 편집 직후(650ms 자동저장 전) 곧바로 새 카드 클릭 → 먼저 PUT, 그다음 POST
  const order: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith("/api/projects") && r.method() !== "GET")
      order.push(`${r.method()} ${u.pathname}`);
  });
  await page.getByLabel("작업 이름").fill("이전 작업 · 플러시 확인");
  await newCard(page).click();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect.poll(() => activeId(page)).not.toBe(oldId);
  const newId = await activeId(page);
  console.log("order:", JSON.stringify(order));
  expect(order[0]).toBe(`PUT /api/projects/${oldId}`);
  expect(order[order.length - 1]).toBe("POST /api/projects");
  expect(order.filter((x) => x === "POST /api/projects")).toHaveLength(1);

  // 서버에 이전 작업 편집이 보존됨
  const old = await (await page.request.get("/api/projects/" + oldId)).json();
  expect(old.name).toBe("이전 작업 · 플러시 확인");
  expect(old.sourceUrl).toBe("https://example.com/old-article");
  expect(old.photo).toBeTruthy();
  expect(old.source).toBe(source);

  // 새 카드는 비어 있음
  await expect(urlInput(page)).toHaveValue("");
  await expect(page.getByLabel("원문 제목", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("통합 원문")).toHaveValue("");
  await expect(page.getByAltText("메인 카드 배경 이미지")).toHaveCount(0);
  await expect(page.getByLabel("작업 이름")).not.toHaveValue("이전 작업 · 플러시 확인");
  const fresh = await (await page.request.get("/api/projects/" + newId)).json();
  expect(fresh.photo).toBeFalsy();
  expect(fresh.sourceUrl).toBe("");
  expect(await page.evaluate((id) => localStorage.getItem("editor-drafts:" + id), newId)).toBeNull();
  // 이전 작업의 초안은 localStorage 에 그대로
  expect(
    await page.evaluate((id) => localStorage.getItem("editor-drafts:" + id), oldId),
  ).toContain("미반영 부제 초안");
  await page.screenshot({ path: `${evidence}/new-card-blank.png` });

  // 새 카드에서 새로고침 → 같은 새 카드, 추가 POST 없음
  const before = (await projects(page)).length;
  await page.reload();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  expect(await activeId(page)).toBe(newId);
  expect((await projects(page)).length).toBe(before);
  await expect(urlInput(page)).toHaveValue("");

  // 보관함에서 이전 작업 재열기 → 초안·링크·사진 복원
  await page.getByRole("button", { name: /작업 보관함/ }).click();
  await page
    .locator(".archive-card", { hasText: "이전 작업 · 플러시 확인" })
    .getByRole("button", { name: "이어서 편집" })
    .click();
  await expect(page.getByLabel("작업 이름")).toHaveValue("이전 작업 · 플러시 확인");
  expect(await activeId(page)).toBe(oldId);
  await page.getByRole("button", { name: "01원문과 제작 방향" }).click();
  await expect(urlInput(page)).toHaveValue("https://example.com/old-article");
  await expect(page.getByAltText("메인 카드 배경 이미지")).toBeVisible();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.getByLabel("부제", { exact: true })).toHaveValue("미반영 부제 초안");

  // 이전 작업에서 새로고침 → 같은 작업·링크·사진·초안 유지, 새 프로젝트 생성 없음
  await page.reload();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  expect(await activeId(page)).toBe(oldId);
  expect((await projects(page)).length).toBe(before);
  await expect(urlInput(page)).toHaveValue("https://example.com/old-article");
  await expect(page.getByAltText("메인 카드 배경 이미지")).toBeVisible();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.getByLabel("부제", { exact: true })).toHaveValue("미반영 부제 초안");
  await page.screenshot({ path: `${evidence}/old-restored.png` });
});

test("처리 중 더블클릭은 POST 1회만", async ({ page }) => {
  await login(page);
  const before = (await projects(page)).length;
  let posts = 0;
  await page.route("**/api/projects", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    await new Promise((r) => setTimeout(r, 800));
    await route.continue();
  });
  await newCard(page).dblclick();
  await expect(newCard(page)).toBeDisabled();
  await newCard(page).click({ force: true }).catch(() => {});
  await newCard(page).evaluate((el: HTMLButtonElement) => el.click());
  await expect(newCard(page)).toBeEnabled({ timeout: 10000 });
  expect(posts).toBe(1);
  expect((await projects(page)).length).toBe(before + 1);
});

test("실패 시 이전 작업 유지: POST 실패 / 플러시(PUT) 실패", async ({ page }) => {
  await login(page);
  const oldId = await activeId(page);
  await urlInput(page).fill("https://example.com/keep-me");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.getByAltText("메인 카드 배경 이미지")).toBeVisible();
  const before = (await projects(page)).length;

  // 1) POST 실패
  await page.route("**/api/projects", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "TEST", message: "생성 실패 모의" }),
        })
      : route.continue(),
  );
  await newCard(page).click();
  await expect(page.getByRole("alert")).toContainText("생성 실패 모의");
  expect(await activeId(page)).toBe(oldId);
  await expect(urlInput(page)).toHaveValue("https://example.com/keep-me");
  await expect(page.getByLabel("통합 원문")).toHaveValue(source);
  await expect(page.getByAltText("메인 카드 배경 이미지")).toBeVisible();
  await expect(newCard(page)).toBeEnabled();
  expect((await projects(page)).length).toBe(before);
  await page.unroute("**/api/projects");
  await page.getByRole("button", { name: "닫기" }).click();

  // 2) 플러시 실패 → POST 시도조차 없어야 함
  let posted = false;
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "POST") posted = true;
    return route.continue();
  });
  await page.route("**/api/projects/" + oldId, (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ code: "TEST", message: "저장 실패 모의" }),
        })
      : route.continue(),
  );
  await page.getByLabel("원문 제목", { exact: true }).fill("저장되지 않은 제목");
  await newCard(page).click();
  await expect(page.getByRole("alert")).toContainText("저장 실패 모의");
  expect(posted).toBe(false);
  expect(await activeId(page)).toBe(oldId);
  await expect(page.getByLabel("원문 제목", { exact: true })).toHaveValue("저장되지 않은 제목");
  await expect(urlInput(page)).toHaveValue("https://example.com/keep-me");
  expect((await projects(page)).length).toBe(before);
  await page.screenshot({ path: `${evidence}/failure-preserved.png` });

  // 복구: 라우트 해제 후 다시 클릭하면 편집이 저장되고 새 카드가 열린다
  await page.unroute("**/api/projects/" + oldId);
  await page.getByRole("button", { name: "닫기" }).click();
  await newCard(page).click();
  await expect.poll(() => activeId(page)).not.toBe(oldId);
  const old = await (await page.request.get("/api/projects/" + oldId)).json();
  expect(old.sourceTitle).toBe("저장되지 않은 제목");
  await expect(page.getByLabel("원문 제목", { exact: true })).toHaveValue("");
});
