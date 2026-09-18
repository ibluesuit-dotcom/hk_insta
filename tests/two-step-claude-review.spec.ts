// Claude 단독 검수 프로브 (two-step editor). 격리 /tmp 데이터·모의 AI·검수 전용 계정에서만 실행한다.
// DATA_DIR=/tmp/... E2E_ARTIFACT_DIR=/tmp/... REVIEW_AUTH=1 REVIEW_PORT=4412 \
//   REVIEW_MATCH=two-step-claude-review.spec.ts npx playwright test -c tests/login-review.config.ts
import type { Page } from "@playwright/test";
import { test, expect } from "./auth-fixture";
import yauzl from "yauzl";
import fs from "node:fs";
import { encodeHeadlineLines } from "../shared/model";
const out = process.env.E2E_ARTIFACT_DIR + "/claude";
fs.mkdirSync(out, { recursive: true });
function zipEntries(bytes: Buffer): Promise<Record<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      const entries: Record<string, Buffer> = {};
      zip.on("error", reject);
      zip.on("end", () => resolve(entries));
      zip.on("entry", (entry) =>
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => {
            entries[entry.fileName] = Buffer.concat(chunks);
            zip.readEntry();
          });
        }),
      );
      zip.readEntry();
    });
  });
}
const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
const title = "9/18 한은 기준금리 동결…원/달러 환율 1,400원 돌파하나";
async function setup(page: Page, sourceTitle = title, count = 2) {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByRole("button", { name: "+ 새 카드 만들기" }).click();
  await expect(page.locator(".progress")).toHaveCount(0);
  await page.getByLabel("원문 제목", { exact: true }).fill(sourceTitle);
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("본문 페이지 수").selectOption(String(count));
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);
  const response = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const rendered = await response;
  expect(rendered.ok(), await rendered.text()).toBe(true);
  await expect(page.locator(".progress")).toHaveCount(0);
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  return rendered.json();
}
const refresh = (page: Page) =>
  page.getByRole("button", { name: /▧ 전체.*미리보기 갱신/ });
const download = (page: Page) =>
  page.getByRole("link", { name: "내보내기", exact: true });
const headline = (page: Page) => page.getByLabel("표지 제목", { exact: true });
async function update(page: Page) {
  const response = page.waitForResponse((r) => r.url().endsWith("/render"));
  await refresh(page).click();
  const rendered = await response;
  await expect(page.locator(".progress")).toHaveCount(0);
  return rendered;
}
const drafts = (page: Page, id: string) =>
  page.evaluate(
    (id) => JSON.parse(localStorage.getItem("editor-drafts:" + id) || "{}"),
    id,
  );

test("P1 title field equals rendered lines, slash escape, manual break controls PNG", async ({
  page,
  request,
}) => {
  const p = await setup(page);
  // Default: literal source title is untouched, field shows actual render lines.
  expect(p.copy.headline).toBe(title);
  expect(p.copy.headlineMode).toBe("literal");
  expect(p.coverLayout.lines.join(" ")).toBe(title);
  await expect(headline(page)).toHaveValue(
    encodeHeadlineLines(p.coverLayout.lines),
  );
  expect(await headline(page).inputValue()).toContain("9\\/18");
  expect(await headline(page).inputValue()).toContain("원\\/달러");
  expect(await drafts(page, p.id)).toEqual({});
  await expect(page.locator(".draft-notice")).toHaveCount(0);
  await expect(download(page)).toHaveAttribute("href", /download$/);
  fs.writeFileSync(
    out + "/p1-auto-lines.json",
    JSON.stringify(
      { field: await headline(page).inputValue(), lines: p.coverLayout.lines },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    out + "/p1-auto-cover.png",
    await (await request.get(`/api/projects/${p.id}/png/0`)).body(),
  );
  // Reload keeps display without creating a draft/dirty state.
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(headline(page)).toHaveValue(
    encodeHeadlineLines(p.coverLayout.lines),
  );
  expect(await drafts(page, p.id)).toEqual({});
  // Manual: move the boundaries.
  const manual = "9\\/18 한은 기준금리 / 동결…원\\/달러 환율 / 1,400원 돌파하나";
  await headline(page).fill(manual);
  await expect(headline(page)).toHaveValue(manual);
  await expect(download(page)).not.toHaveAttribute("href", /.+/);
  const rendered = await update(page);
  expect(rendered.ok(), await rendered.text()).toBe(true);
  const q = await rendered.json();
  expect(q.coverLayout.lines).toEqual([
    "9/18 한은 기준금리",
    "동결…원/달러 환율",
    "1,400원 돌파하나",
  ]);
  expect(q.copy.headlineMode).toBe("escaped");
  expect(q.copy.headlineEvidence).toEqual(p.copy.headlineEvidence);
  await expect(headline(page)).toHaveValue(manual);
  fs.writeFileSync(
    out + "/p1-manual-cover.png",
    await (await request.get(`/api/projects/${p.id}/png/0`)).body(),
  );
  await page.screenshot({ path: out + "/p1-editor-desktop.png", fullPage: true });
  // Back to automatic by removing separators: renderer picks, field reflects it.
  await headline(page).fill("9\\/18 한은 기준금리 동결…원\\/달러 환율 1,400원 돌파하나");
  const auto = await (await update(page)).json();
  expect(auto.coverLayout.lines).toEqual(p.coverLayout.lines);
  await expect(headline(page)).toHaveValue(
    encodeHeadlineLines(p.coverLayout.lines),
  );
  // Invalid: 4 lines -> client warning, render rejected, edits kept.
  await headline(page).fill("가 / 나 / 다 / 라");
  await expect(page.getByRole("alert").filter({ hasText: "최대 3줄" })).toBeVisible();
  const bad = await update(page);
  expect(bad.ok()).toBe(false);
  await expect(headline(page)).toHaveValue("가 / 나 / 다 / 라");
  await expect(download(page)).not.toHaveAttribute("href", /.+/);
});

test("P2 legacy manual / literal projects keep semantics until edited", async ({
  page,
  request,
}) => {
  const p = await setup(page, "", 1);
  // Simulate legacy manual project via API (no mode metadata, unescaped slash breaks).
  const current = await (await request.get(`/api/projects/${p.id}`)).json();
  delete current.history;
  delete current.copy.headlineMode;
  current.copy.headline = "금리 동결 / 수출 회복";
  const put = await request.put(`/api/projects/${p.id}`, { data: current });
  expect(put.ok(), await put.text()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(headline(page)).toHaveValue("금리 동결 / 수출 회복");
  const r = await (await update(page)).json();
  expect(r.copy.headline).toBe("금리 동결 / 수출 회복");
  expect(r.copy.headlineMode).toBeUndefined();
  expect(r.coverLayout.lines).toEqual(["금리 동결", "수출 회복"]);
  await expect(headline(page)).toHaveValue("금리 동결 / 수출 회복");
  expect(await drafts(page, p.id)).toEqual({});
});

test("P3 batch cross-page save, failed PUT and failed render recover", async ({
  page,
  request,
}) => {
  const p = await setup(page);
  const puts: any[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT") puts.push(r.postDataJSON());
  });
  await page.getByLabel("부제").fill("검수 부제");
  await page.getByLabel("사진 크레딧").fill("사진 검수");
  await page.getByLabel("게시용 캡션").fill("검수 캡션 #배치");
  await page.getByLabel("표지 대체 텍스트").fill("검수 표지 대체");
  await page.getByRole("button", { name: "본문 1", exact: true }).click();
  await page.getByLabel("페이지 본문").fill("검수 본문 하나");
  await page.getByLabel("본문 글자 크기").selectOption("56");
  await page.getByRole("button", { name: "본문 2", exact: true }).click();
  await page.getByLabel("페이지 제목").fill("검수 제목 둘");
  await page.getByLabel("이 페이지 대체 텍스트").fill("검수 본문2 대체");
  await page.waitForTimeout(1200); // beyond autosave debounce
  expect(puts.length, "drafts must not autosave").toBe(0);
  await expect(page.locator(".draft-notice")).toContainText("미반영 초안 8개");
  await expect(download(page)).not.toHaveAttribute("href", /.+/);
  // Direct API still serves the OLD fresh render (server cannot see browser drafts): record.
  const before = await request.get(`/api/projects/${p.id}/download`);
  fs.writeFileSync(out + "/p3-api-while-drafts.txt", String(before.status()));

  // 1) PUT fails (500): nothing rendered, drafts intact.
  let renders = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/render")) renders++;
  });
  await page.route("**/api/projects/*", async (route) => {
    if (route.request().method() === "PUT")
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "INPUT", message: "모의 저장 실패" }),
      });
    return route.fallback();
  });
  await refresh(page).click();
  await expect(page.getByRole("alert").first()).toContainText("모의 저장 실패");
  expect(renders).toBe(0);
  expect(Object.keys(await drafts(page, p.id)).length).toBe(8);
  await expect(page.getByLabel("페이지 제목")).toHaveValue("검수 제목 둘");
  await expect(download(page)).not.toHaveAttribute("href", /.+/);
  await page.screenshot({ path: out + "/p3-put-failed.png", fullPage: true });
  // reload also keeps drafts
  await page.unroute("**/api/projects/*");
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.locator(".draft-notice")).toContainText("미반영 초안 8개");
  await expect(page.getByLabel("부제")).toHaveValue("검수 부제");

  // 2) render fails after a good PUT: edits saved, export stays disabled.
  await page.route("**/render", (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "RENDER", message: "모의 렌더 실패" }),
    }),
  );
  puts.length = 0;
  await refresh(page).click();
  await expect(page.getByRole("alert").first()).toContainText("모의 렌더 실패");
  expect(puts.length).toBe(1);
  expect(puts[0].copy.kicker).toBe("검수 부제");
  expect(puts[0].copy.pages[0].body).toBe("검수 본문 하나");
  expect(puts[0].copy.pages[1].title).toBe("검수 제목 둘");
  expect(puts[0].copy.pages[1].alt).toBe("검수 본문2 대체");
  expect(puts[0].copy.caption).toBe("검수 캡션 #배치");
  expect(puts[0].copy.alt).toBe("검수 표지 대체");
  expect(puts[0].credit).toBe("사진 검수");
  expect(puts[0].bodyFont).toBe(56);
  expect(puts[0].partialDirection).toBe("");
  expect(puts[0]).not.toHaveProperty("editorDrafts");
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(saved.copy.pages[1].title).toBe("검수 제목 둘");
  expect(saved.renderRevision).not.toBe(saved.revision);
  await expect(page.getByLabel("부제")).toHaveValue("검수 부제");
  await expect(download(page)).not.toHaveAttribute("href", /.+/);
  await expect(page.locator(".stale")).toBeVisible();
  expect((await request.get(`/api/projects/${p.id}/download`)).status()).toBe(400);
  expect((await request.get(`/api/projects/${p.id}/png/0`)).status()).toBe(400);
  await page.screenshot({ path: out + "/p3-render-failed.png", fullPage: true });
  await page.unroute("**/render");

  // 3) real renderer failure (body overflow) then recovery.
  await page.getByRole("button", { name: "본문 1", exact: true }).click();
  await page.getByLabel("페이지 본문").fill("넘치는 본문 문장입니다. ".repeat(40));
  const overflow = await update(page);
  expect(overflow.ok()).toBe(false);
  await expect(page.getByRole("alert").first()).toContainText("본문 1장이 넘칩니다");
  await expect(page.getByLabel("페이지 본문")).toHaveValue(/넘치는 본문/);
  await expect(download(page)).not.toHaveAttribute("href", /.+/);
  await page.getByLabel("페이지 본문").fill("검수 본문 하나");
  const ok = await update(page);
  expect(ok.ok(), await ok.text()).toBe(true);
  const done = await ok.json();
  expect(done.renders.length).toBe(3);
  expect(done.renderRevision).toBe(done.revision);
  expect(await drafts(page, p.id)).toEqual({});
  await expect(download(page)).toHaveAttribute("href", /download$/);

  // ZIP content = saved batch, PNG identical to preview files, no approval needed.
  expect(done.copyApproved).toBe(false);
  expect(done.imageApproved).toBe(false);
  const zip = await request.get(`/api/projects/${p.id}/download`);
  expect(zip.status()).toBe(200);
  const entries = await zipEntries(await zip.body());
  expect(Object.keys(entries)).toEqual([
    "01-cover.png",
    "02-body.png",
    "03-body.png",
    "caption.txt",
    "alt-text.txt",
    "manifest.json",
  ]);
  expect(entries["caption.txt"].toString()).toBe("검수 캡션 #배치");
  expect(entries["alt-text.txt"].toString()).toContain("01: 검수 표지 대체");
  expect(entries["alt-text.txt"].toString()).toContain("03: 검수 본문2 대체");
  for (const [i, name] of ["01-cover.png", "02-body.png", "03-body.png"].entries()) {
    const preview = await (await request.get(done.renders[i])).body();
    expect(entries[name].equals(preview)).toBe(true);
    fs.writeFileSync(out + "/p3-" + name, entries[name]);
  }
  // Stale after any content PUT; partial legacy render does not unlock export.
  const cur = await (await request.get(`/api/projects/${p.id}`)).json();
  delete cur.history;
  cur.copy.pages[0].body = "API 직접 수정";
  const put = await request.put(`/api/projects/${p.id}`, { data: cur });
  expect(put.ok()).toBe(true);
  const rev = (await put.json()).revision;
  expect((await request.get(`/api/projects/${p.id}/download`)).status()).toBe(400);
  expect((await request.get(`/api/projects/${p.id}/png/1`)).status()).toBe(400);
  const partial = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: rev, only: 1 },
  });
  expect(partial.ok()).toBe(true);
  expect((await request.get(`/api/projects/${p.id}/download`)).status()).toBe(400);
  expect((await request.get(`/api/projects/${p.id}/png/1`)).status()).toBe(400);
  // Archive must not offer ZIP for this stale project.
  await page.reload();
  await page.getByRole("button", { name: /작업 보관함/ }).click();
  const card = page.locator(".archive-card").filter({ hasText: "총 3장" }).first();
  await expect(card).toBeVisible();
  await expect(card.getByRole("link", { name: /ZIP/ })).toHaveCount(0);
  await expect(page.getByText(/승인/)).toHaveCount(0);
  await page.screenshot({ path: out + "/p3-archive.png", fullPage: true });
});

test("P4 anonymous export denied; no approval wording; desktop/mobile screenshots", async ({
  page,
  playwright,
  baseURL,
}) => {
  const p = await setup(page);
  const anon = await playwright.request.newContext({ baseURL });
  expect((await anon.get(`/api/projects/${p.id}/download`)).status()).toBe(401);
  expect((await anon.get(`/api/projects/${p.id}/png/0`)).status()).toBe(401);
  await anon.dispose();
  await expect(page.getByText(/승인|검수 완료|03/)).toHaveCount(0);
  await expect(page.locator("nav.steps button")).toHaveCount(2);
  await expect(page.getByRole("button", { name: / 수정$/ })).toHaveCount(0);
  // export is the element right after refresh
  const order = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".preview-panel > *")];
    const i = b.findIndex((e) => e.textContent?.includes("미리보기 갱신") && e.tagName === "BUTTON");
    return b[i + 1]?.textContent || "";
  });
  expect(order).toContain("내보내기");
  await page.screenshot({ path: out + "/p4-desktop-cover.png", fullPage: true });
  await page.getByRole("button", { name: "본문 1", exact: true }).click();
  await page.getByLabel("페이지 제목").fill("초안 상태 확인");
  await page.screenshot({ path: out + "/p4-desktop-body-draft.png", fullPage: true });
  for (const w of [390, 320]) {
    await page.setViewportSize({ width: w, height: 844 });
    await page.screenshot({ path: out + `/p4-mobile-${w}.png`, fullPage: true });
    const metrics = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
      wide: [...document.querySelectorAll(".editor *, .preview-panel *")]
        .filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1)
        .slice(0, 12)
        .map((e) => e.tagName + "." + e.className + ":" + Math.round(e.getBoundingClientRect().right)),
    }));
    fs.writeFileSync(out + `/p4-mobile-${w}.json`, JSON.stringify(metrics, null, 2));
  }
});
