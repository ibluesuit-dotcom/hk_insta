import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blank,
  projectSchema,
  resizePages,
  movePage,
  emptyPage,
} from "../shared/model";
import { cacheKey, responseSchema, transportFormat } from "../server/ai";
import { candidateLines } from "../shared/linebreak";
import { render } from "../server/render";

test("strict PUT schema allows empty drafts and rejects malformed fields", () => {
  const p = blank();
  assert.equal(projectSchema.safeParse(p).success, true);
  for (const value of [undefined, null, "60", NaN, Infinity, 53, 61, 54.5]) {
    assert.equal(
      projectSchema.safeParse({ ...p, bodyFont: value }).success,
      false,
    );
  }
  for (const patch of [
    { locks: "bad" },
    { locks: { headline: "true" } },
    { attachments: [{}] },
    { unexpected: 1 },
    { copy: { ...p.copy, headline: 12 } },
    { copy: { ...p.copy, pages: [{ ...emptyPage(), extra: 1 }] } },
  ])
    assert.equal(projectSchema.safeParse({ ...p, ...patch }).success, false);
});
test("page reorder moves content, evidence and locks; removal clears only removed locks", () => {
  const p = resizePages(blank(), 3);
  p.copy.pages[2] = {
    ...emptyPage(),
    title: "세 번째",
    body: "확정 문안",
    evidence: ["근거"],
  };
  p.locks["page:2"] = true;
  movePage(p, 2, 1);
  assert.equal(p.copy.pages[1].body, "확정 문안");
  assert.deepEqual(p.copy.pages[1].evidence, ["근거"]);
  assert.equal(p.locks["page:1"], true);
  assert.equal(p.locks["page:2"], undefined);
  resizePages(p, 1);
  resizePages(p, 3);
  assert.equal(p.locks["page:1"], undefined);
  assert.equal(projectSchema.safeParse(p).success, true);
});
test("transport omits length keywords while full scoped validation retains limits", () => {
  for (const scope of [
    "all",
    "headline",
    "kicker",
    "keywords",
    "caption",
    "alt",
    "pages",
    "page:0",
  ]) {
    const json = JSON.stringify(transportFormat(responseSchema(scope)).schema);
    assert.doesNotMatch(json, /minLength|maxLength/);
    assert.match(json, /additionalProperties/);
  }
  assert.throws(() =>
    responseSchema("headline").parse({
      headline: "x".repeat(201),
      highlight: "",
      headlineEvidence: ["x"],
    }),
  );
  assert.throws(() =>
    responseSchema("headline").parse({
      headline: "ok",
      highlight: "",
      headlineEvidence: [""],
    }),
  );
});
test("cache varies by all semantic request inputs, not profile or generated target", () => {
  const p = blank(),
    key = cacheKey(p, "all", "");
  for (const field of [
    "source",
    "sourceTitle",
    "sourceSubtitle",
    "publishedAt",
    "direction",
  ] as const)
    assert.notEqual(cacheKey({ ...p, [field]: "changed" }, "all", ""), key);
  assert.notEqual(cacheKey({ ...p, count: 2 }, "all", ""), key);
  assert.notEqual(cacheKey(p, "headline", ""), key);
  assert.notEqual(cacheKey(p, "all", "extra"), key);
  assert.notEqual(
    cacheKey({ ...p, locks: { headline: true } }, "all", ""),
    key,
  );
  assert.equal(
    cacheKey(
      { ...p, profile: "new", copy: { ...p.copy, headline: "generated" } },
      "all",
      "",
    ),
    key,
  );
  const locked = { ...p, locks: { headline: true } };
  assert.notEqual(
    cacheKey(
      { ...locked, copy: { ...p.copy, headline: "locked change" } },
      "all",
      "",
    ),
    cacheKey(locked, "all", ""),
  );
});
test("candidate linebreak preserves amount/currency and avoids orphan punctuation/particles", () => {
  const measure = (s: string) => s.length * 42;
  const lines = candidateLines(
    "8월 스위스 무역 흑자, 37억 9천만 스위스 프랑 기록",
    measure,
  );
  assert.ok(lines.length <= 3 && lines.length > 0);
  assert.ok(lines.some((l) => l.includes("37억 9천만")));
  assert.ok(lines.some((l) => l.includes("스위스 프랑")));
  assert.equal(
    lines.join(" "),
    "8월 스위스 무역 흑자, 37억 9천만 스위스 프랑 기록",
  );
  const other = candidateLines(
    "수출 증가 는 2조 5천억 원 기록 !",
    measure,
    550,
  );
  assert.ok(other.some((l) => l.includes("2조 5천억 원")));
  assert.ok(other.every((l) => !/^(는|!)$/.test(l)));
  assert.deepEqual(candidateLines("초장문".repeat(100), measure), []);
});
test("renderer rejects missing font independently of PUT", async () => {
  const p = blank();
  p.photo = "/uploads/test.jpg";
  p.copy.headline = "제목";
  p.copy.pages[0] = { ...emptyPage(), title: "본문", body: "문안" };
  delete (p as any).bodyFont;
  await assert.rejects(render(p), /54~60/);
});
