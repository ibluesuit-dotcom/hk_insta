import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "./auth-fixture";
import yauzl from "yauzl";

const source =
  "산업통상자원부는 지난달 수출이 전년 대비 10% 증가했다고 밝혔다. 반도체와 자동차가 증가세를 이끌었다. 정부는 하반기에도 수출이 늘어날 것으로 전망했다. 다만 중국 수요 둔화는 부담 요인으로 꼽혔다. 이번 수치는 잠정치다. 확정치는 다음 달 발표된다.";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";
async function zipText(bytes: Buffer, name: string): Promise<string> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error || !zip) return reject(error);
      zip.on("end", () => reject(new Error(name + " missing")));
      zip.on("entry", (entry) => {
        if (entry.fileName !== name) return zip.readEntry();
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return reject(error);
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => resolve(Buffer.concat(chunks).toString()));
        });
      });
      zip.readEntry();
    });
  });
}
async function generated(page: Page) {
  await page.goto("/");
  await page
    .getByLabel("원문 제목", { exact: true })
    .fill("지난달 수출 10% 증가");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  const response = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await response).json();
  await expect(page.locator(".feed-image img")).toBeVisible();
  await page.getByRole("button", { name: "03인스타 게시글" }).click();
  return p;
}

test("four formats: full without AI, summary and bullets via candidates, export format, ZIP and copy", async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const first = await generated(page);
  let generations = 0;
  page.on("request", (r) => {
    if (r.url().includes("/post-text/")) generations++;
  });

  // Choosing formats calls no AI; the short caption is the default.
  for (const name of ["풀 기사", "기사 요약", "불릿 요약", "짧은 캡션"])
    await page.getByRole("tab", { name }).click();
  expect(generations).toBe(0);
  await expect(page.getByText("내보낼 형식: 짧은 캡션")).toBeVisible();

  // Full article: the source, verbatim, without AI.
  await page.getByRole("tab", { name: "풀 기사" }).click();
  await page.getByRole("button", { name: "원문 불러오기" }).click();
  const full = page.getByLabel("풀 기사 글", { exact: true });
  await expect(full).toHaveValue(source);
  expect(generations).toBe(0);

  // Summary: a candidate is shown and applied only on request.
  await page.getByRole("tab", { name: "기사 요약" }).click();
  await page.getByText("요약 설정").click();
  await page.getByLabel("요약 길이").selectOption("short");
  // An empty field takes the generated text directly, no candidate box.
  const applied = page.waitForResponse((r) =>
    r.url().endsWith("/post-text/apply"),
  );
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const candidate = page.locator(".post-candidate");
  const summary = page.getByLabel("기사 요약 글", { exact: true });
  let p = await (await applied).json();
  expect(p.postText.summary).toMatchObject({
    provenance: "generated",
    options: { length: "short" },
    review: { overall: "pass" },
  });
  expect(p.renderRevision).toBe(p.revision);
  await expect(summary).toHaveValue(p.postText.summary.text);
  await expect(candidate).toHaveCount(0);
  await expect(page.locator(".post-review")).toContainText("원문 대조 통과");

  // With text in the field, a new run is a candidate to compare first.
  await page.getByRole("button", { name: "다시 생성" }).click();
  await expect(candidate).toContainText("원문 대조 통과");
  await expect(summary).toHaveValue(p.postText.summary.text);
  await page.locator(".editor").screenshot({
    path: `${process.env.E2E_ARTIFACT_DIR}/post-text-candidate.png`,
  });
  await candidate.getByRole("button", { name: "버리기" }).click();

  // Editing drops the review; the server decides, not the browser.
  await summary.fill(p.postText.summary.text + " 직접 덧붙임.");
  await expect(page.locator(".post-review")).toContainText("원문 대조 전");
  await expect
    .poll(async () => {
      const q = await (await request.get(`/api/projects/${first.id}`)).json();
      return [q.postText.summary.provenance, q.postText.summary.review];
    })
    .toEqual(["manual", undefined]);

  // Bullets: "소제목\n- 요점\n- 요점".
  await page.getByRole("tab", { name: "불릿 요약" }).click();
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page.getByLabel("불릿 요약 글", { exact: true })).toHaveValue(
    /^\[모의\] 핵심 1\n- .+\n- .+\n- .+/,
  );

  // Export the summary: preview, caption.txt and manifest follow it.
  await page.getByRole("tab", { name: "기사 요약" }).click();
  await page.getByRole("button", { name: "내보낼 형식으로 지정" }).click();
  await expect(page.getByText("내보낼 형식: 기사 요약")).toBeVisible();
  await expect(page.locator(".ig-caption")).toContainText("직접 덧붙임.");
  const download = page.getByRole("link", { name: "내보내기", exact: true });
  await expect(download).toHaveAttribute("aria-disabled", "false");
  p = await (await request.get(`/api/projects/${first.id}`)).json();
  expect(p.renderRevision).toBe(p.revision);
  const zip = await (
    await request.get(`/api/projects/${p.id}/download`)
  ).body();
  expect(await zipText(zip, "caption.txt")).toBe(p.postText.summary.text);
  expect(JSON.parse(await zipText(zip, "manifest.json")).post).toMatchObject({
    format: "summary",
    review: "unchecked",
  });

  // Copy uses the text on screen.
  await page.getByRole("button", { name: "복사", exact: true }).click();
  await expect(page.getByText(/자를 복사했습니다/)).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    p.postText.summary.text,
  );

  // "검증만 다시" checks the saved text without generating.
  await page.getByRole("button", { name: "원문과 대조" }).click();
  await expect(page.locator(".post-review")).toContainText("원문 대조 통과");
});

test("candidate rules: project, revision, source, lock, failed check, one article", async ({
  request,
}) => {
  let p = await (await request.post("/api/projects")).json();
  const put = async (change: (p: any) => void) => {
    change(p);
    const r = await request.put("/api/projects/" + p.id, { data: p });
    expect(r.ok(), await r.text()).toBe(true);
    p = await r.json();
  };
  const candidate = async (format: string) => {
    const r = await request.post(`/api/projects/${p.id}/post-text/candidates`, {
      data: { revision: p.revision, format },
    });
    expect(r.ok(), await r.text()).toBe(true);
    return r.json();
  };
  const apply = (id: string, projectId = p.id, extra = {}) =>
    request.post(`/api/projects/${projectId}/post-text/apply`, {
      data: { candidateId: id, revision: p.revision, ...extra },
    });
  await put((p) => {
    p.source = source;
    p.copy.caption = "직접 쓴 캡션";
  });

  // The old caption-only route is closed; card generation keeps the caption.
  const old = await request.post(`/api/projects/${p.id}/generate`, {
    data: { revision: p.revision, scope: "caption" },
  });
  expect((await old.json()).message).toContain("03 인스타 게시글");

  // A candidate cannot be applied to another project, even a duplicate.
  const c = await candidate("summary");
  const copy = await (
    await request.post(`/api/projects/${p.id}/duplicate`)
  ).json();
  const foreign = await request.post(
    `/api/projects/${copy.id}/post-text/apply`,
    { data: { candidateId: c.id, revision: copy.revision } },
  );
  expect((await foreign.json()).message).toContain("다른 작업");

  // Nor after the source changed.
  await put((p) => (p.source = source + " 추가 문장입니다."));
  expect((await (await apply(c.id)).json()).message).toContain("원문이 바뀌어");

  // A locked short caption is not replaced.
  await put((p) => (p.locks = { caption: true }));
  const short = await candidate("short");
  expect((await (await apply(short.id)).json()).message).toContain("잠겨");
  await put((p) => (p.locks = {}));

  // A failed check is adopted only explicitly, and then needs review.
  await put((p) => (p.source = source + " 모의검증실패"));
  const failing = await candidate("summary");
  expect(failing.review.overall).toBe("fail");
  expect((await (await apply(failing.id)).json()).code).toBe("REVIEW");
  const adopted = await apply(failing.id, p.id, { acceptFailed: true });
  expect(adopted.ok(), await adopted.text()).toBe(true);
  p = await adopted.json();
  expect(p.postText.summary.review.overall).toBe("needs_review");

  // A candidate made before the format was edited replaces the edit only
  // when confirmed; a changed publication time makes it stale.
  await put((p) => {
    p.source = source;
    p.postText = {
      selected: "short",
      summary: { text: "직접 쓴 요약", provenance: "manual", sourceHash: null },
    };
  });
  const before = await candidate("summary");
  await put((p) => (p.postText.summary.text = "그 뒤 고친 요약"));
  expect((await (await apply(before.id)).json()).code).toBe("EDITED");
  const replaced = await apply(before.id, p.id, { replaceEdited: true });
  expect(replaced.ok(), await replaced.text()).toBe(true);
  p = await replaced.json();
  const dated = await candidate("summary");
  await put((p) => (p.publishedAt = "2026-09-01"));
  expect((await (await apply(dated.id)).json()).code).toBe("STALE");

  // A candidate can be checked again without generating.
  const recheck = await candidate("short");
  const checked = await request.post(
    `/api/projects/${p.id}/post-text/candidates/${recheck.id}/verify`,
  );
  expect(checked.ok(), await checked.text()).toBe(true);
  expect((await checked.json()).review.overall).toBe("pass");

  // A loaded URL article plus one attachment is two articles.
  await put((p) => {
    p.sourceUrl = "https://example.com/a";
    p.sourceFromUrl = true;
    p.attachments = [{ name: "b.txt", text: "둘째 기사" }];
  });
  const mixed = await request.post(
    `/api/projects/${p.id}/post-text/candidates`,
    { data: { revision: p.revision, format: "summary" } },
  );
  expect((await mixed.json()).message).toContain("한 기사");

  // Two combined articles are not summarized.
  await put((p) => {
    p.attachments = [
      { name: "a.txt", text: "첫 기사" },
      { name: "b.txt", text: "둘째 기사" },
    ];
  });
  const two = await request.post(`/api/projects/${p.id}/post-text/candidates`, {
    data: { revision: p.revision, format: "summary" },
  });
  expect((await two.json()).message).toContain("한 기사");
});

test("a post text saved while cards render keeps both the images and the text", async ({
  request,
}) => {
  const first = await (await request.post("/api/projects")).json();
  const upload = await request.post("/api/photos", {
    multipart: {
      file: {
        name: "p.jpg",
        mimeType: "image/jpeg",
        buffer: readFileSync(photo),
      },
    },
  });
  let p = {
    ...first,
    source,
    photo: (await upload.json()).url,
    copy: {
      ...first.copy,
      headline: "지난달 수출 10% 증가",
      pages: [{ ...first.copy.pages[0], title: "제목", body: "본문" }],
    },
  };
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  const rendering = request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision },
  });
  await new Promise((r) => setTimeout(r, 150));
  const saved = await request.put(`/api/projects/${p.id}`, {
    data: { ...p, copy: { ...p.copy, caption: "렌더 중 쓴 캡션" } },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const rendered = await rendering;
  expect(rendered.ok(), await rendered.text()).toBe(true);
  const done = await rendered.json();
  expect(done.copy.caption).toBe("렌더 중 쓴 캡션");
  expect(done.renderRevision).toBe(done.revision);
  expect(done.renders.every(Boolean)).toBe(true);

  // A card change during the render still rejects the images.
  const again = request.post(`/api/projects/${p.id}/render`, {
    data: { revision: done.revision },
  });
  await new Promise((r) => setTimeout(r, 150));
  await request.put(`/api/projects/${p.id}`, {
    data: {
      ...done,
      copy: {
        ...done.copy,
        pages: [{ ...done.copy.pages[0], body: "바뀐 본문" }],
      },
    },
  });
  expect((await (await again).json()).code).toBe("STALE");
});

test("an empty field does not take a text that failed the source check", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByLabel("통합 원문").fill(source + " 모의검증실패");
  await expect(page.locator(".progress")).toHaveCount(0);
  await page.getByRole("button", { name: "03인스타 게시글" }).click();
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const candidate = page.locator(".post-candidate");
  await expect(candidate).toContainText("원문 대조 실패");
  await expect(page.getByLabel("짧은 캡션 글", { exact: true })).toHaveValue(
    "",
  );
  await expect(
    candidate.getByRole("button", { name: "검토 필요로 적용" }),
  ).toBeVisible();
});
