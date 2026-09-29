import type { Page } from "@playwright/test";
import { test, expect } from "./auth-fixture";

const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
const project = (page: Page, id: string) =>
  page.request.get(`/api/projects/${id}`).then((r) => r.json());

test("text → photo → text round trip, add, limit, delete and AI keep photo cards", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("본문 페이지 수").selectOption("2");
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const generated = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const first = await (await generated).json();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByRole("button", { name: "본문 1", exact: true }).click();
  const title = page.getByLabel("페이지 제목", { exact: true });
  await expect(title).toHaveValue("변화의 흐름 1");

  // Cancelling the pick changes nothing.
  await page.getByLabel("사진 카드로 바꾸기").setInputFiles([]);
  await expect(title).toBeVisible();

  await page.getByLabel("사진 카드로 바꾸기").setInputFiles(photo);
  await expect(
    page.getByRole("button", { name: "사진 1", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("원래 요약은 보관되었습니다")).toBeVisible();
  await page.getByRole("button", { name: "＋ 문구 추가" }).click();
  await page.getByLabel("사진 문구").fill("부두의 컨테이너");
  await page.getByRole("button", { name: "화면 채우기" }).click();
  await expect
    .poll(async () => (await project(page, first.id)).copy.pages[0].photoCard)
    .toMatchObject({
      text: "부두의 컨테이너",
      fit: "cover",
      textVisible: true,
    });

  await page.locator(".editor").screenshot({
    path: `${process.env.E2E_ARTIFACT_DIR}/photo-card-editor.png`,
  });

  // Back to text: the original summary is intact; the photo stays stored.
  await page.getByRole("button", { name: "텍스트 카드로 되돌리기" }).click();
  await expect(title).toHaveValue("변화의 흐름 1");
  await page.getByRole("button", { name: "보관된 사진으로 바꾸기" }).click();
  await expect(page.getByLabel("사진 문구")).toHaveValue("부두의 컨테이너");

  // Photo cards: one converted + two added reaches the limit of three.
  for (let n = 0; n < 2; n++) {
    await expect(page.locator(".progress")).toHaveCount(0);
    await page.getByLabel("사진 카드 추가").setInputFiles(photo);
  }
  await expect(
    page.getByText("전체 5장 · 사진 4/4장(표지 포함)"),
  ).toBeVisible();
  await expect(page.getByLabel("사진 카드 추가")).toBeDisabled();
  await expect(page.locator(".progress")).toHaveCount(0);
  await page.getByRole("button", { name: "텍스트 카드 추가" }).click();
  await expect(page.locator(".add-card").getByText("전체 6장")).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "이 카드 삭제" }).click();
  await expect(page.locator(".add-card").getByText("전체 5장")).toBeVisible();

  // Generating all rewrites the text card only.
  await page.getByRole("button", { name: "01원문과 제작 방향" }).click();
  const all = page.waitForResponse((r) => r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await all).json();
  expect(p.copy.pages.map((pg: any) => pg.kind ?? "text")).toEqual([
    "photo",
    "text",
    "photo",
    "photo",
  ]);
  expect(p.copy.pages[0]).toMatchObject({
    title: "변화의 흐름 1",
    photoCard: { text: "부두의 컨테이너" },
  });
  await expect(page.locator(".progress")).toHaveCount(0);
  const rendered = await project(page, first.id);
  expect(rendered.renders).toHaveLength(5);
  expect(rendered.renderRevision).toBe(rendered.revision);
});

test("converting saves the card's text drafts first; a failed save changes nothing", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const generated = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const first = await (await generated).json();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByRole("button", { name: "본문 1", exact: true }).click();
  await page.getByLabel("페이지 제목", { exact: true }).fill("직접 고친 제목");

  // The card's save fails: it stays a text card with the draft kept.
  await page.route(`**/api/projects/${first.id}`, (route) =>
    route.request().method() === "PUT" &&
    route.request().postDataJSON().copy.pages[0].kind === "photo"
      ? route.fulfill({ status: 500, json: { message: "저장 실패" } })
      : route.continue(),
  );
  await page.getByLabel("사진 카드로 바꾸기").setInputFiles(photo);
  await expect(page.getByRole("alert")).toContainText("저장 실패");
  await expect(
    page.getByRole("button", { name: "본문 1", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("페이지 제목", { exact: true })).toHaveValue(
    "직접 고친 제목",
  );
  await page.unroute(`**/api/projects/${first.id}`);

  await page.getByLabel("사진 카드로 바꾸기").setInputFiles(photo);
  await expect(
    page.getByRole("button", { name: "사진 1", exact: true }),
  ).toBeVisible();
  const saved = await project(page, first.id);
  expect(saved.copy.pages[0]).toMatchObject({
    kind: "photo",
    title: "직접 고친 제목",
  });
  expect(
    await page.evaluate(
      (id) => localStorage.getItem("editor-drafts:" + id),
      first.id,
    ),
  ).toBe("{}");
  await page.getByRole("button", { name: "텍스트 카드로 되돌리기" }).click();
  await expect(page.getByLabel("페이지 제목", { exact: true })).toHaveValue(
    "직접 고친 제목",
  );
});
