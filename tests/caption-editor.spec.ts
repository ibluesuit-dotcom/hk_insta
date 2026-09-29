import type { Page } from "@playwright/test";
import { test, expect } from "./auth-fixture";
import yauzl from "yauzl";
async function zipText(bytes: Buffer, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      zip.on("error", reject);
      zip.on("end", () => reject(new Error(name + " missing")));
      zip.on("entry", (entry) => {
        if (entry.fileName !== name) return zip.readEntry();
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks: Buffer[] = [];
          stream.on("data", (chunk) => chunks.push(chunk));
          stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
        });
      });
      zip.readEntry();
    });
  });
}
const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
async function generate(page: Page) {
  await page.goto("/");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const response = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await response).json();
  await expect(page.locator(".feed-image img")).toBeVisible();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  return p;
}

test("caption autosaves without re-rendering, regenerates, locks and exports", async ({
  page,
  request,
}) => {
  const original = await generate(page);
  const caption = page.getByLabel("게시글 캡션", { exact: true });
  await expect(caption).toHaveValue(original.copy.caption);
  const download = page.getByRole("link", { name: "내보내기", exact: true });
  await expect(download).toHaveAttribute("aria-disabled", "false");

  // Typing autosaves; the card images stay current, so no render call happens.
  let renders = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/render")) renders++;
  });
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith(original.id),
  );
  await caption.fill("직접 고친 캡션입니다.");
  const p = await (await saved).json();
  expect(p.copy.caption).toBe("직접 고친 캡션입니다.");
  expect(p.renderRevision).toBe(p.revision);
  expect(p.renders).toEqual(original.renders);
  await expect(download).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator(".ig-caption")).toContainText(
    "직접 고친 캡션입니다.",
  );
  const zip = await request.get(`/api/projects/${p.id}/download`);
  expect(zip.ok()).toBe(true);
  expect(await zipText(await zip.body(), "caption.txt")).toBe(
    "직접 고친 캡션입니다.",
  );

  const regen = page
    .locator("label", { hasText: "게시글 캡션" })
    .getByRole("button", { name: "↻ 다시 생성" });
  const regenerated = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith(original.id),
  );
  await regen.click();
  await expect(caption).toHaveValue(original.copy.caption);
  const q = await (await regenerated).json();
  expect(q.copy.caption).toBe(original.copy.caption);
  expect(q.renderRevision).toBe(q.revision);
  await expect(download).toHaveAttribute("aria-disabled", "false");

  await page.getByRole("button", { name: "caption 잠금" }).click();
  await expect(caption).toBeDisabled();
  await expect(regen).toBeDisabled();
  await expect(download).toHaveAttribute("aria-disabled", "false");
  expect(renders).toBe(0);
});

test("a leftover caption draft is saved on open instead of shadowing the server caption", async ({
  page,
}) => {
  const original = await generate(page);
  await page.evaluate((id) => {
    localStorage.setItem(
      "editor-drafts:" + id,
      JSON.stringify({ caption: { "copy.caption": "예전 방식 초안" } }),
    );
  }, original.id);
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith(original.id),
  );
  await page.reload();
  const p = await (await saved).json();
  expect(p.copy.caption).toBe("예전 방식 초안");
  expect(p.renderRevision).toBe(p.revision);
  expect(
    await page.evaluate(
      (id) => localStorage.getItem("editor-drafts:" + id),
      original.id,
    ),
  ).toBe("{}");
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.getByLabel("게시글 캡션", { exact: true })).toHaveValue(
    "예전 방식 초안",
  );
});

test("a caption whose save failed survives a reload and is saved then", async ({
  page,
}) => {
  const original = await generate(page);
  const put = (r: { method(): string; url(): string }) =>
    r.method() === "PUT" && r.url().endsWith(original.id);
  await page.route(`**/api/projects/${original.id}`, (route) =>
    put(route.request()) ? route.abort() : route.continue(),
  );
  const failed = page.waitForEvent("requestfailed", put);
  await page
    .getByLabel("게시글 캡션", { exact: true })
    .fill("저장 실패한 캡션");
  await failed;
  await page.unroute(`**/api/projects/${original.id}`);

  const saved = page.waitForResponse((r) => put(r.request()));
  await page.reload();
  const p = await (await saved).json();
  expect(p.copy.caption).toBe("저장 실패한 캡션");
  expect(p.renderRevision).toBe(p.revision);
  await expect
    .poll(() =>
      page.evaluate(
        (id) => localStorage.getItem("caption-pending:" + id),
        original.id,
      ),
    )
    .toBeNull();
});

test("caption saves keep approvals and never promote a stale render", async ({
  page,
  request,
}) => {
  const original = await generate(page);
  const url = `/api/projects/${original.id}`;
  const post = async (path: string, data: object) => {
    const r = await request.post(url + path, { data });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const put = async (p: any, change: (p: any) => void) => {
    const next = structuredClone(p);
    change(next);
    const r = await request.put(url, { data: next });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };

  // Approved and fresh: a caption or caption-lock save keeps both approvals.
  let p = await post("/approve", { kind: "copy", revision: original.revision });
  p = await post("/approve", { kind: "image", revision: p.revision });
  p = await put(p, (x) => (x.copy.caption = "승인 후 캡션"));
  expect(p).toMatchObject({ copyApproved: true, imageApproved: true });
  expect(p.renderRevision).toBe(p.revision);
  expect(p.coverRenderRevision).toBe(p.revision);
  p = await put(p, (x) => (x.locks = { ...x.locks, caption: true }));
  expect(p).toMatchObject({ copyApproved: true, imageApproved: true });
  expect(p.renderRevision).toBe(p.revision);

  // A card edit makes the render stale; a later caption save must not revive it.
  p = await put(p, (x) => (x.copy.kicker = "바뀐 부제"));
  expect(p).toMatchObject({ copyApproved: false, imageApproved: false });
  const stale = p.renderRevision;
  expect(stale).toBeLessThan(p.revision);
  p = await put(p, (x) => {
    x.locks = { ...x.locks, caption: false };
    x.copy.caption = "낡은 이미지 뒤 캡션";
  });
  expect(p.renderRevision).toBe(stale);
  expect(p.coverRenderRevision).toBeLessThan(p.revision);
  expect((await request.get(url + "/download")).ok()).toBe(false);
});

async function failCaptionSave(page: Page, id: string, text: string) {
  const put = (r: { method(): string; url(): string }) =>
    r.method() === "PUT" && r.url().endsWith(id);
  await page.route(`**/api/projects/${id}`, (route) =>
    put(route.request()) ? route.abort() : route.continue(),
  );
  const failed = page.waitForEvent("requestfailed", put);
  await page.getByLabel("게시글 캡션", { exact: true }).fill(text);
  await failed;
  await page.unroute(`**/api/projects/${id}`);
}
async function otherWindowSave(
  request: any,
  id: string,
  change: (p: any) => void,
) {
  const p = await (await request.get(`/api/projects/${id}`)).json();
  change(p);
  const r = await request.put(`/api/projects/${id}`, { data: p });
  expect(r.ok(), await r.text()).toBe(true);
}

test("an unsaved caption is not auto-applied over another window's caption", async ({
  page,
  request,
}) => {
  const original = await generate(page);
  await failCaptionSave(page, original.id, "A창 캡션");
  await otherWindowSave(
    request,
    original.id,
    (p) => (p.copy.caption = "B창 캡션"),
  );

  let puts = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT") puts++;
  });
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  const notice = page.locator(".caption-conflict");
  await expect(notice).toContainText("A창 캡션");
  await expect(page.getByLabel("게시글 캡션", { exact: true })).toHaveValue(
    "B창 캡션",
  );
  await page.waitForTimeout(1000);
  expect(puts).toBe(0);
  const server = await (
    await request.get(`/api/projects/${original.id}`)
  ).json();
  expect(server.copy.caption).toBe("B창 캡션");

  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith(original.id),
  );
  await notice.getByRole("button", { name: "적용" }).click();
  expect((await (await saved).json()).copy.caption).toBe("A창 캡션");
  await expect(notice).toHaveCount(0);
});

test("a locked caption keeps the unsaved copy until the user discards it", async ({
  page,
  request,
}) => {
  const original = await generate(page);
  await failCaptionSave(page, original.id, "잠기기 전 캡션");
  await otherWindowSave(request, original.id, (p) => {
    p.locks = { ...p.locks, caption: true };
  });
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  const notice = page.locator(".caption-conflict");
  await expect(notice).toContainText("잠기기 전 캡션");
  await expect(
    notice.getByRole("button", { name: "잠금 해제 후 적용" }),
  ).toBeDisabled();
  const pending = () =>
    page.evaluate(
      (id) => localStorage.getItem("caption-recovery:" + id),
      original.id,
    );
  expect(await pending()).toBe("잠기기 전 캡션");

  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(notice).toContainText("잠기기 전 캡션");
  await notice.getByRole("button", { name: "버리기" }).click();
  await expect(notice).toHaveCount(0);
  expect(await pending()).toBeNull();
});

test("typing while the recovery notice is shown keeps the recovered caption", async ({
  page,
  request,
}) => {
  const original = await generate(page);
  await failCaptionSave(page, original.id, "복구할 캡션");
  await otherWindowSave(request, original.id, (p) => (p.copy.caption = "B"));
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  const notice = page.locator(".caption-conflict");
  await expect(notice).toContainText("복구할 캡션");
  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith(original.id),
  );
  await page.getByLabel("게시글 캡션", { exact: true }).fill("B 수정");
  expect((await (await saved).json()).copy.caption).toBe("B 수정");
  await expect(notice).toContainText("복구할 캡션");
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(notice).toContainText("복구할 캡션");
});

test("a real 409 conflict is not auto-applied after reload", async ({
  page,
  request,
}) => {
  const original = await generate(page);
  await otherWindowSave(request, original.id, (p) => (p.copy.caption = "B창"));
  const rejected = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith(original.id),
  );
  await page.getByLabel("게시글 캡션", { exact: true }).fill("A창");
  expect((await rejected).status()).toBe(409);
  let puts = 0;
  page.on("request", (r) => {
    if (r.method() === "PUT") puts++;
  });
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.locator(".caption-conflict")).toContainText("A창");
  await page.waitForTimeout(1000);
  expect(puts).toBe(0);
  const server = await (
    await request.get(`/api/projects/${original.id}`)
  ).json();
  expect(server.copy.caption).toBe("B창");
});

test("typing during a save then failing the next save recovers without a false conflict", async ({
  page,
}) => {
  const original = await generate(page);
  let n = 0;
  await page.route(`**/api/projects/${original.id}`, async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    n++;
    if (n === 1) {
      await new Promise((r) => setTimeout(r, 1200));
      return route.continue();
    }
    return route.abort();
  });
  const caption = page.getByLabel("게시글 캡션", { exact: true });
  const first = page.waitForRequest(
    (r) => r.method() === "PUT" && r.url().endsWith(original.id),
  );
  await caption.fill("첫 저장");
  await first;
  await caption.fill("첫 저장 뒤 추가");
  await page.waitForEvent("requestfailed", (r) => r.method() === "PUT");
  await page.unroute(`**/api/projects/${original.id}`);

  const saved = page.waitForResponse(
    (r) => r.request().method() === "PUT" && r.url().endsWith(original.id),
  );
  await page.reload();
  expect((await (await saved).json()).copy.caption).toBe("첫 저장 뒤 추가");
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(page.locator(".caption-conflict")).toHaveCount(0);
});
