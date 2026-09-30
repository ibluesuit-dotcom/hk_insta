import type { Page, Route } from "@playwright/test";
import { test, expect } from "./auth-fixture";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sourceHash } from "../shared/ai-background";

// AI 배경 결함 수정 검증(edge B1~B5). 생성 중 새로고침을 재현하려면 모의
// 생성이 충분히 길어야 해서, 느린 MOCK 서버를 따로 띄운다. 유료 호출 없음.
const port = 4395;
const baseURL = `http://127.0.0.1:${port}`;
const delay = 3000;
// How long a finished brief keeps its variants running for the images.
const grace = 6000;
const pollMs = 1500;
let server: ChildProcess;
let dataDir: string;
const evidence =
  (process.env.E2E_ARTIFACT_DIR || "test-results") + "/ai-background-fixes";

test.use({ baseURL });
test.describe.configure({ mode: "serial" });
/** A MOCK server of its own on this port and data folder. */
async function serve(port: number, dir: string, env: Record<string, string>) {
  const child = spawn("npx", ["tsx", "server/index.ts"], {
    env: {
      ...process.env,
      MOCK_AI: "1",
      AI_BACKGROUND_GENERATE: "1",
      DATA_DIR: dir,
      PORT: String(port),
      ...env,
    },
    stdio: "ignore",
  });
  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break;
    } catch {}
    if (i > 100) throw new Error("slow mock server did not start");
    await new Promise((r) => setTimeout(r, 300));
  }
  return child;
}
test.beforeAll(async () => {
  test.setTimeout(60000);
  await fs.mkdir(evidence, { recursive: true });
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-bg-fixes-e2e-"));
  server = await serve(port, dataDir, {
    MOCK_DELAY: String(delay),
    AI_BRIEF_GRACE_MS: String(grace),
  });
});
test.afterAll(async () => {
  server?.kill();
  await fs.rm(dataDir, { recursive: true, force: true }).catch(() => {});
});

const picker = (page: Page) =>
  page.getByRole("region", { name: "AI 배경 이미지" });
const card = (page: Page, name: "사진형" | "디지털 아트형") =>
  picker(page).getByRole("article", { name: name + " 후보" });
const badge = (page: Page, name: "사진형" | "디지털 아트형") =>
  card(page, name).locator(".ai-badge").first();
const generateButton = (page: Page) =>
  picker(page).getByRole("button", {
    name: /AI로 이미지 생성하기|다른 소재로 다시 생성|생성 중/,
  });
const activeId = (page: Page) =>
  page.evaluate(() => sessionStorage.getItem("studio-project")!);
const isGenerate = (url: string) =>
  /\/ai-background$/.test(new URL(url).pathname);
const isBrief = (url: string) =>
  /\/ai-background\/brief$/.test(new URL(url).pathname);
const isRecent = (url: string) =>
  /\/ai-background\/recent$/.test(new URL(url).pathname);

async function open(page: Page, title: string, base = "") {
  await page.goto(base + "/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByLabel("원문 제목", { exact: true }).fill(title);
  await page
    .getByLabel("통합 원문")
    .fill(
      `${title}. 산업통상자원부는 지난달 수출이 전년 동기 대비 증가했다고 밝혔다. 자동차와 반도체가 증가세를 이끌었다.`,
    );
  await page.getByLabel("작업 이름").fill(`결함 수정 ${title} ${Date.now()}`);
}
/** Completed image files the server stored for this project. */
async function assetsOf(projectId: string, dir = dataDir) {
  let names: string[] = [];
  try {
    names = await fs.readdir(path.join(dir, "ai-backgrounds"));
  } catch {}
  const found = [];
  for (const name of names.filter((n) => /^[0-9a-f-]{36}\.json$/.test(n))) {
    const s = JSON.parse(
      await fs.readFile(path.join(dir, "ai-backgrounds", name), "utf8"),
    );
    if (s.projectId === projectId) found.push(s);
  }
  return found;
}

test("B1 생성 중 새로고침 → '생성 중' 복원 → 완료 자동 반영, 중복 호출 없음", async ({
  page,
  request,
}) => {
  await open(page, "새로고침 복원");
  const sent = [
    page.waitForRequest((r) => isGenerate(r.url())),
    page.waitForRequest(
      (r) => isGenerate(r.url()) && r.postDataJSON().variant === "art",
    ),
  ];
  await generateButton(page).click();
  await Promise.all(sent);
  const id = await activeId(page);
  // The server now runs both images; the page goes away mid-generation.
  await page.reload();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect(badge(page, "사진형")).toHaveText("생성 중…");
  await expect(badge(page, "디지털 아트형")).toHaveText("생성 중…");
  await expect(generateButton(page)).toBeDisabled();
  await expect(generateButton(page)).toHaveText("AI 이미지 생성 중…");
  await page.screenshot({ path: `${evidence}/B1-restored-generating.png` });

  // A second paid call for a running variant is refused before any work.
  const saved = await (await request.get(`/api/projects/${id}`)).json();
  const brief = await request.post(`/api/projects/${id}/ai-background/brief`, {
    data: { expectedSourceHash: sourceHash(saved) },
  });
  expect(brief.ok(), await brief.text()).toBe(true);
  const again = await request.post(`/api/projects/${id}/ai-background`, {
    data: { briefId: (await brief.json()).briefId, variant: "photo" },
  });
  expect(again.status()).toBe(409);
  expect((await again.json()).code).toBe("AI_IN_PROGRESS");

  // Completion shows up without another reload.
  await expect(badge(page, "사진형")).toHaveText("완료", {
    timeout: delay * 4,
  });
  await expect(badge(page, "디지털 아트형")).toHaveText("완료");
  const assets = await assetsOf(id);
  expect(assets.map((a) => a.variant).sort()).toEqual(["art", "photo"]);
  const photo = assets.find((a) => a.variant === "photo");
  await expect(card(page, "사진형").locator("img")).toHaveAttribute(
    "src",
    photo.photo,
  );
  await expect(generateButton(page)).toBeEnabled();
  await page.screenshot({ path: `${evidence}/B1-completed.png` });
});

test("B1 새로고침 직후 재클릭은 409 로 진행 중 작업을 따라가고 새로 과금하지 않는다", async ({
  page,
}) => {
  await open(page, "재클릭 중복 방지");
  await generateButton(page).click();
  await expect(badge(page, "사진형")).toHaveText("완료", {
    timeout: delay * 4,
  });
  const id = await activeId(page);
  expect(await assetsOf(id)).toHaveLength(2);

  // Start a regeneration, then reload before the page learns of the job:
  // the first recent after reload is answered empty, so the button is live.
  const sent = page.waitForRequest((r) => isGenerate(r.url()));
  await card(page, "사진형")
    .getByRole("button", { name: "다시 만들기" })
    .click();
  await sent;
  let first = true;
  await page.route(
    (url) => isRecent(url.toString()),
    async (route) => {
      if (!first) return route.continue();
      first = false;
      await route.fulfill({ json: {} });
    },
  );
  await page.reload();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect(generateButton(page)).toBeEnabled();
  const refused = page.waitForResponse(
    (r) =>
      isGenerate(r.url()) &&
      r.request().postDataJSON().variant === "photo" &&
      r.status() === 409,
  );
  await generateButton(page).click();
  const body = await (await refused).json();
  expect(body.code).toBe("AI_IN_PROGRESS");
  expect(body.startedAt).toBeTruthy();
  // The photo slot follows the running job instead of failing.
  await expect(badge(page, "사진형")).toHaveText("생성 중…");
  await expect(card(page, "사진형").getByRole("alert")).toHaveCount(0);
  await expect(badge(page, "사진형")).toHaveText("완료", {
    timeout: delay * 4,
  });
  await expect(badge(page, "디지털 아트형")).toHaveText("완료", {
    timeout: delay * 4,
  });
  // 2 first + 1 regeneration + 1 art from the re-click; no second photo.
  const assets = await assetsOf(id);
  expect(assets.filter((a) => a.variant === "photo")).toHaveLength(2);
  expect(assets.filter((a) => a.variant === "art")).toHaveLength(2);
});

test("B1 소재 분석 중 새로고침하면 끝난 뒤 다시 생성하라고 안내한다", async ({
  page,
}) => {
  await open(page, "분석 중 새로고침");
  const briefSent = page.waitForRequest((r) => isBrief(r.url()));
  await generateButton(page).click();
  const sentBrief = await briefSent;
  expect(sentBrief.postDataJSON().variants).toEqual(["photo", "art"]);
  await page.reload();
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect(badge(page, "사진형")).toHaveText("생성 중…");
  await expect(picker(page).getByRole("status")).toContainText(
    "새로고침으로 이미지 생성이 이어지지 않았습니다",
    { timeout: delay * 4 + grace },
  );
  // Nothing was made: back to the initial picker without candidate cards.
  await expect(picker(page).locator(".ai-candidate")).toHaveCount(0);
  await expect(generateButton(page)).toBeEnabled();
  expect(await assetsOf(await activeId(page))).toHaveLength(0);
});

test("B2·B4 다시 만들기가 실패해도 이전 후보와 적용 버튼이 남고, 코드는 따로 작게", async ({
  page,
}) => {
  await open(page, "실패 후보 유지");
  await generateButton(page).click();
  await expect(badge(page, "디지털 아트형")).toHaveText("완료", {
    timeout: delay * 4,
  });
  const art = card(page, "디지털 아트형");
  const src = await art.locator("img").getAttribute("src");
  await page.route(
    (url) => isGenerate(url.toString()),
    (route) =>
      route.fulfill({
        status: 429,
        contentType: "application/json",
        body: JSON.stringify({
          code: "AI_RATE",
          message: "AI 이미지 요청이 많습니다. 1분 뒤 다시 시도하세요.",
        }),
      }),
  );
  await art.getByRole("button", { name: "다시 만들기" }).click();
  await expect(badge(page, "디지털 아트형")).toHaveText("생성 실패");
  const alert = art.getByRole("alert");
  await expect(alert).toContainText("이전 후보는 그대로 쓸 수 있습니다");
  await expect(alert).toContainText("1분 뒤 다시 시도하세요");
  // B4: the internal code is not part of the sentence, only a small detail.
  await expect(alert.locator(".error-code")).toHaveText("(AI_RATE)");
  expect(
    await alert.evaluate((el) =>
      [...el.childNodes]
        .filter((n) => !(n as Element).classList?.contains("error-code"))
        .map((n) => n.textContent)
        .join(""),
    ),
  ).not.toContain("AI_RATE");
  await expect(art.locator("img")).toHaveAttribute("src", src!);
  const use = art.getByRole("button", { name: "이 이미지 사용" });
  await expect(use).toBeEnabled();
  await page.screenshot({ path: `${evidence}/B2-failed-keeps-candidate.png` });
  await page.unrouteAll();
  await use.click();
  await expect(badge(page, "디지털 아트형")).toHaveText("적용됨", {
    timeout: 20000,
  });
});

test("B4·B5 잘못된 URL 은 URL 안내만 보이고 코드는 진단 표시로 분리", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  const url = page.getByPlaceholder("https://… 기사 주소를 입력하세요");
  const banner = page.locator(".error[role=alert]");
  for (const [value, code, text] of [
    ["abc", "URL_INVALID", "URL을 확인하세요"],
    [
      "https://no-such-host-qa.invalid/news/1",
      "URL_UNREACHABLE",
      "기사 주소에 접속할 수 없습니다. URL을 확인하세요.",
    ],
  ]) {
    await url.fill(value);
    await page.getByRole("button", { name: "불러오기" }).click();
    await expect(banner.locator("p")).toContainText(text);
    await expect(banner.locator("p")).not.toContainText(code);
    await expect(banner.locator("p")).not.toContainText(/폰트|입력 파일/);
    await expect(banner.locator(".error-code")).toHaveText(`진단 코드 ${code}`);
    await banner.getByRole("button", { name: "닫기" }).click();
  }
});

test("B3 휴대폰 390px 에서 편집 화면이 가로로 넘치지 않고, 데스크톱은 두 칸 유지", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, "휴대폰 폭");
  const fits = async () => {
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    for (const el of [
      page.getByRole("button", { name: "불러오기" }),
      page.locator(".project-bar .badge"),
      page.locator(".pill").first(),
    ]) {
      await expect(el).toBeVisible();
      const box = (await el.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(390);
    }
  };
  await fits();
  await page.screenshot({ path: `${evidence}/B3-390-top.png` });
  // Candidates and a failure message must fit as well.
  await generateButton(page).click();
  await expect(badge(page, "사진형")).toHaveText("완료", {
    timeout: delay * 4,
  });
  await fits();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: `${evidence}/B3-390-edit.png`,
    fullPage: true,
  });

  // Desktop keeps the editor and preview side by side.
  await page.setViewportSize({ width: 1512, height: 1100 });
  const columns = await page
    .locator(".workspace")
    .evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(" "));
  expect(columns).toHaveLength(2);
  const editor = (await page.locator(".editor").boundingBox())!;
  const preview = (await page.locator(".preview-panel").boundingBox())!;
  expect(preview.x).toBeGreaterThan(editor.x + editor.width - 1);
});

// CODEX-VERIFY N1·N2·N4: 생성 1회 = 서버가 발급한 작업 번호 하나.
const stopped = "새로고침으로 이미지 생성이 이어지지 않았습니다";

test("N2 두 탭: 브리프→이미지 공백에도 '생성 중' 유지, 늦게 온 이전 작업은 과금 없이 409", async ({
  page,
  context,
}) => {
  test.setTimeout(90000);
  await open(page, "두 탭 전환 공백");
  // Tab A's image requests are held back until tab B has generated.
  const held: Route[] = [];
  await page.route(
    (url) => isGenerate(url.toString()),
    (route) => void held.push(route),
  );
  await generateButton(page).click();
  await expect.poll(() => held.length, { timeout: delay * 3 }).toBe(2);
  const id = await activeId(page);

  const b = await context.newPage();
  await b.addInitScript(
    (id) => sessionStorage.setItem("studio-project", id),
    id,
  );
  await b.goto("/");
  await expect(b.getByLabel("통합 원문")).toBeVisible();
  await expect(badge(b, "사진형")).toHaveText("생성 중…");
  await expect(badge(b, "디지털 아트형")).toHaveText("생성 중…");
  // Several polls inside the gap: B keeps waiting, the button stays off.
  await b.waitForTimeout(pollMs * 2 + 500);
  await expect(badge(b, "사진형")).toHaveText("생성 중…");
  await expect(picker(b).getByRole("status")).toHaveCount(0);
  await expect(generateButton(b)).toBeDisabled();
  await b.screenshot({ path: `${evidence}/N2-tab-b-gap-generating.png` });

  // No image request within the grace: B is told and may start over.
  await expect(picker(b).getByRole("status")).toContainText(stopped, {
    timeout: grace + pollMs * 4,
  });
  await expect(generateButton(b)).toBeEnabled();
  await generateButton(b).click();
  await expect(badge(b, "사진형")).toHaveText("완료", { timeout: delay * 4 });
  await expect(badge(b, "디지털 아트형")).toHaveText("완료");
  const src = await card(b, "사진형").locator("img").getAttribute("src");

  // A's held requests finally arrive: refused before any work, A follows B.
  const refused = held.map(() =>
    page.waitForResponse((r) => isGenerate(r.url()) && r.status() === 409),
  );
  for (const route of held) await route.continue();
  for (const r of await Promise.all(refused))
    expect((await r.json()).code).toBe("AI_SUPERSEDED");
  await expect(badge(page, "사진형")).toHaveText("완료", {
    timeout: delay * 4,
  });
  await expect(card(page, "사진형").locator("img")).toHaveAttribute(
    "src",
    src!,
  );
  await expect(card(page, "사진형").getByRole("alert")).toHaveCount(0);
  const assets = await assetsOf(id);
  expect(assets.map((a) => a.variant).sort()).toEqual(["art", "photo"]);
  await page.screenshot({ path: `${evidence}/N2-tab-a-follows-b.png` });
  await b.close();
});

test("N1 완료 경계의 빈 recent 한 번으로 중단을 확정하지 않는다", async ({
  page,
}) => {
  await open(page, "완료 경계");
  const sent = [
    page.waitForRequest((r) => isGenerate(r.url())),
    page.waitForRequest(
      (r) => isGenerate(r.url()) && r.postDataJSON().variant === "art",
    ),
  ];
  await generateButton(page).click();
  await Promise.all(sent);
  await page.reload();
  await expect(badge(page, "사진형")).toHaveText("생성 중…");
  // The next poll is a torn read: neither the candidate nor the job.
  let torn = true;
  await page.route(
    (url) => isRecent(url.toString()),
    async (route) => {
      if (!torn) return route.continue();
      torn = false;
      await route.fulfill({ json: {} });
    },
  );
  await expect(badge(page, "사진형")).toHaveText("완료", {
    timeout: delay * 4,
  });
  await expect(badge(page, "디지털 아트형")).toHaveText("완료");
  expect(torn).toBe(false);
  await expect(picker(page).getByRole("status")).toHaveCount(0);
});

test("N4 실패 후 새로고침해도 실패 안내와 이전 후보가 남는다", async ({
  page,
}) => {
  // A server whose art images always fail; photo works.
  const failPort = 4394;
  const failBase = `http://127.0.0.1:${failPort}`;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ai-bg-fail-e2e-"));
  const failing = await serve(failPort, dir, {
    MOCK_DELAY: "300",
    MOCK_AI_IMAGE_FAIL: "art",
  });
  try {
    await open(page, "실패 후 새로고침", failBase);
    await generateButton(page).click();
    await expect(badge(page, "사진형")).toHaveText("완료", {
      timeout: 15000,
    });
    await expect(badge(page, "디지털 아트형")).toHaveText("생성 실패");
    const id = await activeId(page);
    // An earlier art candidate of this project, older than the failure.
    const [photo] = await assetsOf(id, dir);
    const artId = crypto.randomUUID();
    await fs.copyFile(
      path.join(dir, "uploads", `ai-${photo.assetId}.jpg`),
      path.join(dir, "uploads", `ai-${artId}.jpg`),
    );
    await fs.writeFile(
      path.join(dir, "ai-backgrounds", `${artId}.json`),
      JSON.stringify({
        ...photo,
        assetId: artId,
        variant: "art",
        photo: `/uploads/ai-${artId}.jpg`,
        at: new Date(Date.parse(photo.at) - 60000).toISOString(),
      }),
    );

    await page.reload();
    await expect(page.getByLabel("통합 원문")).toBeVisible();
    await expect(badge(page, "사진형")).toHaveText("완료");
    await expect(badge(page, "디지털 아트형")).toHaveText("생성 실패");
    const art = card(page, "디지털 아트형");
    await expect(art.locator(".ai-failure")).toHaveCount(1);
    await expect(art.getByRole("alert")).toContainText(
      "이전 후보는 그대로 쓸 수 있습니다",
    );
    await expect(art.getByRole("alert")).toContainText("이미지 생성 실패");
    await expect(art.locator("img")).toHaveAttribute(
      "src",
      `/uploads/ai-${artId}.jpg`,
    );
    await expect(
      art.getByRole("button", { name: "이 이미지 사용" }),
    ).toBeEnabled();
    await page.screenshot({ path: `${evidence}/N4-failure-after-reload.png` });
  } finally {
    failing.kill();
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("그림 소재 요청과 '다른 소재로 다시 생성'이 소재 분석 요청에 실린다", async ({
  page,
}) => {
  await open(page, "소재 요청");
  await picker(page).getByLabel("그림 소재 요청").fill("클린룸의 연구원");
  const first = page.waitForRequest((r) => isBrief(r.url()));
  await generateButton(page).click();
  expect((await first).postDataJSON()).toMatchObject({
    fresh: false,
    subjectRequest: "클린룸의 연구원",
  });
  await expect(badge(page, "사진형")).not.toHaveText("생성 중…", {
    timeout: 30_000,
  });
  await expect(badge(page, "디지털 아트형")).not.toHaveText("생성 중…", {
    timeout: 30_000,
  });
  await expect(generateButton(page)).toHaveText("다른 소재로 다시 생성");
  await picker(page).getByLabel("그림 소재 요청").fill("");
  const again = page.waitForRequest((r) => isBrief(r.url()));
  await generateButton(page).click();
  const body = (await again).postDataJSON();
  expect(body.fresh).toBe(true);
  expect(body.subjectRequest).toBeUndefined();

  // A wish typed for one project does not follow to the next one.
  await picker(page)
    .getByLabel("그림 소재 요청")
    .fill("다른 작업에 가면 안 됨");
  await expect(page.locator(".progress")).toHaveCount(0, { timeout: 30_000 });
  await page.getByRole("button", { name: "+ 새 카드 만들기" }).click();
  await expect(page.getByLabel("통합 원문")).toHaveValue("");
  await expect(picker(page).getByLabel("그림 소재 요청")).toHaveValue("");
});
