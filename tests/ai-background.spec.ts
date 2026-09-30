import type { APIRequestContext, Page, Route } from "@playwright/test";
import { test, expect } from "./auth-fixture";
import fs from "node:fs/promises";
import yauzl from "yauzl";
import { randomUUID } from "node:crypto";
import { sourceHash } from "../shared/ai-background";

// AI 배경 화면 흐름(계획서 v3 §4, §6 E2E). MOCK 서버, 생성 스위치 켜짐.
const source =
  "산업통상자원부는 9월 1일 지난달 수출이 전년 동기 대비 증가했다고 밝혔다. 자동차와 반도체 수출이 증가세를 이끌었다. 이번 집계는 잠정치이며 품목별 확정 수치는 추후 발표할 예정이다.";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
const evidence =
  (process.env.E2E_ARTIFACT_DIR || "test-results") + "/ai-background";
const aiUrl = /^\/uploads\/ai-[0-9a-f-]{36}\.jpg$/;

test.beforeAll(async () => {
  await fs.mkdir(evidence, { recursive: true });
});

async function zipEntries(bytes: Buffer): Promise<Record<string, Buffer>> {
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
          stream.on("error", reject);
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
async function manifest(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/projects/${id}/download`);
  expect(response.ok(), await response.text()).toBe(true);
  return JSON.parse(
    (await zipEntries(await response.body()))["manifest.json"].toString(),
  );
}
const picker = (page: Page) =>
  page.getByRole("region", { name: "AI 배경 이미지" });
const card = (page: Page, name: "사진형" | "디지털 아트형") =>
  picker(page).getByRole("article", { name: name + " 후보" });
const badge = (page: Page, name: "사진형" | "디지털 아트형") =>
  card(page, name).locator(".ai-badge").first();
const activeId = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("studio-project")!);
const project = async (request: APIRequestContext, id: string) =>
  (await request.get("/api/projects/" + id)).json();
const isGenerate = (url: string) =>
  /\/ai-background$/.test(new URL(url).pathname);

async function open(page: Page, title = "수출 증가세 이어가") {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  if (title) await page.getByLabel("원문 제목", { exact: true }).fill(title);
  await page.getByLabel("통합 원문").fill(source);
  const name = `AI 배경 ${title || "무제"} ${Date.now()}`;
  await page.getByLabel("작업 이름").fill(name);
  return name;
}
/** Mock copy generation so the cover has a headline to render. */
async function writeCopy(page: Page) {
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".photo-drop img")).toBeVisible();
  const rendered = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  expect((await rendered).ok()).toBe(true);
  await expect(page.locator(".progress")).toHaveCount(0);
}
async function generateBoth(page: Page) {
  await picker(page)
    .getByRole("button", { name: "AI로 이미지 생성하기" })
    .click();
  await expect(badge(page, "사진형")).toHaveText("완료", { timeout: 20000 });
  await expect(badge(page, "디지털 아트형")).toHaveText("완료", {
    timeout: 20000,
  });
}
async function refresh(page: Page) {
  const response = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: /▧ 전체.*미리보기 갱신/ }).click();
  const rendered = await response;
  expect(rendered.ok(), await rendered.text()).toBe(true);
  await expect(page.locator(".progress")).toHaveCount(0);
  return rendered.json();
}
/** Holds generation requests until release() so the test controls timing. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((r) => (release = r));
  return {
    release,
    handler: async (route: Route) => {
      await opened;
      await route.continue();
    },
  };
}

test("버튼 → 두 칸 → 한쪽 실패 → 선택 → 표지 AI 표시, 휴대폰 폭", async ({
  page,
  request,
}) => {
  await open(page);
  await writeCopy(page);
  await expect(picker(page)).toBeVisible();
  // The art slot is refused by the provider; the photo slot needs review.
  await page.route(
    (url) => isGenerate(url.toString()),
    async (route) => {
      if (route.request().postDataJSON().variant === "art")
        return route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({
            code: "AI_BLOCKED",
            message: "생성 거절됨: 안전 정책에 걸렸습니다. (테스트)",
          }),
        });
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          status: "needs_review",
          reviewReason: "[테스트] 기사 인물과 닮아 보일 수 있음",
        },
      });
    },
  );
  await picker(page)
    .getByRole("button", { name: "AI로 이미지 생성하기" })
    .click();
  await expect(badge(page, "사진형")).toHaveText("생성 중…");
  await expect(badge(page, "사진형")).toHaveText("검토 필요", {
    timeout: 20000,
  });
  await expect(card(page, "사진형")).toContainText(
    "[테스트] 기사 인물과 닮아 보일 수 있음",
  );
  await expect(badge(page, "디지털 아트형")).toHaveText("생성 거절됨");
  await expect(card(page, "디지털 아트형").getByRole("alert")).toContainText(
    "안전 정책",
  );
  await expect(
    card(page, "디지털 아트형").getByRole("button", { name: "이 이미지 사용" }),
  ).toHaveCount(0);
  // Scrim preview with the headline and the AI label, and the original link.
  const photoCard = card(page, "사진형");
  await expect(photoCard.locator(".ai-title")).toContainText("수출 증가세");
  await expect(photoCard.locator(".ai-credit")).toHaveText("AI 생성 이미지");
  await expect(
    photoCard.getByRole("link", { name: "원본 보기" }),
  ).toHaveAttribute("href", aiUrl);
  // Nothing changed on the card before "이 이미지 사용".
  const id = await activeId(page);
  expect((await project(request, id)).photo).not.toMatch(aiUrl);

  // Retrying only the refused slot fills it.
  await page.unrouteAll();
  const photoSrc = await photoCard.locator("img").getAttribute("src");
  await card(page, "디지털 아트형")
    .getByRole("button", { name: "다시 만들기" })
    .click();
  await expect(badge(page, "디지털 아트형")).toHaveText("완료", {
    timeout: 20000,
  });
  expect(await photoCard.locator("img").getAttribute("src")).toBe(photoSrc);

  // needs_review only warns; applying is allowed and re-renders the cover.
  const rendered = page.waitForResponse((r) => r.url().endsWith("/render"));
  await photoCard.getByRole("button", { name: "이 이미지 사용" }).click();
  const response = await rendered;
  expect(response.request().postDataJSON().only).toBe(0);
  const cover = await response.json();
  expect(cover.photo).toMatch(aiUrl);
  expect(cover.background).toMatchObject({ source: "ai", variant: "photo" });
  expect(cover.coverRenderRevision).toBe(cover.revision);
  expect(cover.renderRevision).not.toBe(cover.revision);
  expect(cover.imageApproved).toBe(false);
  await expect(badge(page, "사진형")).toHaveText("적용됨");
  await expect(picker(page).locator(".ai-applied")).toContainText(
    "AI 생성 이미지",
  );
  await expect(picker(page).getByRole("status")).toContainText(
    "전체 미리보기 갱신",
  );
  await expect(page.locator(".feed-image img")).toHaveAttribute(
    "src",
    cover.renders[0],
  );
  // A full render records the AI background in the export manifest.
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await refresh(page);
  expect((await manifest(request, id)).background).toMatchObject({
    variant: "photo",
    assetId: cover.background.assetId,
  });

  // Phone width: the picker stays inside the viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "01원문과 제작 방향" }).click();
  await picker(page).scrollIntoViewIfNeeded();
  for (const box of [
    await picker(page).boundingBox(),
    await card(page, "사진형").boundingBox(),
    await card(page, "디지털 아트형").boundingBox(),
  ]) {
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(
    await picker(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
  await picker(page).screenshot({ path: `${evidence}/phone-picker.png` });
});

test("사진·크롭 초안이 있을 때 적용하면 초안이 사라지고 이후 저장이 충돌하지 않는다", async ({
  page,
  request,
}) => {
  await open(page);
  await writeCopy(page);
  await generateBoth(page);
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);
  await page.getByLabel("가로 초점").press("Home");
  await page.getByLabel("부제", { exact: true }).fill("적용 전 부제 초안");
  await expect(page.locator(".draft-notice")).toBeVisible();

  const applied = page.waitForResponse((r) =>
    r.url().endsWith("/ai-background/apply"),
  );
  const rendered = page.waitForResponse((r) => r.url().endsWith("/render"));
  await card(page, "디지털 아트형")
    .getByRole("button", { name: "이 이미지 사용" })
    .click();
  expect((await applied).ok()).toBe(true);
  const cover = await (await rendered).json();
  await expect(page.locator(".draft-notice")).toHaveCount(0);
  const id = await activeId(page);
  const saved = await project(request, id);
  expect(saved.photo).toMatch(aiUrl);
  expect(saved.focal).toEqual({ x: 50, y: 50, zoom: 1 });
  expect(saved.copy.kicker).toBe("적용 전 부제 초안");
  expect(saved.revision).toBe(cover.revision);
  await expect(page.locator(".crop-frame img")).toHaveAttribute(
    "src",
    saved.photo,
  );
  expect(
    await page.evaluate(
      (id) =>
        Object.keys(
          JSON.parse(localStorage.getItem("editor-drafts:" + id) || "{}") || {},
        ).length,
      id,
    ),
  ).toBe(0);
  // The accepted render response keeps the revision current: no conflict.
  await page.getByLabel("부제", { exact: true }).fill("적용 후 부제");
  const full = await refresh(page);
  expect(full.photo).toBe(saved.photo);
  expect(full.copy.kicker).toBe("적용 후 부제");
  await page.getByLabel("작업 이름").fill("적용 뒤 이름 변경");
  const put = page.waitForResponse((r) => r.request().method() === "PUT");
  await page.getByRole("button", { name: "지금 저장" }).click();
  expect((await put).status()).toBe(200);
  await expect(page.getByText("저장 실패")).toHaveCount(0);
});

test("적용 전 초안 저장이 AI_FOREIGN·AI_ASSET 이면 사진 초안만 비우고 적용한다", async ({
  page,
  request,
}) => {
  // Another project's completed asset (MOCK, no paid call).
  const other = await (await request.post("/api/projects")).json();
  const saved = await (
    await request.put(`/api/projects/${other.id}`, {
      data: { ...other, sourceTitle: "다른 작업 기사", source },
    })
  ).json();
  const otherBrief = await (
    await request.post(`/api/projects/${other.id}/ai-background/brief`, {
      data: { expectedSourceHash: sourceHash(saved) },
    })
  ).json();
  const foreign = await (
    await request.post(`/api/projects/${other.id}/ai-background`, {
      data: { briefId: otherBrief.briefId, variant: "photo" },
    })
  ).json();
  expect(foreign.url).toMatch(aiUrl);

  await open(page, "초안 복구 검사");
  await generateBoth(page);
  const id = await activeId(page);
  const cases: [string, "사진형" | "디지털 아트형", string][] = [
    [foreign.url, "사진형", "photo"], // AI_FOREIGN
    [`/uploads/ai-${randomUUID()}.jpg`, "디지털 아트형", "art"], // AI_ASSET
  ];
  for (const [draftPhoto, name, variant] of cases) {
    await page.evaluate(
      ([id, photo]) =>
        localStorage.setItem(
          "editor-drafts:" + id,
          JSON.stringify({
            photo: { photo, focal: { x: 20, y: 30, zoom: 1.5 } },
          }),
        ),
      [id, draftPhoto],
    );
    await page.reload();
    await expect(badge(page, name)).toHaveText("완료");
    const puts: number[] = [];
    page.on("response", (r) => {
      if (r.request().method() === "PUT") puts.push(r.status());
    });
    const applied = page.waitForResponse((r) =>
      r.url().endsWith("/ai-background/apply"),
    );
    await card(page, name)
      .getByRole("button", { name: "이 이미지 사용" })
      .click();
    expect((await applied).ok()).toBe(true);
    await expect(picker(page).getByRole("status")).toContainText(
      "사용할 수 없는 AI 사진 초안을 비웠습니다.",
    );
    await expect(page.locator(".progress")).toHaveCount(0);
    await expect(
      page.getByRole("alert").filter({ hasText: "처리를 완료하지 못했습니다" }),
    ).toHaveCount(0);
    // The refused draft save came first; the draft is gone, not stored.
    expect(puts[0]).toBeGreaterThanOrEqual(400);
    const now = await project(request, id);
    expect(now.photo).not.toBe(draftPhoto);
    expect(now.photo).toMatch(aiUrl);
    expect(now.background.variant).toBe(variant);
    expect(
      await page.evaluate(
        (id) =>
          Object.keys(
            JSON.parse(localStorage.getItem("editor-drafts:" + id) || "{}") ||
              {},
          ).length,
        id,
      ),
    ).toBe(0);
    page.removeAllListeners("response");
  }
});

test("적용 성공 뒤 표지 렌더가 STALE 이면 적용됨·렌더 실패를 구분해 알린다", async ({
  page,
  request,
}) => {
  await open(page, "렌더 충돌 검사");
  await writeCopy(page);
  await generateBoth(page);
  const id = await activeId(page);
  const before = await project(request, id);
  await page.route("**/render", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "STALE",
        message: "렌더 중 변경되어 이전 이미지는 적용하지 않았습니다.",
      }),
    }),
  );
  const applied = page.waitForResponse((r) =>
    r.url().endsWith("/ai-background/apply"),
  );
  await card(page, "사진형")
    .getByRole("button", { name: "이 이미지 사용" })
    .click();
  expect((await applied).ok()).toBe(true);
  await expect(page.locator(".error")).toContainText(
    "배경은 적용됨, 표지 렌더 실패: 렌더 중 변경되어 이전 이미지는 적용하지 않았습니다. 미리보기 갱신으로 다시 렌더하세요.",
  );
  // The server code is a separate diagnostic detail, not part of the text.
  await expect(page.locator(".error p")).not.toContainText("STALE");
  await expect(page.locator(".error .error-code")).toHaveText(
    "진단 코드 STALE",
  );
  await expect(page.locator(".progress")).toHaveCount(0);
  // Applied on the server; the cover render did not advance.
  const saved = await project(request, id);
  expect(saved.photo).toMatch(aiUrl);
  expect(saved.background.variant).toBe("photo");
  expect(saved.revision).toBe(before.revision + 1);
  expect(saved.coverRenderRevision).toBe(before.coverRenderRevision);
  // The suggested recovery works once the render goes through.
  await page.unrouteAll();
  const full = await refresh(page);
  expect(full.photo).toBe(saved.photo);
});

test("생성 중 탭 전환·복귀, 프로젝트 전환 시 늦은 응답 무시, 새로고침 후 복구", async ({
  page,
}) => {
  const name = await open(page, "탭 전환 검사");
  // Tab switch while generating keeps the slots.
  let hold = gate();
  await page.route((url) => isGenerate(url.toString()), hold.handler);
  await picker(page)
    .getByRole("button", { name: "AI로 이미지 생성하기" })
    .click();
  await expect(badge(page, "사진형")).toHaveText("생성 중…");
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(badge(page, "사진형")).toHaveText("생성 중…");
  await expect(badge(page, "디지털 아트형")).toHaveText("생성 중…");
  hold.release();
  await expect(badge(page, "사진형")).toHaveText("완료", { timeout: 20000 });
  await expect(badge(page, "디지털 아트형")).toHaveText("완료");
  await page.getByRole("button", { name: "01원문과 제작 방향" }).click();
  await expect(badge(page, "사진형")).toHaveText("완료");
  await expect(badge(page, "디지털 아트형")).toHaveText("완료");
  const first = await activeId(page);

  // Switching project while generating drops the late responses.
  await page.unrouteAll();
  hold = gate();
  await page.route((url) => isGenerate(url.toString()), hold.handler);
  await card(page, "사진형")
    .getByRole("button", { name: "다시 만들기" })
    .click();
  await expect(badge(page, "사진형")).toHaveText("생성 중…");
  await page.getByRole("button", { name: "+ 새 카드 만들기" }).click();
  await expect.poll(() => activeId(page)).not.toBe(first);
  await expect(page.getByLabel("통합 원문")).toHaveValue("");
  const late = page.waitForResponse(
    (r) => isGenerate(r.url()) && r.url().includes(first),
  );
  hold.release();
  const lateUrl = (await (await late).json()).url;
  await page.waitForTimeout(300);
  await expect(picker(page).locator(".ai-candidate")).toHaveCount(0);
  await expect(
    picker(page).getByRole("button", { name: "AI로 이미지 생성하기" }),
  ).toBeDisabled();

  // Re-entering the first project restores the completed candidates.
  await page.unrouteAll();
  await page.getByRole("button", { name: /작업 보관함/ }).click();
  await page
    .locator(".archive-card")
    .filter({ hasText: name })
    .getByRole("button", { name: "이어서 편집" })
    .first()
    .click();
  await expect.poll(() => activeId(page)).toBe(first);
  await expect(card(page, "사진형").locator("img")).toHaveAttribute(
    "src",
    lateUrl,
  );
  await expect(badge(page, "디지털 아트형")).toHaveText("완료");

  // Reload restores completed candidates only.
  await page.reload();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect(card(page, "사진형").locator("img")).toHaveAttribute(
    "src",
    lateUrl,
  );
  await expect(badge(page, "사진형")).toHaveText("완료");
  await expect(badge(page, "디지털 아트형")).toHaveText("완료");
  // Editing the article marks the candidates as based on the earlier text.
  await page.getByLabel("통합 원문").fill(source + " 추가 문장.");
  await expect(card(page, "사진형").getByText("이전 기사 기준")).toBeVisible();
});

test("제목 없는 새 작업에서 적용하면 적용되고 렌더는 보류된다", async ({
  page,
  request,
}) => {
  await open(page, "");
  await generateBoth(page);
  const renders: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/render")) renders.push(r.url());
  });
  const applied = page.waitForResponse((r) =>
    r.url().endsWith("/ai-background/apply"),
  );
  await card(page, "사진형")
    .getByRole("button", { name: "이 이미지 사용" })
    .click();
  expect((await applied).ok()).toBe(true);
  await expect(picker(page).getByRole("status")).toContainText(
    "제목이 정해지면 미리보기 갱신에서 렌더됩니다",
  );
  await expect(page.locator(".progress")).toHaveCount(0);
  expect(renders).toEqual([]);
  const saved = await project(request, await activeId(page));
  expect(saved.photo).toMatch(aiUrl);
  expect(saved.background.variant).toBe("photo");
  expect(saved.copy.headline).toBe("");
  await expect(page.locator(".photo-drop img")).toHaveAttribute(
    "src",
    saved.photo,
  );
});

test("직접 업로드 교체 → 표시·manifest 사라짐 → 복원 시 복귀, 복제본 유지·재적용", async ({
  page,
  request,
}) => {
  await open(page, "교체와 복원 검사");
  await writeCopy(page);
  await generateBoth(page);
  const applied = page.waitForResponse((r) =>
    r.url().endsWith("/ai-background/apply"),
  );
  await card(page, "디지털 아트형")
    .getByRole("button", { name: "이 이미지 사용" })
    .click();
  const ai = await (await applied).json();
  await expect(page.locator(".progress")).toHaveCount(0);
  const id = ai.id;
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await refresh(page);
  expect((await manifest(request, id)).background.variant).toBe("art");

  // A direct upload replaces the cover: the AI label and manifest go away.
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);
  const replaced = await refresh(page);
  expect(replaced.photo).not.toMatch(aiUrl);
  expect(replaced.background.assetId).toBe(ai.background.assetId);
  await expect(picker(page).locator(".ai-applied")).toHaveCount(0);
  await expect(badge(page, "디지털 아트형")).toHaveText("완료");
  expect((await manifest(request, id)).background).toBeUndefined();

  // Restoring the AI version brings the label and the manifest back.
  await page.getByRole("button", { name: "버전 기록" }).click();
  await page
    .locator(".history")
    .filter({ hasText: `버전 ${ai.revision} ·` })
    .getByRole("button", { name: "복원" })
    .click();
  await expect(page.locator(".progress")).toHaveCount(0);
  await page.getByRole("button", { name: "편집으로" }).click();
  await expect(picker(page).locator(".ai-applied")).toContainText(
    "AI 생성 일러스트",
  );
  await refresh(page);
  const restored = await project(request, id);
  expect(restored.photo).toBe(ai.photo);
  expect((await manifest(request, id)).background.assetId).toBe(
    ai.background.assetId,
  );

  // A duplicate keeps the AI background and may re-apply the asset.
  const copy = await (
    await request.post(`/api/projects/${id}/duplicate`)
  ).json();
  expect(copy.photo).toBe(ai.photo);
  expect(copy.background.assetId).toBe(ai.background.assetId);
  const upload = await request.post("/api/photos", {
    multipart: {
      file: {
        name: "cover.jpg",
        mimeType: "image/jpeg",
        buffer: await fs.readFile(photo),
      },
    },
  });
  const other = await request.put(`/api/projects/${copy.id}`, {
    data: { ...copy, photo: (await upload.json()).url },
  });
  expect(other.ok()).toBe(true);
  const reapplied = await request.post(
    `/api/projects/${copy.id}/ai-background/apply`,
    {
      data: {
        revision: (await other.json()).revision,
        assetId: ai.background.assetId,
      },
    },
  );
  expect(reapplied.ok(), await reapplied.text()).toBe(true);
  expect((await reapplied.json()).photo).toBe(ai.photo);
  await page.getByRole("button", { name: /작업 보관함/ }).click();
  await page
    .locator(".archive-card")
    .filter({ hasText: copy.name })
    .getByRole("button", { name: "이어서 편집" })
    .first()
    .click();
  await expect(picker(page).locator(".ai-applied")).toContainText(
    "AI 생성 일러스트",
  );
});

test("기능 스위치 끔 → 버튼 숨김, 기존 후보 적용과 렌더는 동작", async ({
  page,
  request,
}) => {
  await open(page, "스위치 검사");
  await writeCopy(page);
  await generateBoth(page);
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), aiBackground: { generate: false } },
    });
  });
  await page.reload();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect(badge(page, "사진형")).toHaveText("완료");
  await expect(
    page.getByRole("button", { name: "AI로 이미지 생성하기" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "다시 만들기" })).toHaveCount(
    0,
  );
  const rendered = page.waitForResponse((r) => r.url().endsWith("/render"));
  await card(page, "디지털 아트형")
    .getByRole("button", { name: "이 이미지 사용" })
    .click();
  const cover = await (await rendered).json();
  expect(cover.photo).toMatch(aiUrl);
  expect(cover.coverRenderRevision).toBe(cover.revision);
  await expect(picker(page).locator(".ai-applied")).toContainText(
    "AI 생성 일러스트",
  );
  // A new project without candidates shows no AI section at all.
  await page.getByRole("button", { name: "+ 새 카드 만들기" }).click();
  await expect(page.getByLabel("통합 원문")).toHaveValue("");
  await expect(picker(page)).toHaveCount(0);
  const saved = await project(request, cover.id);
  expect(saved.background.variant).toBe("art");
});
