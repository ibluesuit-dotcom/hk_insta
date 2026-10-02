import { test, expect } from "./auth-fixture";
const article =
  "산업통상자원부는 9월 1일 지난달 수출이 전년 동기 대비 증가했다고 밝혔다. 자동차와 반도체 수출이 증가세를 이끌었다. 이번 집계는 잠정치이며 품목별 확정 수치는 추후 발표할 예정이다.";

test("0 body pages: the cover alone is generated, rendered and downloadable", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("작업 이름").fill("표지만");
  await page.getByLabel("원문 제목", { exact: true }).fill("수출 증가");
  await page.getByLabel("통합 원문").fill(article);
  await page
    .getByLabel("표지 사진 첨부")
    .setInputFiles(
      "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
    );
  await expect(page.locator(".photo-drop img")).toBeVisible();
  await page.getByLabel("본문 페이지 수").selectOption("0");
  await expect(page.getByLabel("본문 페이지 수")).toHaveValue("0");
  await expect(page.getByText("총 1장", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page.locator(".feed-image img")).toBeVisible({ timeout: 30000 });
  const id = await page.evaluate(() => location.hash.match(/[\w-]{8,}/)?.[0]);
  const list = await (await request.get("/api/projects")).json();
  const p = await (
    await request.get(
      `/api/projects/${id ?? (list.projects ?? list)[0].id}`,
    )
  ).json();
  expect(p.count).toBe(0);
  expect(p.copy.pages).toEqual([]);
  expect(p.renders).toHaveLength(1);
  const zip = page.waitForEvent("download");
  await page.getByRole("link", { name: "내보내기", exact: true }).click();
  expect(await (await zip).failure()).toBeNull();
  const png = await request.get(`/api/projects/${p.id}/png/0`);
  expect(png.ok()).toBe(true);

  // A card added later can be deleted back to the cover alone.
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByRole("button", { name: "텍스트 카드 추가" }).click();
  await expect(page.locator(".add-card").getByText("전체 2장")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "이 카드 삭제" }).click();
  await expect(page.locator(".add-card").getByText("전체 1장")).toBeVisible();
  await expect
    .poll(async () => (await (await request.get(`/api/projects/${p.id}`)).json()).count)
    .toBe(0);
});
