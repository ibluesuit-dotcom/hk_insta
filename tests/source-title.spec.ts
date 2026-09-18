import { test, expect } from "./auth-fixture";
import { encodeHeadlineLines } from "../shared/model";
import fs from "node:fs/promises";
async function refresh(page: import("@playwright/test").Page) {
  const response = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: /▧ 전체.*미리보기 갱신/ }).click();
  const rendered = await response;
  expect(rendered.ok(), await rendered.text()).toBe(true);
  await expect(page.locator(".progress")).toHaveCount(0);
  return rendered.json();
}
const original =
  '"금리 인상은 문제도 아니다"…코스피, 외국인·기관 매수에 6800선 안착 [fn오전시황]';
const normalized =
  "“금리 인상은 문제도 아니다” 코스피, 외국인·기관 매수에 6800선 안착";

test("original title generation, real render, candidate staging and lock preservation", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page.getByLabel("원문 제목", { exact: true }).fill(original);
  await page
    .getByLabel("통합 원문")
    .fill(
      "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 확인했다. 잠정치는 달라질 수 있다.",
    );
  await page
    .getByLabel("표지 사진 첨부")
    .setInputFiles(
      "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
    );
  const rendered = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const response = await rendered;
  expect(response.ok(), await response.text()).toBe(true);
  const p = await response.json();
  expect(p.copy.headline).toBe(normalized);
  expect(p.sourceTitle).toBe(original);
  expect(p.copy.headlineEvidence).toEqual([original]);
  await fs.writeFile(
    process.env.E2E_ARTIFACT_DIR + "/original-title-cover.png",
    await (await request.get(p.renders[0])).body(),
  );
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByLabel("표지 제목", { exact: true }).fill("수동 / 제목");
  await refresh(page);
  await page.getByRole("button", { name: "원제 적용", exact: true }).click();
  await expect(page.getByLabel("표지 제목", { exact: true })).toHaveValue(
    normalized,
  );
  let stored = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(stored.copy.headline).toBe("수동 / 제목");
  await expect(
    page.getByRole("link", { name: "내보내기", exact: true }),
  ).toHaveAttribute("aria-disabled", "true");
  await page.locator(".evidence").first().locator("summary").click();
  await expect(page.locator(".evidence").first()).toContainText("원문 일치");
  await refresh(page);
  const lockSaved = page.waitForResponse((r) => r.request().method() === "PUT");
  await page.getByLabel("headline 잠금").click();
  await lockSaved;
  await expect(
    page.getByRole("button", { name: "원제 적용", exact: true }),
  ).toBeDisabled();
  stored = await (await request.get(`/api/projects/${p.id}`)).json();
  // Direct API requests obey the same lock, including an explicitly requested title apply.
  stored.sourceTitle = "[특징주] 변경 원제";
  stored = await (
    await request.put(`/api/projects/${p.id}`, { data: stored })
  ).json();
  for (const scope of ["headline", "all"]) {
    const result = await request.post(`/api/projects/${p.id}/generate`, {
      data: { revision: stored.revision, scope },
    });
    expect(result.ok()).toBe(true);
    const next = await result.json();
    expect(next.copy.headline).toBe(normalized);
    expect(next.copy.headlineMode).toBe("literal");
    if (scope === "all") stored = next;
  }
});

test("empty-after-cleaning/oversized original title rejects generation; manual title and reads stay untouched", async ({
  request,
}) => {
  let p = await (await request.post("/api/projects")).json();
  p.copy.headline = "[특징주] 수동 원문 그대로";
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  for (const sourceTitle of ["[특징주] [마감시황]", "가".repeat(201)]) {
    p.sourceTitle = sourceTitle;
    p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
    for (const scope of ["all", "headline"]) {
      const rejected = await request.post(`/api/projects/${p.id}/generate`, {
        data: { revision: p.revision, scope },
      });
      expect(rejected.status()).toBe(400);
      expect((await rejected.json()).message).toContain("원문 제목");
    }
    const read = await (await request.get(`/api/projects/${p.id}`)).json();
    expect(read.copy.headline).toBe("[특징주] 수동 원문 그대로");
    expect(read.revision).toBe(p.revision);
  }
  // Title apply is available with title alone; body confirmation is for AI body generation.
  p.sourceTitle = "[속보][특징주] 제목 6800";
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  const candidate = await request.post(`/api/projects/${p.id}/generate`, {
    data: { revision: p.revision, scope: "headline" },
  });
  expect(candidate.ok()).toBe(true);
  expect((await candidate.json()).copy.headline).toBe("[속보] 제목 6800");
});

test("untitled sources retain AI title generation and staged regeneration", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.getByLabel("통합 원문")).toBeVisible();
  await page
    .getByLabel("통합 원문")
    .fill(
      "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 확인했다. 잠정치는 달라질 수 있다.",
    );
  await page
    .getByLabel("표지 사진 첨부")
    .setInputFiles(
      "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
    );
  const rendered = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const result = await rendered;
  expect(result.ok()).toBe(true);
  let p = await result.json();
  expect(p.sourceTitle).toBe("");
  expect(p.copy.headline).toBe("경제 뉴스, 변화의 의미");
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await page.getByLabel("표지 제목", { exact: true }).fill("직접 쓴 제목");
  await refresh(page);
  await expect(
    page.getByRole("button", { name: "원제 적용", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "↻ 다시 생성", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("표지 제목", { exact: true })).toHaveValue(
    "경제 뉴스, 변화의 의미",
  );
  p = await (await request.get(`/api/projects/${p.id}`)).json();
  expect(p.copy.headline).toBe("직접 쓴 제목");
  // A valid-schema but unrenderable original title remains intact after render failure.
  p.sourceTitle = "가".repeat(120);
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  p = await (
    await request.post(`/api/projects/${p.id}/generate`, {
      data: { revision: p.revision, scope: "all" },
    })
  ).json();
  expect(p.copy.headline).toBe(p.sourceTitle);
  const overflow = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision },
  });
  expect(overflow.status()).toBe(400);
  expect((await overflow.json()).message).toContain("3줄");
  expect(
    (await (await request.get(`/api/projects/${p.id}`)).json()).copy.headline,
  ).toBe(p.sourceTitle);
});

test("literal slash generation and actual boundaries round-trip through escaped editing and reload", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const sourceTitle = "[속보][단독] 2026/09/18 코스피 6800선 안착 [fn오전시황]";
  await page.getByLabel("원문 제목", { exact: true }).fill(sourceTitle);
  await page
    .getByLabel("통합 원문")
    .fill(
      "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 관련 지표를 확인했다.",
    );
  await page
    .getByLabel("표지 사진 첨부")
    .setInputFiles(
      "design_handoff_news_card_fullbleed/PYH2026090110410005100.jpg",
    );
  const rendered = page.waitForResponse((r) => r.url().endsWith("/render"));
  await page.getByRole("button", { name: "생성", exact: true }).click();
  const response = await rendered;
  expect(response.ok(), await response.text()).toBe(true);
  let p = await response.json();
  expect(p.copy.headlineMode).toBe("literal");
  expect(p.coverLayout.lines.join(" ")).toBe(
    "[속보][단독] 2026/09/18 코스피 6800선 안착",
  );
  expect(p.coverLayout.lines.length).toBeGreaterThan(1);
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  const editor = page.getByLabel("표지 제목", { exact: true });
  await expect(editor).toHaveValue(encodeHeadlineLines(p.coverLayout.lines));
  await expect(
    page.getByRole("link", { name: "내보내기", exact: true }),
  ).toHaveAttribute("aria-disabled", "false");
  await page.reload();
  await page.getByRole("button", { name: "02문안·사진 편집" }).click();
  await expect(editor).toHaveValue(encodeHeadlineLines(p.coverLayout.lines));
  await editor.fill(
    encodeHeadlineLines(["[속보][단독]", "2026/09/18 코스피", "6800선 안착"]),
  );
  p = await refresh(page);
  expect(p.copy.headlineMode).toBe("escaped");
  expect(p.coverLayout.lines).toEqual([
    "[속보][단독]",
    "2026/09/18 코스피",
    "6800선 안착",
  ]);
  expect(p.sourceTitle).toBe(sourceTitle);
  expect(p.copy.headlineEvidence).toEqual([sourceTitle]);
  await fs.writeFile(
    process.env.E2E_ARTIFACT_DIR + "/escaped-title-cover.png",
    await (await request.get(p.renders[0])).body(),
  );
  await page.getByRole("button", { name: "원제 적용", exact: true }).click();
  await page.getByLabel("부제", { exact: true }).fill("다른 항목도 함께 저장");
  p = await refresh(page);
  expect(p.copy.headlineMode).toBe("literal");
  expect(p.copy.kicker).toBe("다른 항목도 함께 저장");
  await expect(editor).toHaveValue(encodeHeadlineLines(p.coverLayout.lines));
  p.sourceTitle = "美/中 갈등/환율/수출 1/4분기";
  p = await (await request.put(`/api/projects/${p.id}`, { data: p })).json();
  p = await (
    await request.post(`/api/projects/${p.id}/generate`, {
      data: { revision: p.revision, scope: "all" },
    })
  ).json();
  expect(p.copy.headline).toBe(p.sourceTitle);
  const render = await request.post(`/api/projects/${p.id}/render`, {
    data: { revision: p.revision },
  });
  expect(render.ok(), await render.text()).toBe(true);
  p = await render.json();
  expect(p.coverLayout.lines.join(" ")).toBe(p.sourceTitle);
});
