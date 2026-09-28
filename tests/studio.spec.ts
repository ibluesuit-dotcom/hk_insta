import { test, expect } from "./auth-fixture";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
const article =
  "산업통상자원부는 9월 1일 지난달 수출이 전년 동기 대비 증가했다고 밝혔다. 자동차와 반도체 수출이 증가세를 이끌었다. 이번 집계는 잠정치이며 품목별 확정 수치는 추후 발표할 예정이다. 수출 증가가 모든 업종의 실적 개선을 뜻하는 것은 아니다.";
test.beforeAll(async () => {
  await fs.mkdir(
    (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") + "/e2e",
    { recursive: true },
  );
});
test("source → photo → PNG ZIP → archive duplicate restore", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByLabel("작업 이름").fill("E2E 경제 뉴스");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(article);
  await page
    .getByLabel("표지 사진 첨부")
    .setInputFiles(
      "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
    );
  await expect(page.locator(".photo-drop img")).toBeVisible();
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page.locator(".feed-image img")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.getByLabel("표지 제목", { exact: true })).toHaveValue(
    "금리와 수출 동향",
  );
  await page
    .getByLabel("표지 사진 첨부")
    .setInputFiles(
      path.resolve(
        "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
      ),
    );
  await expect(page.locator(".photo-drop img")).toBeVisible();
  await page.getByLabel("headline 잠금").click();
  const refreshed = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page
    .getByRole("button", { name: "▧ 전체 2장 렌더 · 미리보기 갱신" })
    .click();
  expect((await refreshed).ok()).toBe(true);
  await expect(page.locator(".progress")).toHaveCount(0);
  await expect(page.locator(".feed-image img")).toBeVisible({ timeout: 30000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path:
      (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/01-editor.png",
    fullPage: true,
  });
  // The mock account controls were removed from the editor; the freshly
  // rendered project must stay exportable without approval.
  const display = await (
    await request.get(
      "/api/projects/" +
        (await page.evaluate(() => sessionStorage.getItem("studio-project"))),
    )
  ).json();
  expect(display.imageApproved).toBe(false);
  expect(display.copyApproved).toBe(false);
  expect(display.renderRevision).toBe(display.revision);

  const zip = page.waitForEvent("download");
  await page.getByRole("link", { name: "내보내기", exact: true }).click();
  await (
    await zip
  ).saveAs(
    (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/e2e-export.zip",
  );
  await fs.writeFile(
    (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") + "/e2e/cover.png",
    await (await request.get(`/api/projects/${display.id}/png/0`)).body(),
  );
  const meta = await sharp(
    (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") + "/e2e/cover.png",
  ).metadata();
  expect([meta.width, meta.height]).toEqual([1080, 1350]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path:
      (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/02-export.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "다음 카드" }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path:
      (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/03-body-phone.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "작업 보관함" }).click();
  await expect(
    page.getByRole("heading", { name: "E2E 경제 뉴스" }).first(),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path:
      (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/04-archive.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "이어서 편집" }).first().click();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.getByLabel("표지 제목", { exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "버전 기록" }).click();
  await expect(
    page.getByRole("heading", { name: "이전 버전 복원" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "복원", exact: true }).first().click();
  await expect(page.locator(".badge").first()).toContainText(
    "미리보기 갱신 필요",
  );
  await page.getByRole("button", { name: "작업 보관함" }).click();
  await page.getByRole("button", { name: "복제", exact: true }).first().click();
  await expect(page.getByLabel("작업 이름")).toHaveValue(
    "E2E 경제 뉴스 (복사)",
  );
});
test("server stale writes and extraction/photo errors", async ({ request }) => {
  let p = await (await request.post("/api/projects")).json();
  const stale = structuredClone(p);
  p.sourceTitle = "금리와 수출 동향";
  p.source = article;
  const saved = await request.put("/api/projects/" + p.id, { data: p });
  expect(saved.ok()).toBeTruthy();
  expect(
    (await request.put("/api/projects/" + p.id, { data: stale })).status(),
  ).toBe(409);
  const extraction = await request.post("/api/extract/url", {
    data: { url: "http://127.0.0.1" },
  });
  expect(extraction.ok()).toBeFalsy();
  expect((await extraction.json()).code).toBe("EXTRACTION");
  const photo = await request.post("/api/photos", {
    multipart: {
      file: {
        name: "bad.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("invalid"),
      },
    },
  });
  expect((await photo.json()).code).toBe("IMAGE");
});

test("three bodies, preserved cover locks, exact dimensions, overflow recovery, stale AI", async ({
  request,
}) => {
  let p = await (await request.post("/api/projects")).json();
  p.sourceTitle = "금리와 수출 동향";
  p.source = article;
  p.sourceConfirmed = true;
  p.photo = (
    await (
      await request.post("/api/photos", {
        multipart: {
          file: {
            name: "cover.jpg",
            mimeType: "image/jpeg",
            buffer: await sharp({
              create: {
                width: 1080,
                height: 1350,
                channels: 3,
                background: "#123456",
              },
            })
              .jpeg()
              .toBuffer(),
          },
        },
      })
    ).json()
  ).url;
  p.name = "다중 카드 검증";
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  p = await (
    await request.post(`/api/projects/${p.id}/generate`, {
      data: { revision: p.revision, scope: "all" },
    })
  ).json();
  const photo = await request.post("/api/photos", {
    multipart: {
      file: {
        name: "sample.jpg",
        mimeType: "image/jpeg",
        buffer: await fs.readFile(
          "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
        ),
      },
    },
  });
  p.photo = (await photo.json()).url;
  p.copy.headline = "8월 스위스 무역 흑자, 37억 9천만 스위스 프랑 기록";
  p.headlineBreaks = "8월 스위스 무역 흑자,\n37억 9천만\n스위스 프랑 기록";
  p.copy.highlight = "37억 9천만 스위스 프랑 기록";
  p.copy.kicker = "전년 동기 대비 +120% 성장";
  p.credit = "사진 연합뉴스";
  p.locks.headline = true;
  p.locks.kicker = true;
  p.focal = { x: 52, y: 38, zoom: 1 };
  p.count = 3;
  p.copy.pages.push(
    structuredClone(p.copy.pages[0]),
    structuredClone(p.copy.pages[0]),
  );
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  const before = structuredClone(p);
  p = await (
    await request.post(`/api/projects/${p.id}/generate`, {
      data: { revision: p.revision, scope: "pages" },
    })
  ).json();
  expect(p.photo).toBe(before.photo);
  expect(p.copy.headline).toBe(before.copy.headline);
  expect(p.locks.headline).toBe(true);
  // Partial AI output is a candidate; only an explicit PUT commits it.
  expect(p.revision).toBe(before.revision);
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  p = await (
    await request.post(`/api/projects/${p.id}/render`, {
      data: { revision: p.revision },
    })
  ).json();
  expect(p.renders).toHaveLength(4);
  for (const file of p.renders) {
    const image = await request.get(file);
    const metadata = await sharp(await image.body()).metadata();
    expect([metadata.width, metadata.height]).toEqual([1080, 1350]);
  }
  await fs.writeFile(
    (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/reference-cover.png",
    await (await request.get(p.renders[0])).body(),
  );
  p.copy.kicker = "이 부제는 스무 글자를 훨씬 넘겨서 렌더가 거절되어야 합니다";
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  const overflow = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision },
  });
  expect((await overflow.json()).code).toBe("RENDER");
  p.copy.kicker = "";
  p.copy.headline = "아주긴고유명사".repeat(25);
  p.headlineBreaks = "";
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  const title = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision },
  });
  expect((await title.json()).message).toContain("72px");
  p.partialDirection = "stale-test";
  const generating = request.post(`/api/projects/${p.id}/generate`, {
    data: { revision: p.revision, scope: "pages", extra: "stale-" + p.id },
  });
  await new Promise((r) => setTimeout(r, 150));
  p.direction = "새로운 방향";
  const changed = await request.put(`/api/projects/${p.id}`, { data: p });
  expect(changed.ok()).toBeTruthy();
  expect((await generating).status()).toBe(409);
  const final = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(final.direction).toBe("새로운 방향");
  const restored = await (
    await request.post(`/api/projects/${p.id}/restore`, {
      data: { revision: final.revision, version: before.revision },
    })
  ).json();
  expect(restored.photo).toBe(before.photo);
  expect(restored.focal).toEqual(before.focal);
  expect(restored.locks).toEqual(before.locks);
  expect(restored.copy.headline).toBe(before.copy.headline);
  expect(restored.imageApproved).toBe(false);
});

test("file upload returns per-file extraction and errors", async ({
  request,
}) => {
  const res = await request.post("/api/extract/files", {
    multipart: {
      files: {
        name: "script.txt",
        mimeType: "text/plain",
        buffer: Buffer.from(article),
      },
    },
  });
  expect(res.ok()).toBeTruthy();
  expect((await res.json())[0].text).toBe(article);
  const bad = await request.post("/api/extract/files", {
    multipart: {
      files: {
        name: "script.exe",
        mimeType: "application/octet-stream",
        buffer: Buffer.from("bad file"),
      },
    },
  });
  expect((await bad.json())[0].error).toContain("TXT");
});

test("long actions disable edits and preserve saved generation without an autosave race", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(article + " " + Date.now());
  const started = page.waitForRequest((r) => r.url().endsWith("/generate"));
  await page
    .getByLabel("표지 사진 첨부")
    .setInputFiles(
      "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
    );
  await expect(page.locator(".photo-drop img")).toBeVisible();
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const generating = await started;
  await expect(page.getByLabel("통합 원문")).toBeDisabled();
  await expect(page.getByLabel("본문 페이지 수")).toBeDisabled();
  expect(
    await page
      .locator("textarea:enabled, input:enabled, select:enabled")
      .count(),
  ).toBe(0);
  await page.screenshot({
    path:
      (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/disabled-during-ai.png",
    fullPage: true,
  });
  await expect(page.locator(".feed-image img")).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.getByLabel("표지 제목", { exact: true })).toHaveValue(
    "금리와 수출 동향",
  );
  await expect(page.getByLabel("표지 제목", { exact: true })).toBeEnabled();
  await page.waitForTimeout(900);
  const url = generating.url().replace(/\/generate$/, "");
  const p = await (await request.get(url)).json();
  expect(p.copy.headline).toBe("금리와 수출 동향");
  expect(p.generation.scope).toBe("all");
  await expect(page.locator(".error")).toHaveCount(0);
});

test("page reduction asks before loss and reorder carries locks", async ({
  page,
  request,
}) => {
  let p = await (await request.post("/api/projects")).json();
  p.name = "페이지 보존 " + Date.now();
  p.count = 3;
  p.copy.pages = [1, 2, 3].map((i) => ({
    ...p.copy.pages[0],
    title: `제목 ${i}`,
    body: `확정 문안 ${i}`,
  }));
  p.locks["page:2"] = true;
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  await page.goto("/");
  await page.getByRole("button", { name: "작업 보관함" }).click();
  await page.getByPlaceholder("작업 제목 검색").fill(p.name);
  await page.getByRole("button", { name: "이어서 편집" }).click();
  page.once("dialog", (d) => d.dismiss());
  await page.getByLabel("본문 페이지 수").selectOption("2");
  await expect(page.getByLabel("본문 페이지 수")).toHaveValue("3");
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByRole("button", { name: "본문 3", exact: true }).click();
  await page.getByRole("button", { name: "← 본문 앞으로" }).click();
  await expect(page.getByLabel("page:1 잠금")).toContainText("잠김");
  await page.getByRole("button", { name: "지금 저장", exact: true }).click();
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(saved.copy.pages[1].body).toBe("확정 문안 3");
  expect(saved.locks["page:1"]).toBe(true);
});

test("strict API drafts, clean errors, cache reuse and invalidation", async ({
  request,
}) => {
  let p = await (await request.post("/api/projects")).json();
  for (const patch of [
    { bodyFont: undefined },
    { bodyFont: 54.5 },
    { copy: { ...p.copy, headline: 12 } },
    { locks: "bad" },
    { attachments: [{}] },
    { unknown: true },
  ]) {
    const r = await request.put(`/api/projects/${p.id}`, {
      data: { ...p, ...patch },
    });
    expect(r.status()).toBe(400);
    expect((await r.json()).message).not.toContain("/Users/");
  }
  const missing = await request.get("/api/projects/nonexistent-fix-test");
  expect(missing.status()).toBe(404);
  expect((await missing.json()).message).toContain("찾을 수 없습니다");
  p.sourceTitle = "금리와 수출 동향";
  p.source = article + " " + p.id;
  p.sourceConfirmed = true;
  p.photo = (
    await (
      await request.post("/api/photos", {
        multipart: {
          file: {
            name: "cover.jpg",
            mimeType: "image/jpeg",
            buffer: await sharp({
              create: {
                width: 1080,
                height: 1350,
                channels: 3,
                background: "#123456",
              },
            })
              .jpeg()
              .toBuffer(),
          },
        },
      })
    ).json()
  ).url;
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  const gen = async (extra = "") => {
    p = await (
      await request.post(`/api/projects/${p.id}/generate`, {
        data: { revision: p.revision, scope: "all", extra },
      })
    ).json();
    return p;
  };
  expect((await gen()).generation.cached).toBe(false);
  expect((await gen()).generation.cached).toBe(true);
  expect((await gen("새 방향")).generation.cached).toBe(false);
});

test("save conflict retains local edits and offers draft download and explicit recovery", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.route("**/api/projects/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({
          status: 409,
          contentType: "application/json",
          body: JSON.stringify({
            code: "CONFLICT",
            message: "다른 창의 변경과 충돌했습니다.",
          }),
        })
      : route.continue(),
  );
  await page
    .getByLabel("통합 원문")
    .fill("저장되지 않은 문안은 창에 남아 있어야 합니다.");
  await expect(
    page.getByRole("button", { name: "로컬 초안 보관" }),
  ).toBeVisible();
  await expect(page.getByLabel("통합 원문")).toHaveValue(
    "저장되지 않은 문안은 창에 남아 있어야 합니다.",
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "로컬 초안 보관" }).click();
  await (
    await downloaded
  ).saveAs(
    (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/recoverable-local-draft.json",
  );
  await page.screenshot({
    path:
      (process.env.E2E_ARTIFACT_DIR || "docs/fix-evidence") +
      "/e2e/recoverable-conflict.png",
    fullPage: true,
  });
});
