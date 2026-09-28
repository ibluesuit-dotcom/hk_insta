// 실제 AI(유료) 로 AI 배경 기능 전체를 확인하는 수동 E2E. 일반 테스트 목록(*.spec.ts,
// *.test.ts)에 포함되지 않는다. 운영과 분리된 실제 모드 서버(포트 4314)를 먼저 띄운다.
//
//   REAL_E2E_PASSWORD=... npx tsx tests/real-ai-background.e2e.ts
//
// 유료 호출을 반복하지 않도록 이어하기를 지원한다. 상태 파일에 작업 ID 가 있으면 그 작업을
// 다시 열고, 완료 후보가 복구되면 생성 단계를 건너뛴다.
import { chromium, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import yauzl from "yauzl";
import { html } from "../server/render";
import { AI_LABELS } from "../shared/ai-background";

const BASE = process.env.REAL_E2E_BASE || "http://127.0.0.1:4314";
const ARTICLE =
  process.env.REAL_E2E_ARTICLE ||
  "https://n.news.naver.com/mnews/article/366/0001194841";
const DATA_DIR = process.env.REAL_E2E_DATA_DIR || path.resolve("data/real-e2e");
const OUT = path.resolve(process.env.REAL_E2E_OUT || "docs/ai-image/real-e2e");
const STATE = path.join(DATA_DIR, "real-e2e-state.json");
const password = process.env.REAL_E2E_PASSWORD;
if (!password) throw new Error("REAL_E2E_PASSWORD 가 필요합니다.");

const log: { step: string; ms: number; ok: boolean; note?: string }[] = [];
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    const value = await fn();
    log.push({ step: name, ms: Date.now() - started, ok: true });
    console.log(`✓ ${name} (${Date.now() - started}ms)`);
    return value;
  } catch (e) {
    log.push({
      step: name,
      ms: Date.now() - started,
      ok: false,
      note: String((e as Error).message).slice(0, 500),
    });
    console.error(`✗ ${name}:`, (e as Error).message);
    throw e;
  }
}
function check(ok: unknown, message: string) {
  if (!ok) throw new Error(message);
}
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
          stream.on("data", (c) => chunks.push(c));
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
/**
 * OCR of the cover's credit strip (bottom-left meta line), kept as a record
 * next to the saved crop for the human check. It does not gate the run: the
 * exact Korean label is asserted on the cover DOM (coverCredit).
 */
async function creditText(png: Buffer, file: string) {
  const crop = await sharp(png)
    .extract({ left: 40, top: 1236, width: 700, height: 80 })
    .resize({ width: 2100 })
    .negate()
    .grayscale()
    .png()
    .toBuffer();
  await fs.writeFile(file, crop);
  try {
    return execFileSync("tesseract", [file, "-", "-l", "eng", "--psm", "7"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return "";
  }
}

/**
 * Exact credit text of the saved project's cover, from the same card HTML the
 * renderer screenshots (server/render.ts html()), loaded into a real page.
 */
async function coverCredit(projectId: string) {
  const p = await project(projectId);
  const view = await context.newPage();
  try {
    await view.setContent(html(p, 0, "", ""));
    return await view.locator("#credit").textContent();
  } finally {
    await view.close();
  }
}

await fs.mkdir(OUT, { recursive: true });
let state: { projectId?: string } = {};
try {
  state = JSON.parse(await fs.readFile(STATE, "utf8"));
} catch {}

const browser = await chromium.launch();
const context = await browser.newContext({
  baseURL: BASE,
  viewport: { width: 1512, height: 1100 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error") console.log("[browser]", m.text());
});
const shot = (name: string) =>
  page.screenshot({ path: path.join(OUT, name), fullPage: false });
const picker = (p: Page) => p.getByRole("region", { name: "AI 배경 이미지" });
const card = (p: Page, name: "사진형" | "디지털 아트형") =>
  picker(p).getByRole("article", { name: name + " 후보" });
const badge = (p: Page, name: "사진형" | "디지털 아트형") =>
  card(p, name).locator(".ai-badge").first();
// Chromium treats http://127.0.0.1 as a potentially trustworthy origin, so the
// page keeps and sends the Secure session cookie. Playwright's APIRequestContext
// does not send Secure cookies over http, so API reads go through the page.
const get = (url: string) =>
  page.evaluate(async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(u + " " + r.status + " " + (await r.text()));
    return r.json();
  }, url);
const project = (id: string) => get("/api/projects/" + id);
const idle = () =>
  page.locator(".progress").waitFor({ state: "detached", timeout: 180_000 });
const result: Record<string, unknown> = { article: ARTICLE, base: BASE };

try {
  // 1. Login. NODE_ENV=production marks the session cookie Secure.
  await step("로그인", async () => {
    if (state.projectId)
      await page.addInitScript(
        (id) => sessionStorage.setItem("studio-project", id),
        state.projectId,
      );
    await page.goto("/");
    await page.getByLabel("아이디").fill("test");
    await page.getByLabel("비밀번호").fill(password);
    const login = page.waitForResponse((r) => r.url().endsWith("/api/login"));
    await page.getByRole("button", { name: "로그인", exact: true }).click();
    const response = await login;
    check(response.ok(), "로그인 실패 " + response.status());
    const setCookie = (await response.allHeaders())["set-cookie"] || "";
    const stored = (await context.cookies()).find(
      (c) => c.name === "studio_session",
    );
    result.cookie = {
      setCookieSecure: /;\s*secure/i.test(setCookie),
      storedByBrowser: !!stored,
      storedSecure: stored?.secure ?? null,
    };
    if (!stored) {
      // Chromium drops Secure cookies set over plain http on a non-localhost
      // origin. Re-add the same session value for this http test origin only;
      // the server's cookie settings stay unchanged.
      const value = /studio_session=([^;]+)/.exec(setCookie)?.[1];
      check(value, "Set-Cookie 에 세션이 없습니다");
      await context.addCookies([
        { name: "studio_session", value: value!, url: BASE, httpOnly: true },
      ]);
      await page.reload();
    }
    const session = await get("/api/session");
    check(session.authenticated, "세션 쿠키가 전달되지 않습니다");
    result.apiRequestContextAuthenticated = (
      await (await page.request.get("/api/session")).json()
    ).authenticated;
    const health = await get("/api/health");
    check(health.aiBackground?.generate, "AI 배경 생성 스위치가 꺼져 있음");
    check(!health.mock, "모의 모드 서버입니다");
  });

  // 2. New card (or resume the previous run's card).
  const projectId = await step("새 작업", async () => {
    let id: string | null = null;
    if (!state.projectId) {
      const created = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          new URL(r.url()).pathname === "/api/projects",
      );
      await page
        .getByRole("button", { name: /첫 카드 만들기|새 카드 만들기/ })
        .first()
        .click();
      id = (await (await created).json()).id;
      await idle();
    }
    await page.getByLabel("통합 원문").waitFor();
    id ??= await page.evaluate(() => sessionStorage.getItem("studio-project"));
    check(id, "작업 ID 없음");
    if (state.projectId) check(id === state.projectId, "이어할 작업을 못 엶");
    state.projectId = id!;
    await fs.writeFile(STATE, JSON.stringify(state));
    return id!;
  });
  result.projectId = projectId;

  // 3. Extract the article from its URL.
  await step("기사 URL 추출", async () => {
    const current = await project(projectId);
    if (current.source.trim()) return; // resumed
    await page
      .getByPlaceholder("https://… 기사 주소를 입력하세요")
      .fill(ARTICLE);
    const extracted = page.waitForResponse((r) =>
      r.url().endsWith("/api/extract/url"),
    );
    await page.getByRole("button", { name: "불러오기" }).click();
    const response = await extracted;
    check(response.ok(), "추출 실패: " + (await response.text()));
    await idle();
    await page.getByLabel("작업 이름").fill("실제 AI E2E " + projectId);
    await page.waitForTimeout(1500); // autosave
  });
  const extracted = await project(projectId);
  result.sourceTitle = extracted.sourceTitle;
  result.sourceLength = extracted.source.length;
  check(extracted.source.length > 200, "본문이 너무 짧음");
  await shot("01-extracted.png");

  if (process.env.REAL_E2E_DRY === "1")
    throw new Error("REAL_E2E_DRY: 유료 호출 전에 멈춤");

  // 4. Generate both candidates with the real models.
  const candidates = await step("AI로 이미지 생성하기", async () => {
    await picker(page).waitFor();
    await page.waitForTimeout(1500); // recent 복구
    const done = async (name: "사진형" | "디지털 아트형") =>
      (await card(page, name).count()) > 0 &&
      /완료|검토 필요/.test((await badge(page, name).textContent()) || "");
    const have = async () =>
      (await done("사진형")) && (await done("디지털 아트형"));
    if (!(await have())) {
      const responses: Record<string, unknown>[] = [];
      const timings: Record<string, number> = {};
      const started = Date.now();
      page.on("response", async (r) => {
        const u = new URL(r.url()).pathname;
        if (/\/ai-background(\/brief)?$/.test(u)) {
          const body = await r.json().catch(() => null);
          const key = u.endsWith("/brief") ? "brief" : body?.variant || u;
          timings[key] = Date.now() - started;
          responses.push({ path: u, status: r.status(), body });
        }
      });
      await picker(page)
        .getByRole("button", { name: "AI로 이미지 생성하기" })
        .click();
      await shot("02-generating.png");
      for (const name of ["사진형", "디지털 아트형"] as const)
        await badge(page, name)
          .filter({ hasNotText: /생성 중/ })
          .waitFor({ timeout: 240_000 });
      result.generation = { timingsMs: timings, responses };
    }
    const recent = await get(`/api/projects/${projectId}/ai-background/recent`);
    return recent as Record<"photo" | "art", any>;
  });
  await card(page, "사진형").scrollIntoViewIfNeeded();
  await shot("03-candidates.png");
  await picker(page).screenshot({ path: path.join(OUT, "03-picker.png") });
  result.candidates = candidates;
  for (const v of ["photo", "art"] as const) {
    check(candidates[v], `${v} 후보 없음 (생성 실패)`);
    const id = candidates[v].assetId;
    await fs.copyFile(
      path.join(DATA_DIR, "ai-backgrounds", `${id}.orig.jpg`),
      path.join(OUT, `${v}-original.jpg`),
    );
    const sidecar = JSON.parse(
      await fs.readFile(
        path.join(DATA_DIR, "ai-backgrounds", `${id}.json`),
        "utf8",
      ),
    );
    await fs.writeFile(
      path.join(OUT, `${v}-sidecar.json`),
      JSON.stringify(sidecar, null, 2),
    );
    result[v + "Meta"] = await sharp(
      path.join(DATA_DIR, "ai-backgrounds", `${id}.orig.jpg`),
    )
      .metadata()
      .then((m) => ({ width: m.width, height: m.height, format: m.format }));
  }

  // 5. Apply the photo candidate.
  await step("사진형 적용", async () => {
    const applied = page.waitForResponse((r) =>
      r.url().endsWith("/ai-background/apply"),
    );
    await card(page, "사진형")
      .getByRole("button", { name: "이 이미지 사용" })
      .click();
    check((await applied).ok(), "적용 실패");
    await idle();
    const p = await project(projectId);
    check(p.background?.variant === "photo", "background.variant != photo");
    check(p.photo === candidates.photo.url, "표지 사진이 AI 후보가 아님");
  });

  // 6. Copy generation with one body page.
  await step("문안 생성(1장)", async () => {
    const count = page.getByLabel("본문 페이지 수");
    if ((await count.inputValue()) !== "1") {
      page.once("dialog", (d) => d.accept());
      await count.selectOption("1");
    }
    await page.waitForTimeout(800);
    const generated = page.waitForResponse(
      (r) => r.url().endsWith("/generate"),
      { timeout: 240_000 },
    );
    await page.getByRole("button", { name: "생성", exact: true }).click();
    const response = await generated;
    check(response.ok(), "문안 생성 실패: " + (await response.text()));
    await idle();
    const p = await project(projectId);
    check(p.copy.headline, "표지 제목 없음");
    check(p.count === 1 && p.copy.pages.length === 1, "본문 1장이 아님");
    result.copy = { headline: p.copy.headline, kicker: p.copy.kicker };
  });

  // 7. Full render.
  const renderAll = () =>
    step("전체 렌더", async () => {
      const rendered = page.waitForResponse(
        (r) => r.url().endsWith("/render"),
        { timeout: 180_000 },
      );
      await page.getByRole("button", { name: /▧ 전체.*미리보기 갱신/ }).click();
      const response = await rendered;
      check(response.ok(), "렌더 실패: " + (await response.text()));
      await idle();
    });
  await renderAll();
  await shot("04-rendered-photo.png");

  // 8. ZIP download through the UI link, then the manifest.
  const photoZip = await step("ZIP 다운로드(사진형)", async () => {
    const link = page.getByRole("link", { name: "내보내기" });
    check(
      (await link.getAttribute("aria-disabled")) === "false",
      "내보내기 잠김",
    );
    const download = page.waitForEvent("download");
    await link.click();
    const file = await (await download).path();
    return zipEntries(await fs.readFile(file!));
  });
  await step("manifest background 확인(사진형)", async () => {
    const manifest = JSON.parse(photoZip["manifest.json"].toString());
    result.photoManifestBackground = manifest.background;
    check(manifest.background?.variant === "photo", "manifest variant");
    check(
      manifest.background?.assetId === candidates.photo.assetId,
      "manifest assetId",
    );
    await fs.writeFile(
      path.join(OUT, "cover-photo.png"),
      photoZip["01-cover.png"],
    );
    result.photoCredit = await creditText(
      photoZip["01-cover.png"],
      path.join(OUT, "credit-photo.png"),
    );
    result.photoLabel = await coverCredit(projectId);
    check(
      result.photoLabel === AI_LABELS.photo,
      "사진형 표지 문구가 다름: " + result.photoLabel,
    );
  });

  // 9. Re-apply as the art candidate and check the cover label.
  await step("아트형 재적용", async () => {
    const applied = page.waitForResponse((r) =>
      r.url().endsWith("/ai-background/apply"),
    );
    await card(page, "디지털 아트형")
      .getByRole("button", { name: "이 이미지 사용" })
      .click();
    check((await applied).ok(), "재적용 실패");
    await idle();
    const p = await project(projectId);
    check(p.background?.variant === "art", "background.variant != art");
  });
  await renderAll();
  await shot("05-rendered-art.png");
  const artZip = await step("ZIP 다운로드(아트형)", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "내보내기" }).click();
    return zipEntries(await fs.readFile((await (await download).path())!));
  });
  await step("표지 렌더 AI 문구 확인(아트형)", async () => {
    const manifest = JSON.parse(artZip["manifest.json"].toString());
    result.artManifestBackground = manifest.background;
    check(manifest.background?.variant === "art", "manifest variant");
    await fs.writeFile(path.join(OUT, "cover-art.png"), artZip["01-cover.png"]);
    result.artCredit = await creditText(
      artZip["01-cover.png"],
      path.join(OUT, "credit-art.png"),
    );
    // Exact Korean label on the cover DOM, not OCR or pixel differences.
    result.artLabel = await coverCredit(projectId);
    check(
      result.artLabel === AI_LABELS.art,
      "아트형 표지 문구가 다름: " + result.artLabel,
    );
  });
  result.ok = true;
} catch (e) {
  result.ok = false;
  result.error = String((e as Error).message);
  await shot("99-failure.png").catch(() => {});
} finally {
  result.steps = log;
  await fs.writeFile(
    path.join(OUT, "run-result.json"),
    JSON.stringify(result, null, 2),
  );
  await browser.close();
}
console.log(JSON.stringify({ ok: result.ok, error: result.error }, null, 2));
process.exit(result.ok ? 0 : 1);
