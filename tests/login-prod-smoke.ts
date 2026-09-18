// 운영 HTTPS smoke 검수 (읽기 전용, 잘못된 로그인 1회만 시도)
import { chromium } from "@playwright/test";
const BASE = "https://card.redevpartners.net";
const OUT = process.argv[2];
const result: Record<string, unknown> = {};
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 2048, height: 1000 } });
const page = await ctx.newPage();
const dialogs: string[] = [];
page.on("dialog", (d) => dialogs.push(d.type()));
const res = await page.goto(BASE + "/", { waitUntil: "networkidle" });
result.pageStatus = res?.status();
result.wwwAuthenticate = res?.headers()["www-authenticate"] ?? null;
const form = page.getByRole("form", { name: "공용 계정 로그인" });
await form.waitFor({ state: "visible", timeout: 15000 });
const fb = (await form.boundingBox())!;
const copy = (await page.locator(".welcome-copy").boundingBox())!;
const card = (await page.locator(".welcome .welcome-card").boundingBox())!;
result.form = fb;
result.formCenterX = fb.x + fb.width / 2;
result.viewportCenterX = 1024;
result.copyRightLeqFormLeft = copy.x + copy.width <= fb.x + 1;
result.formRightLeqCardLeft = fb.x + fb.width <= card.x + 1;
result.formInsideViewport = fb.y >= 0 && fb.y + fb.height <= 1000;
result.createButtons = await page
  .getByRole("button", { name: /첫 카드 만들기|새 카드 만들기/ })
  .count();
result.loginButtonEnabled = await page
  .getByRole("button", { name: "로그인", exact: true })
  .isEnabled();
result.sourceTextareaCount = await page.getByLabel("통합 원문").count();
result.overflow = await page.evaluate(
  () => document.documentElement.scrollWidth - window.innerWidth,
);
await page.screenshot({ path: OUT });
// API (브라우저 컨텍스트, 쿠키 없음)
const api: Record<string, unknown> = {};
for (const p of ["/api/session", "/api/projects", "/uploads/unknown", "/renders/unknown"]) {
  const r = await ctx.request.get(BASE + p);
  api[p] = { status: r.status(), body: await r.text() };
}
result.api = api;
// 잘못된 로그인 1회
await page.getByLabel("아이디").fill("cbtf");
await page.getByLabel("비밀번호").fill("smoke-wrong-" + Date.now());
await page.getByRole("button", { name: "로그인", exact: true }).click();
const alert = page.getByRole("alert");
await alert.waitFor({ state: "visible", timeout: 15000 });
result.failAlert = (await alert.textContent())?.trim();
result.formStillVisible = await form.isVisible();
result.sessionCookieAfterFail = (await ctx.cookies()).some((c) => c.name === "studio_session");
result.projectsAfterFail = (await ctx.request.get(BASE + "/api/projects")).status();
result.dialogs = dialogs;
await browser.close();
console.log(JSON.stringify(result, null, 2));
