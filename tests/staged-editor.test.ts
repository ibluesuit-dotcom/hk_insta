import { test } from "node:test";
import assert from "node:assert/strict";
import { blank } from "../shared/model";
import { applyDrafts, draftItem, reorderDrafts } from "../shared/editor-drafts";
test("item patches exclude other visible drafts and reorder by page", () => {
  const p = blank();
  p.copy.headline = "saved";
  const visible = structuredClone(p);
  visible.copy.headline = "new";
  visible.copy.kicker = "draft subtitle";
  const committed = applyDrafts(p, {
    headline: draftItem(visible, "headline"),
  });
  assert.equal(committed.copy.headline, "new");
  assert.equal(committed.copy.kicker, "");
  assert.equal(p.copy.headline, "saved");
  visible.copy.pages[0].title = "draft title";
  const moved = reorderDrafts(
    { "page:0:title": draftItem(visible, "page:0:title") },
    0,
    1,
  );
  assert.deepEqual(moved, {
    "page:1:title": { "copy.pages.1.title": "draft title" },
  });
});

test("batch patches preserve saved project while including every field and page", () => {
  const p = blank();
  const candidate = structuredClone(p);
  candidate.copy.headline = "새 / 제목";
  candidate.copy.headlineMode = "escaped";
  candidate.copy.kicker = "새 부제";
  candidate.copy.caption = "새 캡션";
  candidate.copy.alt = "표지 설명";
  candidate.copy.pages[0].title = "본문 제목";
  candidate.copy.pages[0].body = "새 본문";
  candidate.bodyFont = 54;
  candidate.kickerHidden = true;
  const keys = [
    "headline",
    "kicker",
    "caption",
    "alt",
    "page:0:title",
    "page:0:body",
    "bodyFont",
  ];
  const patches = Object.fromEntries(
    keys.map((key) => [key, draftItem(candidate, key)]),
  );
  assert.deepEqual(applyDrafts(p, patches), candidate);
  assert.equal(p.copy.headline, "");
  assert.equal(p.copy.pages[0].body, "");
});
