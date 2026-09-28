import type { Page } from "@playwright/test";
import { test, expect } from "./auth-fixture";
import yauzl from "yauzl";
import { encodeHeadlineLines } from "../shared/model";
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
const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
async function setup(page: Page) {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
}
async function generate(page: Page) {
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const response = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await response).json();
  await expect(page.locator(".feed-image img")).toBeVisible();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  return p;
}
const refresh = (page: Page) =>
  page.getByRole("button", { name: /▧ 전체.*미리보기 갱신/ });
const download = (page: Page) =>
  page.getByRole("link", { name: "내보내기", exact: true });
async function update(page: Page) {
  const response = page.waitForResponse((r) => r.url().endsWith("/render"));
  await refresh(page).click();
  const rendered = await response;
  expect(rendered.ok(), await rendered.text()).toBe(true);
  await expect(page.locator(".progress")).toHaveCount(0);
  return rendered.json();
}

test("all visible and hidden edits save together, actual lines persist, export has no approval", async ({
  page,
  request,
  playwright,
  baseURL,
}) => {
  await setup(page);
  const original = await generate(page);
  await expect(
    page.getByRole("button", { name: /03|승인|현재 카드만/ }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: / 수정$/ })).toHaveCount(0);
  await expect(
    page.getByPlaceholder("예: 소비자에게 미치는 영향을 먼저"),
  ).toHaveCount(0);
  await expect(page.getByLabel("표지 제목", { exact: true })).toHaveValue(
    encodeHeadlineLines(original.coverLayout.lines),
  );
  await expect(download(page)).toHaveAttribute(
    "href",
    `/api/projects/${original.id}/download`,
  );
  if (process.env.REVIEW_AUTH === "1") {
    const anonymous = await playwright.request.newContext({ baseURL });
    try {
      for (const endpoint of ["download", "png/0"])
        expect(
          (
            await anonymous.get(`/api/projects/${original.id}/${endpoint}`)
          ).status(),
        ).toBe(401);
    } finally {
      await anonymous.dispose();
    }
  }
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);
  await page.getByLabel("가로 초점").press("Home");
  await page.getByLabel("부제", { exact: true }).fill("함께 저장할 부제");
  await page.getByRole("button", { name: "본문 1", exact: true }).click();
  await page.getByLabel("페이지 제목", { exact: true }).fill("새 본문 제목");
  await page
    .getByLabel("페이지 본문", { exact: true })
    .fill("함께 저장할 본문입니다.");
  await page.getByLabel("본문 글자 크기", { exact: true }).selectOption("54");
  await expect(download(page)).toHaveAttribute("aria-disabled", "true");
  expect(
    (await (await request.get(`/api/projects/${original.id}`)).json()).revision,
  ).toBe(original.revision);
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.getByLabel("부제", { exact: true })).toHaveValue(
    "함께 저장할 부제",
  );
  const saved = await update(page);
  expect(saved.copy).toMatchObject({
    kicker: "함께 저장할 부제",
  });
  expect(saved.copy.pages[0]).toMatchObject({
    title: "새 본문 제목",
    body: "함께 저장할 본문입니다.",
  });
  expect(saved.bodyFont).toBe(54);
  expect(saved.photo).not.toBe(original.photo);
  expect(saved.focal.x).toBe(0);
  expect(saved.renders).toHaveLength(2);
  expect(saved.renderRevision).toBe(saved.revision);
  expect(saved.copyApproved).toBe(false);
  expect(saved.imageApproved).toBe(false);
  expect(
    await page.evaluate(
      (id) => localStorage.getItem("editor-drafts:" + id),
      saved.id,
    ),
  ).toBe("{}");
  const zip = await request.get(`/api/projects/${saved.id}/download`);
  expect(zip.ok()).toBe(true);
  const entries = await zipEntries(await zip.body());
  expect(Object.keys(entries)).toEqual([
    "01-cover.png",
    "02-body.png",
    "caption.txt",
    "alt-text.txt",
    "manifest.json",
  ]);
  expect(entries["caption.txt"].toString()).toBe(saved.copy.caption);
  expect(entries["alt-text.txt"].toString()).toContain("01: " + saved.copy.alt);
  expect(JSON.parse(entries["manifest.json"].toString())).toMatchObject({
    revision: saved.revision,
    order: [1, 2],
  });
  for (const [i, name] of ["01-cover.png", "02-body.png"].entries())
    expect(
      entries[name].equals(await (await request.get(saved.renders[i])).body()),
    ).toBe(true);
  expect((await request.get(`/api/projects/${saved.id}/png/0`)).ok()).toBe(
    true,
  );
  const box = await refresh(page).boundingBox();
  const link = await download(page).boundingBox();
  expect(link!.y).toBeGreaterThanOrEqual(box!.y + box!.height);
  await page.screenshot({
    path: process.env.E2E_ARTIFACT_DIR + "/two-step-editor.png",
    fullPage: true,
  });
});

for (const rejection of ["validation", 400, 500] as const) {
  test(`failed batch save (${rejection}) retains every draft and prevents render`, async ({
    page,
    request,
  }) => {
    await setup(page);
    const original = await generate(page);
    const url = `/api/projects/${original.id}`;
    let renders = 0;
    page.on("request", (r) => {
      if (r.url().endsWith("/render")) renders++;
    });
    if (rejection !== "validation")
      await page.route(`**${url}`, (route) =>
        route.request().method() === "PUT"
          ? route.fulfill({
              status: rejection,
              json: { code: "TEST", message: "저장 거절" },
            })
          : route.continue(),
      );
    const rejected =
      rejection === "validation" ? "z".repeat(201) : "거절된 제목";
    await page.getByLabel("표지 제목", { exact: true }).fill(rejected);
    await page.getByLabel("부제", { exact: true }).fill("보존할 부제");
    await refresh(page).click();
    await expect(page.getByRole("alert")).toContainText(
      rejection === "validation" ? "INPUT" : "저장 거절",
    );
    await expect(page.getByLabel("표지 제목", { exact: true })).toHaveValue(
      rejected,
    );
    await expect(page.getByLabel("부제", { exact: true })).toHaveValue(
      "보존할 부제",
    );
    expect((await (await request.get(url)).json()).revision).toBe(
      original.revision,
    );
    expect(renders).toBe(0);
    await expect(download(page)).toHaveAttribute("aria-disabled", "true");
    await page.unroute(`**${url}`);
    await page.getByLabel("표지 제목", { exact: true }).fill("복구 / 제목");
    const saved = await update(page);
    expect(saved.copy.kicker).toBe("보존할 부제");
    expect(saved.coverLayout.lines).toEqual(["복구", "제목"]);
    expect(renders).toBe(1);
  });
}

test("failed render retains saved edits, blocks ZIP/PNG and archive, then recovers", async ({
  page,
  request,
}) => {
  await setup(page);
  const original = await generate(page);
  await page.getByLabel("부제", { exact: true }).fill("저장된 새 부제");
  await page.route("**/render", (route) =>
    route.fulfill({
      status: 400,
      json: { code: "RENDER", message: "테스트 실패" },
    }),
  );
  await refresh(page).click();
  await expect(page.getByRole("alert")).toContainText("테스트 실패");
  const saved = await (
    await request.get(`/api/projects/${original.id}`)
  ).json();
  expect(saved.copy.kicker).toBe("저장된 새 부제");
  expect(saved.renderRevision).not.toBe(saved.revision);
  for (const endpoint of ["download", "png/0"])
    expect(
      (await request.get(`/api/projects/${original.id}/${endpoint}`)).status(),
    ).toBe(400);
  await expect(download(page)).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("button", { name: "작업 보관함" }).click();
  await expect(
    page.locator(`a[href="/api/projects/${original.id}/download"]`),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "카드 스튜디오" }).click();
  await page.unroute("**/render");
  await update(page);
  await expect(download(page)).toHaveAttribute("aria-disabled", "false");
  // A new local draft also blocks archive export before a server revision exists.
  await page.getByLabel("부제", { exact: true }).fill("로컬 초안");
  await page.getByRole("button", { name: "작업 보관함" }).click();
  await expect(
    page.locator(`a[href="/api/projects/${original.id}/download"]`),
  ).toHaveCount(0);
});

test("partial candidates replace their draft without deadlock, preserve unrelated drafts and omit hidden direction", async ({
  page,
  request,
}) => {
  await setup(page);
  let p = await generate(page);
  p = await (
    await request.put(`/api/projects/${p.id}`, {
      data: { ...p, partialDirection: "obsolete hidden instruction" },
    })
  ).json();
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page
    .getByLabel("표지 제목", { exact: true })
    .fill("아직 저장하지 않은 제목");
  await page.getByLabel("부제", { exact: true }).fill("다른 초안");
  const candidate = page.waitForRequest((r) => r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "원제 적용", exact: true }).click();
  expect((await candidate).postDataJSON()).not.toHaveProperty("extra");
  await expect(page.getByLabel("표지 제목", { exact: true })).toHaveValue(
    encodeHeadlineLines(p.coverLayout.lines),
  );
  expect(
    (await (await request.get(`/api/projects/${p.id}`)).json()).revision,
  ).toBe(p.revision);
  const saved = await update(page);
  expect(saved.copy.headline).toBe("금리와 수출 동향");
  expect(saved.copy.kicker).toBe("다른 초안");
  expect(saved.partialDirection).toBe("");
});

test("conflict preserves drafts and never renders or overwrites newer revision", async ({
  page,
  request,
}) => {
  await setup(page);
  const p = await generate(page);
  const newer = await (
    await request.put(`/api/projects/${p.id}`, {
      data: { ...p, credit: "다른 창" },
    })
  ).json();
  await page.getByLabel("표지 제목", { exact: true }).fill("충돌한 제목");
  await refresh(page).click();
  await expect(page.getByRole("alert")).toContainText("CONFLICT");
  await refresh(page).click();
  await expect(page.getByRole("alert")).toContainText("다른 창의 변경과 충돌");
  expect(
    (await (await request.get(`/api/projects/${p.id}`)).json()).revision,
  ).toBe(newer.revision);
  await expect(page.getByLabel("표지 제목", { exact: true })).toHaveValue(
    "충돌한 제목",
  );
});

for (const status of [400, 500]) {
  test(`source autosave pauses after ${status} until a subsequent source edit`, async ({
    page,
    request,
  }) => {
    await setup(page);
    await expect(
      page.getByText("서버 저장 완료", { exact: true }),
    ).toBeVisible();
    let puts = 0;
    let projectUrl = "";
    await page.route("**/api/projects/*", async (route) => {
      if (route.request().method() !== "PUT") return route.continue();
      puts++;
      projectUrl = route.request().url();
      if (puts === 1)
        return route.fulfill({
          status,
          json: { code: "TEST_REJECTION", message: "테스트 저장 거절" },
        });
      await route.continue();
    });
    await page
      .getByLabel("원문 제목", { exact: true })
      .fill("금리와 수출 동향");
    await page.getByLabel("통합 원문").fill(source + " 첫 편집.");
    await expect(page.getByRole("alert")).toContainText("TEST_REJECTION");
    await page.getByRole("button", { name: "02문안·사진 편집" }).click();
    await page.getByLabel("표지 제목", { exact: true }).fill("별도 제목 초안");
    await page.waitForTimeout(2200);
    expect(puts).toBe(1);
    await page.getByRole("button", { name: /01.*원문과 제작 방향/ }).click();
    await page
      .getByLabel("원문 제목", { exact: true })
      .fill("금리와 수출 동향");
    await page.getByLabel("통합 원문").fill(source + " 다음 편집.");
    await expect(
      page.getByText("서버 저장 완료", { exact: true }),
    ).toBeVisible();
    expect(puts).toBe(2);
    const saved = await (await request.get(projectUrl)).json();
    expect(saved.copy.headline).not.toBe("별도 제목 초안");
    await page.waitForTimeout(1400);
    expect(puts).toBe(2);
  });
}
