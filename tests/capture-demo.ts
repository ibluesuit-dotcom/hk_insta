import fs from "node:fs/promises";
await fs.mkdir("docs/fix-evidence/demo", { recursive: true });
import { chromium } from "playwright";
const base = "http://127.0.0.1:4311";
const projects = await (await fetch(base + "/api/projects")).json();
const original = projects.find((p: any) => p.name === "E2E 경제 뉴스");
if (!original)
  throw new Error("Run the E2E tests first with npm run dev:mock active.");
async function post(url: string, data: any = {}) {
  const res = await fetch(base + url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.message);
  return body;
}
let p = await post(`/api/projects/${original.id}/duplicate`);
p.name = "샘플 제작 · 모의 문안";
p = await (
  await fetch(base + "/api/projects/" + p.id, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(p),
  })
).json();
p = await post(`/api/projects/${p.id}/render`, { revision: p.revision });
p = await post(`/api/projects/${p.id}/approve`, {
  revision: p.revision,
  kind: "copy",
});
p = await post(`/api/projects/${p.id}/approve`, {
  revision: p.revision,
  kind: "image",
});
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1512, height: 1100 } });
await page.goto(base);
await page.getByRole("button", { name: "작업 보관함" }).click();
await page
  .locator(".archive-card")
  .filter({ has: page.getByRole("heading", { name: "샘플 제작 · 모의 문안" }) })
  .first()
  .getByRole("button", { name: "이어서 편집" })
  .click();
await page.screenshot({
  path: "docs/fix-evidence/demo/05-source.png",
  fullPage: true,
});
await page.getByRole("button", { name: "다음 카드" }).click();
for (const size of [320, 390]) {
  await page.getByRole("button", { name: size + "px" }).click();
  await page
    .locator(".phone")
    .screenshot({ path: `docs/fix-evidence/demo/phone-${size}.png` });
}
await page.getByRole("button", { name: "원본 카드", exact: true }).click();
await page
  .locator(".original")
  .screenshot({ path: "docs/fix-evidence/demo/body-original-preview.png" });
await page.goto("http://127.0.0.1:4310");
await page.screenshot({
  path: "docs/fix-evidence/demo/06-production-home.png",
  fullPage: true,
});
await browser.close();
console.log("Demo ready: " + p.id);
