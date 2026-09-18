import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blank,
  migrateCover,
  headlineLayout,
  projectSchema,
  profileOnlyChange,
} from "../shared/model";
import { groundedKeywords } from "../server/ai";
import { html } from "../server/render";

test("legacy defaults and matching breaks migrate; stale breaks cannot override edited headline", () => {
  const p = blank();
  delete p.kickerHidden;
  delete p.coverRenderRevision;
  p.copy.headline = "수출 증가 의미";
  p.headlineBreaks = "수출 증가\n의미";
  assert.equal(migrateCover(p).copy.headline, "수출 증가 / 의미");
  assert.equal(p.kickerHidden, false);
  assert.equal(p.headlineBreaks, "");
  p.copy.headline = "새 제목";
  p.headlineBreaks = "수출 증가\n의미";
  assert.equal(migrateCover(p).copy.headline, "새 제목");
  assert.equal(p.headlineBreaks, "");
  assert.equal(projectSchema.parse(p).kickerHidden, false);
  assert.equal(profileOnlyChange(p, { ...p, kickerHidden: true }), false);
});
test("slash layout strips delimiters and rejects empty or more than three lines", () => {
  assert.deepEqual(headlineLayout("수출 / 금리 / 원화"), {
    text: "수출 금리 원화",
    manual: "수출\n금리\n원화",
    error: "",
  });
  for (const text of ["수출/", "/수출", "수출//금리", "1/2/3/4"])
    assert.ok(headlineLayout(text).error);
  assert.equal(headlineLayout("자동 조판").manual, "");
});
test("42px kicker is omitted only when hidden and text is retained", () => {
  const p = blank();
  p.copy.kicker = "보존할 부제";
  assert.match(html(p, 0, "", ""), /font-size:42px/);
  assert.match(html(p, 0, "", ""), /<span class="kicker">보존할 부제/);
  p.kickerHidden = true;
  assert.doesNotMatch(html(p, 0, "", ""), /<span class="kicker">/);
  assert.equal(p.copy.kicker, "보존할 부제");
});
test("recommendations accept only unique grounded words, never pad insufficient source", () => {
  const source = "수출 금리 원화 한국은행 반도체";
  const words = [
    "수출",
    "금리",
    "원화",
    "한국은행",
    "반도체",
    "수출",
    "수출 금리",
    "경제",
    "금리!",
  ];
  const result = groundedKeywords(
    words.map((query) => ({
      query,
      english: null,
      type: "archive",
      reason: "",
      quote: source,
    })),
    source,
  );
  assert.deepEqual(
    result.map((k) => k.query),
    words.slice(0, 4),
  );
  assert.equal(
    groundedKeywords(
      [
        {
          query: "경제",
          english: null,
          type: "archive",
          reason: "",
          quote: source,
        },
      ],
      source,
    ).length,
    0,
  );
});
