import { test as base, expect } from "@playwright/test";
// Authenticated mock runs use only the isolated review account.
export const test = base.extend({
  page: async ({ page }, use) => {
    if (process.env.REVIEW_AUTH === "1") {
      const response = await page.request.post("/api/login", {
        data: { username: "test", password: "review-pass-2026" },
      });
      expect(response.ok()).toBe(true);
    }
    await use(page);
  },
  request: async ({ request }, use) => {
    if (process.env.REVIEW_AUTH === "1") {
      const response = await request.post("/api/login", {
        data: { username: "test", password: "review-pass-2026" },
      });
      expect(response.ok()).toBe(true);
    }
    await use(request);
  },
});
export { expect };
