import { test, expect } from "./auth-fixture";
import sharp from "sharp";
import fs from "node:fs/promises";
import { blank } from "../shared/model";
import { html } from "../server/render";
const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다.";
const photo = () =>
  sharp({
    create: { width: 1080, height: 1350, channels: 3, background: "#163044" },
  })
    .jpeg()
    .toBuffer();

test("source order, pre-copy file/pasted keyword recommendations and clipboard fallback", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await expect(page.getByText("발행일·시점", { exact: true })).toHaveCount(0);
  await expect(page.getByText("원래 부제", { exact: true })).toHaveCount(0);
  const order = await page.locator(".editor").evaluate((el) => {
    const items = [
      el.querySelector('input[placeholder^="https"]'),
      el.querySelector('input[aria-label="원문 파일"]'),
      Array.from(el.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("사진 키워드 추천받기"),
      ),
      el.querySelector('input[aria-label="표지 사진 첨부"]'),
    ];
    return items.every(
      (item, i) =>
        i === 0 ||
        !!(
          items[i - 1]!.compareDocumentPosition(item!) &
          Node.DOCUMENT_POSITION_FOLLOWING
        ),
    );
  });
  expect(order).toBe(true);
  await page.getByLabel("원문 파일", { exact: true }).setInputFiles({
    name: "article.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(source),
  });
  await expect(page.getByLabel("통합 원문")).toHaveValue(source);
  const recommendation = page.waitForResponse((r) =>
    r.url().endsWith("/generate"),
  );
  await page
    .getByRole("button", { name: "사진 키워드 추천받기", exact: true })
    .click();
  const p = await (await recommendation).json();
  expect(p.copy.headline).toBe("");
  expect(p.copy.pages[0].body).toBe("");
  expect(p.sourceConfirmed).toBe(false);
  expect(p.copy.keywords.map((k: any) => k.query)).toEqual([
    "수출",
    "금리",
    "원화",
    "한국은행",
  ]);
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          (window as any).copiedAPI = text;
        },
      },
    });
  });
  await page.getByRole("button", { name: "원화 복사", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("원화 복사 완료");
  expect(await page.evaluate(() => (window as any).copiedAPI)).toBe("원화");
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async () => {
          throw new Error("denied");
        },
      },
    });
    document.execCommand = (cmd: string) => {
      (window as any).copiedFallback =
        cmd === "copy"
          ? (document.activeElement as HTMLTextAreaElement).value
          : "";
      return true;
    };
  });
  await page.getByRole("button", { name: "수출 복사", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("수출 복사 완료");
  expect(await page.evaluate(() => (window as any).copiedFallback)).toBe(
    "수출",
  );
  await page.evaluate(() => {
    document.execCommand = () => false;
  });
  await page.getByRole("button", { name: "금리 복사", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("복사하지 못했습니다");
  await page.getByLabel("통합 원문").fill("수출");
  await page
    .getByRole("button", { name: "사진 키워드 추천받기", exact: true })
    .click();
  await expect(page.getByLabel("검색어 1", { exact: true })).toHaveValue(
    "수출",
  );
  await expect(page.locator(".keyword")).toHaveCount(1);
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.getByText("사진 검색어 제안")).toHaveCount(0);
  await expect(page.getByText("제목 줄바꿈", { exact: true })).toHaveCount(0);
});

test("cover layout uses 42px safe subtitle; malformed slash and stale render rejected", async ({
  page,
  request,
}) => {
  const p0 = blank();
  p0.copy.kicker = "가".repeat(20);
  const font = (
    await fs.readFile("public/fonts/PretendardVariable.woff2")
  ).toString("base64");
  await page.setContent(html(p0, 0, font, ""));
  await page.evaluate(async () => {
    await document.fonts.load("800 42px Pretendard");
    await document.fonts.ready;
  });
  const metric = await page.locator(".kicker").evaluate((el) => ({
    size: getComputedStyle(el).fontSize,
    width: el.getBoundingClientRect().width,
  }));
  expect(metric.size).toBe("42px");
  expect(metric.width).toBeLessThanOrEqual(952);
  let p = await (await request.post("/api/projects")).json();
  const image = await request.post("/api/photos", {
    multipart: {
      file: {
        name: "cover.jpg",
        mimeType: "image/jpeg",
        buffer: await photo(),
      },
    },
  });
  p.photo = (await image.json()).url;
  p.copy.headline = "하나/둘/셋/넷";
  p = await (await request.put("/api/projects/" + p.id, { data: p })).json();
  let r = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision, only: 0 },
  });
  expect(r.ok()).toBe(false);
  expect((await r.json()).message).toContain("최대 3줄");
  p.copy.headline = "수출 / 증가";
  p.copy.kicker = "가".repeat(21);
  p.kickerHidden = true;
  p = await (await request.put("/api/projects/" + p.id, { data: p })).json();
  r = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision, only: 0 },
  });
  expect(r.ok()).toBe(true);
  p = await r.json();
  for (const endpoint of ["download", "png/0"])
    expect(
      (await request.get(`/api/projects/${p.id}/${endpoint}`)).status(),
    ).toBe(400);
  const inFlight = request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision, only: 0 },
  });
  await new Promise((r) => setTimeout(r, 100));
  p.copy.headline = "새로운 / 제목";
  const saved = await request.put("/api/projects/" + p.id, { data: p });
  expect(saved.ok()).toBe(true);
  expect((await inFlight).status()).toBe(409);
  const current = await (await request.get("/api/projects/" + p.id)).json();
  expect(current.copy.headline).toBe("새로운 / 제목");
  expect(current.coverRenderRevision).not.toBe(current.revision);
  for (const endpoint of ["download", "png/0"])
    expect(
      (await request.get(`/api/projects/${p.id}/${endpoint}`)).status(),
    ).toBe(400);
  p = current;
  p.copy.pages[0].title = "본문";
  p.copy.pages[0].body = "확인한 원문 내용입니다.";
  p = await (await request.put("/api/projects/" + p.id, { data: p })).json();
  p = await (
    await request.post(`/api/projects/${p.id}/render`, {
      data: { revision: p.revision },
    })
  ).json();
  const previewBytes = await (await request.get(p.renders[0])).body();
  expect(p.copyApproved).toBe(false);
  expect(p.imageApproved).toBe(false);
  expect(p.coverRenderRevision).toBe(p.revision);
  const exported = await request.get(`/api/projects/${p.id}/png/0`);
  expect(exported.ok()).toBe(true);
  expect((await exported.body()).equals(previewBytes)).toBe(true);
  expect(p.kickerHidden).toBe(true);
  expect(p.copy.kicker).toBe("가".repeat(21));
});
