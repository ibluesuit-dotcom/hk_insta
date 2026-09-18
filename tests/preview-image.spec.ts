import { test, expect } from "@playwright/test";
import { blank, resizePages } from "../shared/model";
import sharp from "sharp";

test("body previews load, explain expired sessions and recover in both preview modes", async ({
  page,
}) => {
  const project = resizePages(blank(), 2);
  project.renders = [
    "/renders/cover.png",
    "/renders/body1.png",
    "/renders/body2.png",
  ];
  let expired = false;
  const png = await sharp({
    create: { width: 1080, height: 1350, channels: 3, background: "#123456" },
  })
    .png()
    .toBuffer();
  await page.addInitScript(
    (id) => sessionStorage.setItem("studio-project", id),
    project.id,
  );
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      json:
        url.pathname === "/api/session"
          ? { authenticated: !expired, configured: true }
          : url.pathname === "/api/projects"
            ? [project]
            : url.pathname === "/api/health"
              ? { mock: true }
              : project,
    });
  });
  await page.route("**/renders/**", async (route) => {
    if (expired) await route.fulfill({ status: 401, json: { code: "AUTH" } });
    else await route.fulfill({ contentType: "image/png", body: png });
  });
  await page.goto("/");
  const image = page.locator(".feed-image img");
  await expect(image).toHaveJSProperty("naturalWidth", 1080);
  expired = true;
  await page.getByRole("button", { name: "2장 보기", exact: true }).click();
  await expect(
    page.getByText("로그인이 만료되었습니다", { exact: true }),
  ).toBeVisible();
  await expect(image).toHaveCount(0);
  expired = false;
  await page.getByRole("button", { name: "이미지 다시 불러오기" }).click();
  await expect(image).toHaveJSProperty("naturalWidth", 1080);
  await page.getByRole("button", { name: "3장 보기", exact: true }).click();
  await expect(image).toHaveJSProperty("naturalWidth", 1080);
  await page.getByRole("button", { name: "원본 카드", exact: true }).click();
  await expect(page.locator(".original img")).toHaveJSProperty(
    "naturalWidth",
    1080,
  );
  await page.getByRole("button", { name: "이전 카드", exact: true }).click();
  await expect(page.locator(".original img")).toHaveJSProperty(
    "naturalWidth",
    1080,
  );
});
