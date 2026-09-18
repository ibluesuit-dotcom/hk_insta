// 02 편집 탭에서 사진 크레딧 · 게시용 캡션 · 표지 대체 텍스트 · 목업 계정 설정 제거 검수 프로브 (Claude 단독).
// tests/login-review.config.ts + REVIEW_AUTH=1 + REVIEW_MATCH=editor-controls-removal-review.spec.ts 로 격리 실행한다.
import { test, expect, Page } from "@playwright/test";
import fs from "node:fs/promises";
import { execFileSync } from "node:child_process";
test.skip(process.env.REVIEW_AUTH !== "1", "Run with the isolated authenticated login-review config");
const evidence = process.env.E2E_ARTIFACT_DIR + "/editor-controls-removal";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
const kept = {
  credit: "사진=검수통신",
  profile: "review_account",
  caption: "검수용 보존 캡션 #보존",
  alt: "검수용 보존 표지 대체 텍스트",
};
async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("아이디").fill("test");
  await page.getByLabel("비밀번호").fill("review-pass-2026");
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
}
const activeId = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("studio-project"));
const current = (body: any) => body.current ?? body;
const project = async (page: Page, id: string) =>
  current(await (await page.request.get("/api/projects/" + id)).json());
async function removedAbsent(page: Page) {
  const editor = page.locator("section.editor, .editor").first();
  for (const text of [/사진 크레딧/, /게시용 캡션/, /표지 대체 텍스트/, /목업 계정/, /계정 이름/, /프로필 사진/])
    await expect(editor.getByText(text)).toHaveCount(0);
  for (const label of [/크레딧/, /캡션/, /표지 대체 텍스트/, /계정/, /프로필/])
    await expect(editor.getByLabel(label)).toHaveCount(0);
}
test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
});

test("생성 → 02 편집(4개 항목 없음, 나머지 유지) → 미리보기 갱신 → 내보내기", async ({ page }) => {
  await login(page);
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const gen = page.waitForResponse((r) => r.url().endsWith("/generate"));
  const render = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  expect((await gen).status()).toBe(200);
  expect((await render).status()).toBe(200);
  const id = (await activeId(page))!;
  const generated = await project(page, id);
  expect(generated.copy.caption).toBeTruthy();
  expect(generated.copy.alt).toBeTruthy();

  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  // 표지
  await removedAbsent(page);
  for (const label of ["표지 제목", "부제", "노란색 강조 시작 줄"])
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await expect(page.getByText("메인 카드 배경 이미지")).toBeVisible();
  await expect(page.locator(".crop-frame")).toBeVisible();
  // 슬라이더 라벨은 값 텍스트를 포함하므로 클래스로 확인한다 (가로·세로·확대)
  await expect(page.locator("label.slider input[type=range]")).toHaveCount(3);
  await expect(page.getByText("보조제목 끄기")).toBeVisible();
  await page.screenshot({ path: `${evidence}/01-cover-edit.png`, fullPage: true });
  // 본문
  await page.locator(".page-tabs button", { hasText: "본문 1" }).click();
  await removedAbsent(page);
  for (const label of ["본문 역할", "페이지 제목", "페이지 본문", "노란색 강조 문구", "본문 글자 크기", "이 페이지 대체 텍스트"])
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  await page.screenshot({ path: `${evidence}/02-body-edit.png`, fullPage: true });

  // 편집 → 미리보기 갱신
  await page.getByLabel("페이지 제목", { exact: true }).fill("검수 편집 제목");
  await page.locator(".page-tabs button", { hasText: "표지" }).click();
  await page.getByLabel("부제", { exact: true }).fill("검수 부제");
  await page.locator("label.slider input[type=range]").first().fill("30");
  const rerender = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: /미리보기 갱신/ }).click();
  expect((await rerender).status()).toBe(200);
  const edited = await project(page, id);
  expect(edited.copy.kicker).toBe("검수 부제");
  expect(edited.copy.pages[0].title).toBe("검수 편집 제목");
  expect(edited.focal.x).toBe(30);
  expect(edited.renderRevision).toBe(edited.revision);
  // 편집하지 않은 캡션·대체 텍스트·크레딧·계정은 그대로
  expect(edited.copy.caption).toBe(generated.copy.caption);
  expect(edited.copy.alt).toBe(generated.copy.alt);
  expect(edited.credit).toBe(generated.credit);
  expect(edited.profile).toBe(generated.profile);

  // 내보내기
  const link = page.getByRole("link", { name: /내보내기/ });
  await expect(link).toHaveAttribute("aria-disabled", "false");
  const zip = await page.request.get((await link.getAttribute("href"))!);
  expect(zip.status()).toBe(200);
  const zipPath = `${evidence}/export.zip`;
  await fs.writeFile(zipPath, await zip.body());
  const names = execFileSync("unzip", ["-Z1", zipPath]).toString().trim().split("\n");
  console.log("zip:", names.join(", "));
  expect(names).toEqual(expect.arrayContaining(["01-cover.png", "caption.txt", "alt-text.txt", "manifest.json"]));
  expect(names.filter((n) => n.endsWith(".png")).length).toBe(edited.count + 1);
  expect(execFileSync("unzip", ["-p", zipPath, "caption.txt"]).toString()).toBe(edited.copy.caption);
  expect(execFileSync("unzip", ["-p", zipPath, "alt-text.txt"]).toString()).toContain("01: " + edited.copy.alt);
  await page.screenshot({ path: `${evidence}/03-refreshed.png`, fullPage: true });
});

test("기존 저장값(크레딧·계정·캡션·표지 대체 텍스트·잠금)이 편집/갱신/내보내기 왕복에서 보존", async ({ page }) => {
  await login(page);
  await page.getByRole("button", { name: "+ 새 카드 만들기", exact: true }).click();
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const render = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  expect((await render).status()).toBe(200);
  const id = (await activeId(page))!;
  // 제거 전 UI로 저장해 둔 값을 API로 재현 (구버전 프로젝트 호환)
  let p = await project(page, id);
  const put = await page.request.put("/api/projects/" + id, {
    data: {
      ...p,
      credit: kept.credit,
      profile: kept.profile,
      copy: { ...p.copy, caption: kept.caption, alt: kept.alt },
      locks: { ...p.locks, caption: true, alt: true },
    },
  });
  expect(put.ok(), await put.text()).toBe(true);
  await page.reload();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await removedAbsent(page);
  await page.getByLabel("표지 제목", { exact: true }).fill("금리와 수출/다시 본다");
  await page.locator(".page-tabs button", { hasText: "본문 1" }).click();
  await page.getByLabel("페이지 본문", { exact: true }).fill("검수용으로 고친 본문입니다. 금리와 수출 지표를 함께 확인했다.");
  const rerender = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: /미리보기 갱신/ }).click();
  expect((await rerender).status(), await (await rerender).text()).toBe(200);
  p = await project(page, id);
  expect(p.copy.pages[0].body).toContain("검수용으로 고친 본문");
  expect({ credit: p.credit, profile: p.profile, caption: p.copy.caption, alt: p.copy.alt }).toEqual(kept);
  expect(p.locks.caption).toBe(true);
  expect(p.locks.alt).toBe(true);
  // 미리보기 목업은 저장된 계정·캡션을 계속 표시
  await expect(page.locator(".ig-caption")).toContainText(kept.profile);
  await expect(page.locator(".ig-caption")).toContainText(kept.caption);
  // 렌더된 표지에 크레딧이 남는지 육안 확인용
  await page.locator(".page-tabs button", { hasText: "표지" }).click();
  await page.screenshot({ path: `${evidence}/04-roundtrip-preview.png`, fullPage: true });
  await fs.copyFile(
    `${process.env.DATA_DIR}/renders/${p.renders[0].split("/").pop()}`,
    `${evidence}/05-roundtrip-cover.png`,
  ).catch((e) => console.log("cover copy skipped:", e.message));

  // 전체 재생성: 잠긴 캡션·대체 텍스트 보존, 크레딧·계정 불변
  await page.getByRole("button", { name: /01/ }).first().click();
  const gen = page.waitForResponse((r) => r.url().endsWith("/generate"));
  const render2 = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  expect((await gen).status()).toBe(200);
  expect((await render2).status()).toBe(200);
  p = await project(page, id);
  expect({ credit: p.credit, profile: p.profile, caption: p.copy.caption, alt: p.copy.alt }).toEqual(kept);

  const zip = await page.request.get(`/api/projects/${id}/download`);
  expect(zip.status()).toBe(200);
  const zipPath = `${evidence}/roundtrip.zip`;
  await fs.writeFile(zipPath, await zip.body());
  expect(execFileSync("unzip", ["-p", zipPath, "caption.txt"]).toString()).toBe(kept.caption);
  expect(execFileSync("unzip", ["-p", zipPath, "alt-text.txt"]).toString()).toContain("01: " + kept.alt);
});
