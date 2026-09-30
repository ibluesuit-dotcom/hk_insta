import { test, expect } from "./auth-fixture";

const source =
  "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 함께 확인했다. 잠정치는 앞으로 달라질 수 있다.";
const photo = "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg";

test("photo post: choose it first, upload five photos at once, captions on/off, AI writes the cover only", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);

  // The summary post is the default; the photo post swaps the page count.
  await expect(
    page.getByRole("radio", { name: "사진 + 요약 텍스트" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "사진 게시물" }).click();
  await expect(page.getByLabel("본문 페이지 수")).toHaveCount(0);
  await page.getByRole("radio", { name: "이미지 + 하단 글" }).click();

  // Generating without photos is refused before any AI call.
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("본문 사진을 1장 이상");

  // Six at once is more than allowed; five fit and replace the blank card.
  await page.getByLabel("사진 추가").setInputFiles(Array(6).fill(photo));
  await expect(page.getByRole("alert")).toContainText("5장만 더");
  await page.getByLabel("사진 추가").setInputFiles(Array(5).fill(photo));
  await expect(page.locator(".photo-strip img")).toHaveCount(5);
  await expect(page.getByLabel("사진 추가")).toBeDisabled();
  await page.locator(".editor").screenshot({
    path: `${process.env.E2E_ARTIFACT_DIR}/photo-post-source.png`,
  });

  const generated = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await generated).json();
  expect(p.postType).toBe("photo");
  expect(p.count).toBe(5);
  expect(p.renders).toHaveLength(6);
  expect(p.copy.pages.every((pg: any) => pg.kind === "photo")).toBe(true);
  expect(p.copy.pages.every((pg: any) => pg.photoCard.textVisible)).toBe(true);
  // Outside "AI추천 문구" the editor writes card text; generation leaves it.
  expect(p.copy.pages.every((pg: any) => !pg.photoCard.text)).toBe(true);
  expect(p.copy.headline).toBe("금리와 수출 동향");

  // "이미지 + 글": each photo card opens its caption field in 02.
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByRole("button", { name: "사진 1", exact: true }).click();
  await expect(page.getByLabel("사진 문구")).toBeVisible();

  // Back to a summary post is refused while it holds more than 3 photos.
  await page.getByRole("button", { name: "01원문과 제작 방향" }).click();
  await page.getByRole("radio", { name: "사진 + 요약 텍스트" }).click();
  await expect(page.getByRole("alert")).toContainText("3장 이하로");
  await expect(
    page.getByRole("radio", { name: "사진 게시물" }),
  ).toHaveAttribute("aria-checked", "true");

  // "이미지만" hides every photo caption.
  await page.getByRole("radio", { name: "이미지만" }).click();
  await expect
    .poll(async () => {
      const q = await (await request.get(`/api/projects/${p.id}`)).json();
      return q.copy.pages.map((pg: any) => pg.photoCard.textVisible);
    })
    .toEqual([false, false, false, false, false]);
});

test("AI추천 문구: card count first, titles and summaries generated first, photos attached in 02", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);

  // The summary post is the default; the photo post swaps the page count.
  await expect(
    page.getByRole("radio", { name: "사진 + 요약 텍스트" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "사진 게시물" }).click();
  await expect(page.getByLabel("본문 페이지 수")).toHaveCount(0);
  await page
    .getByRole("radio", { name: "제목·사진·요약 (AI추천 문구)" })
    .click();
  await expect(page.getByLabel("사진 추가")).toHaveCount(0);

  // Without a card count, generating is refused before any AI call.
  await page.getByRole("button", { name: "생성", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("사진 카드 수를 먼저");

  // Five cards, no photos yet: numbered empty slots.
  await page.getByRole("radio", { name: "5장" }).click();
  await expect(page.locator(".photo-strip .thumb-empty")).toHaveCount(5);
  await page.locator(".editor").screenshot({
    path: `${process.env.E2E_ARTIFACT_DIR}/photo-post-source.png`,
  });

  // Text first: the cover and each card's text, and no render yet.
  let rendered = 0;
  page.on("request", (r) => {
    if (r.url().endsWith("/render")) rendered++;
  });
  const generated = page.waitForResponse((r) => r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await generated).json();
  expect(p.postType).toBe("photo");
  expect(p.count).toBe(5);
  expect(p.copy.headline).toBe("금리와 수출 동향");
  for (const [i, pg] of p.copy.pages.entries()) {
    expect(pg.kind).toBe("photo");
    expect(pg.photoCard).toMatchObject({
      photo: "",
      layout: "frame",
      title: `[모의] 핵심 ${i + 1}`,
    });
    expect(pg.photoCard.summary.split("\n").length).toBeLessThanOrEqual(3);
  }
  await expect(page.locator(".notice")).toContainText("사진 카드 5장에 사진을");
  expect(rendered).toBe(0);

  // 02 opened on the first card, which asks for its photo.
  await expect(
    page.getByRole("button", { name: "사진 1", exact: true }),
  ).toHaveClass(/selected/);
  await expect(page.getByLabel("액자형 제목")).toHaveValue("[모의] 핵심 1");
  await expect(page.getByLabel("액자형 요약")).toHaveValue(
    p.copy.pages[0].photoCard.summary,
  );
  const render = () => page.getByRole("button", { name: /미리보기 갱신/ });
  const refused = page.waitForResponse((r) => r.url().endsWith("/render"));
  await render().click();
  expect((await (await refused).json()).message).toContain(
    "사진을 넣어 주세요",
  );
  for (let n = 1; n <= 5; n++) {
    await page.getByRole("button", { name: `사진 ${n}`, exact: true }).click();
    await expect(page.locator(".progress")).toHaveCount(0);
    await page.getByLabel("사진 넣기").setInputFiles(photo);
    await expect(page.getByLabel("사진 교체")).toBeVisible();
  }
  // The text written before the photo is kept.
  const withPhotos = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(withPhotos.copy.pages[0].photoCard.summary).toBe(
    p.copy.pages[0].photoCard.summary,
  );
  const done = page.waitForResponse((r) => r.url().endsWith("/render"));
  await render().click();
  const r = await done;
  expect(r.ok(), await r.text()).toBe(true);
  expect((await r.json()).renders).toHaveLength(6);

  // Back to a summary post is refused while it holds more than 3 photos.
  await page.getByRole("button", { name: "01원문과 제작 방향" }).click();
  await page.getByRole("radio", { name: "사진 + 요약 텍스트" }).click();
  await expect(page.getByRole("alert")).toContainText("3장 이하로");

  // Fewer cards drops them from the end, after asking.
  page.once("dialog", (d) => d.accept());
  await page.getByRole("radio", { name: "3장" }).click();
  await expect(page.locator(".photo-strip .thumb")).toHaveCount(3);

  // Other designs go back to uploading photos first.
  await page.getByRole("radio", { name: "이미지만" }).click();
  await expect(page.getByLabel("사진 추가")).toBeVisible();
  await expect(page.getByRole("radio", { name: "3장" })).toHaveCount(0);
});

test("switching a summary post to a photo post keeps written text cards and shown captions", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("원문 제목", { exact: true }).fill("금리와 수출 동향");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);
  const first = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await first).json();

  // A photo card with its caption shown, next to the written text card.
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByRole("button", { name: "본문 1", exact: true }).click();
  await page.getByLabel("페이지 제목", { exact: true }).fill("직접 쓴 제목");
  await page.getByLabel("사진 카드 추가").setInputFiles(photo);
  await page.getByRole("button", { name: "＋ 문구 추가" }).click();
  await page.getByLabel("사진 문구").fill("부두 풍경");

  await page.getByRole("button", { name: "01원문과 제작 방향" }).click();
  await page.getByRole("radio", { name: "사진 게시물" }).click();
  await expect(
    page.getByRole("radio", { name: "이미지 + 하단 글" }),
  ).toHaveAttribute("aria-checked", "true");

  const again = page.waitForResponse((r) => r.url().endsWith("/generate"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const q = await (await again).json();
  expect(q.copy.pages[0]).toMatchObject({
    title: "직접 쓴 제목",
    body: p.copy.pages[0].body,
  });
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(saved.copy.pages[1].photoCard).toMatchObject({
    text: "부두 풍경",
    textVisible: true,
  });
});

test("frame card (1g): chosen for the photo post, title and 3-line summary typed, rendered and checked", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByLabel("원문 제목", { exact: true }).fill("코스피 9천 달성");
  await page.getByLabel("통합 원문").fill(source);
  await page.getByLabel("표지 사진 첨부").setInputFiles(photo);
  await expect(page.locator(".progress")).toHaveCount(0);
  await page.getByRole("radio", { name: "사진 게시물" }).click();
  await page.getByRole("radio", { name: "제목·사진·요약 (액자형)" }).click();
  await page.getByLabel("사진 추가").setInputFiles(photo);
  await expect(page.locator(".photo-strip img")).toHaveCount(1);
  const generated = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const p = await (await generated).json();
  expect(p.copy.pages[0].photoCard).toMatchObject({
    layout: "frame",
    fit: "cover",
  });

  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByRole("button", { name: "사진 1", exact: true }).click();
  await expect(
    page.getByRole("radio", { name: "제목·사진·요약 (액자형)" }),
  ).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("액자형 제목").fill("코스피 9천 달성");
  await page.getByLabel("제목 빨간 강조").fill("9천");
  await page
    .getByLabel("액자형 요약")
    .fill(
      "코스피가 무려 6개월만에\n9천선을 다시 돌파하여\n사상최고가를 기록\n넷째 줄",
    );
  // A fourth line is kept as typed, flagged, and refused at render.
  await expect(page.getByLabel("액자형 요약")).toHaveValue(
    "코스피가 무려 6개월만에\n9천선을 다시 돌파하여\n사상최고가를 기록\n넷째 줄",
  );
  await expect(page.getByText("요약이 4줄입니다")).toBeVisible();
  const tooLong = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: /미리보기 갱신/ }).click();
  expect((await (await tooLong).json()).message).toContain("3줄을 넘습니다");
  await page
    .getByLabel("액자형 요약")
    .fill("코스피가 무려 6개월만에\n9천선을 다시 돌파하여\n사상최고가를 기록");
  await page.getByLabel("요약 빨간 강조").fill("없는 문구");
  await expect(page.getByText("요약에 이 문구가 없어")).toBeVisible();
  await page.getByLabel("요약 빨간 강조").fill("9천선을 다시 돌파");
  await page.getByLabel("요약 밑줄").fill("사상최고가를 기록");
  await page.locator(".editor").screenshot({
    path: `${process.env.E2E_ARTIFACT_DIR}/frame-card-editor.png`,
  });

  const rendered = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: /미리보기 갱신/ }).click();
  const r = await rendered;
  expect(r.ok(), await r.text()).toBe(true);
  const done = await r.json();
  expect(done.renderRevision).toBe(done.revision);
  expect(done.copy.pages[0].photoCard).toMatchObject({
    title: "코스피 9천 달성",
    summaryUnderline: "사상최고가를 기록",
  });

  // A title that does not fit one line even at 96px is reported.
  await page
    .getByLabel("액자형 제목")
    .fill("코스피가 사상 처음으로 9천선을 돌파했다");
  const failed = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: /미리보기 갱신/ }).click();
  expect((await (await failed).json()).message).toContain("한 줄(86px)");
  const saved = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(saved.copy.pages[0].photoCard.title).toBe(
    "코스피가 사상 처음으로 9천선을 돌파했다",
  );
});

test("a photo thumbnail shows × on hover and removes that photo; the last one leaves a blank card", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByRole("radio", { name: "사진 게시물" }).click();
  await page.getByLabel("사진 추가").setInputFiles([photo, photo, photo]);
  const thumbs = page.locator(".photo-strip .thumb");
  await expect(thumbs).toHaveCount(3);
  const id = await page.evaluate(() =>
    sessionStorage.getItem("studio-project"),
  );
  const before = (await (await request.get(`/api/projects/${id}`)).json()).copy
    .pages;

  const remove = thumbs.nth(1).getByRole("button", { name: "사진 2 빼기" });
  await expect(remove).toHaveCSS("opacity", "0");
  await thumbs.nth(1).hover();
  await expect(remove).toHaveCSS("opacity", "1");
  await remove.click();
  await expect(thumbs).toHaveCount(2);
  await expect(page.getByText("사진 2/5장")).toBeVisible();
  const after = (await (await request.get(`/api/projects/${id}`)).json()).copy
    .pages;
  expect(after.map((pg: any) => pg.id)).toEqual([before[0].id, before[2].id]);

  // A photo with written text asks first.
  await page.request.put(`/api/projects/${id}`, {
    data: await (async () => {
      const p = await (await request.get(`/api/projects/${id}`)).json();
      p.copy.pages[0].photoCard.text = "쓴 글";
      return p;
    })(),
  });
  await page.reload();
  let asked = "";
  page.once("dialog", (d) => {
    asked = d.message();
    d.dismiss();
  });
  await thumbs.nth(0).hover();
  await thumbs.nth(0).getByRole("button", { name: "사진 1 빼기" }).click();
  expect(asked).toContain("쓴 글도 함께 빠집니다");
  await expect(thumbs).toHaveCount(2);

  page.on("dialog", (d) => d.accept());
  for (const n of [2, 1]) {
    await thumbs.nth(n - 1).hover();
    await thumbs
      .nth(n - 1)
      .getByRole("button", { name: `사진 ${n} 빼기` })
      .click();
    await expect(thumbs).toHaveCount(n - 1);
  }
  const last = await (await request.get(`/api/projects/${id}`)).json();
  expect(last.count).toBe(1);
  expect(last.copy.pages[0].kind ?? "text").toBe("text");
});
