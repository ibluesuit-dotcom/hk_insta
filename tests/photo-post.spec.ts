import { test, expect } from "./auth-fixture";

const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";

test("photo post: choose it first, upload five photos at once, captions on/off, AI writes the cover only", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);

  // The summary post is the default; the photo post swaps the page count.
  await expect(
    page.getByRole("radio", { name: "사진 + 요약 텍스트" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "사진 게시물" }).click();
  await expect(page.getByLabel("본문 페이지 수")).toHaveCount(0);
  await page.getByRole("radio", { name: "이미지 + 글 직접 입력" }).click();

  // Generating without photos is refused before any AI call.
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("본문 사진을 1장 이상");

  // Six at once is more than allowed; five fit and replace the blank card.
  await page.getByLabel("본문 사진 올리기").setInputFiles(Array(6).fill(photo));
  await expect(page.getByRole("alert")).toContainText("5장만 더");
  await page.getByLabel("본문 사진 올리기").setInputFiles(Array(5).fill(photo));
  await expect(page.locator(".photo-strip img")).toHaveCount(5);
  await expect(page.getByLabel("본문 사진 올리기")).toBeDisabled();
  await page.locator(".editor").screenshot({
    path: `${process.env.E2E_ARTIFACT_DIR}/photo-post-source.png`,
  });

  const generated = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await generated).json();
  expect(p.postType).toBe("photo");
  expect(p.count).toBe(5);
  expect(p.renders).toHaveLength(6);
  expect(p.copy.pages.every((pg: any) => pg.kind === "photo")).toBe(true);
  expect(p.copy.pages.every((pg: any) => pg.photoCard.textVisible)).toBe(true);
  expect(p.copy.headline).toBe("금리와 수출 동향");

  // "이미지 + 글": each photo card opens its caption field in 02.
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByRole("button", { name: "사진 1", exact: true }).click();
  await expect(page.getByLabel("사진 문구")).toBeVisible();

  // Back to a summary post is refused while it holds more than 3 photos.
  await page.getByRole("button", { name: "01원문과 제작 방향" }).click();
  await page.getByRole("radio", { name: "사진 + 요약 텍스트" }).click();
  await expect(page.getByRole("alert")).toContainText("3장 이하로");
  await expect(
    page.getByRole("radio", { name: "사진 게시물" }),
  ).toHaveAttribute("aria-checked", "true");

  // "이미지만" hides every photo caption.
  await page.getByRole("radio", { name: "이미지만" }).click();
  await expect
    .poll(async () => {
      const q = await (await request.get(`/api/projects/${p.id}`)).json();
      return q.copy.pages.map((pg: any) => pg.photoCard.textVisible);
    })
    .toEqual([false, false, false, false, false]);
});
