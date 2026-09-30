import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blank,
  cardAlt,
  cardKind,
  emptyPage,
  expandTextCopy,
  mergeCopy,
  projectSchema,
  blankTextPage,
  keepPages,
  photoStyleOf,
  removePage,
  textView,
  withStyle,
  type Page,
  type Project,
} from "../shared/model";
import { html, marked } from "../server/render";

const card = (photo = "/uploads/a.jpg") => ({
  photo,
  fit: "contain" as const,
  focal: { x: 50, y: 50, zoom: 1 },
  text: "",
  textVisible: false,
  credit: "",
  alt: "사진 설명",
});
const text = (title: string): Page => ({
  ...emptyPage(),
  title,
  body: title + " 본문",
  evidence: ["근거"],
});
function mixed(): Project {
  const p = blank();
  p.copy.pages = [
    text("하나"),
    { ...text("보관된 요약"), kind: "photo", photoCard: card() },
    text("셋"),
  ];
  p.count = 3;
  p.locks = { "page:2": true, headline: true };
  return p;
}

test("the AI text view holds only text cards with renumbered locks", () => {
  const { view, map } = textView(mixed());
  assert.deepEqual(map, [0, 2]);
  assert.equal(view.count, 2);
  assert.deepEqual(
    view.copy.pages.map((pg) => pg.title),
    ["하나", "셋"],
  );
  assert.deepEqual(view.locks, { "page:1": true, headline: true });
});

test("AI results go back to text cards; photo cards and stored text stay", () => {
  const p = mixed();
  const { view, map } = textView(p);
  const ai = structuredClone(view.copy);
  ai.pages = [text("새 하나"), text("새 셋")].map(
    ({ kind: _k, photoCard: _p, ...rest }) => rest,
  );
  const copy = expandTextCopy(p, mergeCopy(view, ai, "all"), map);
  assert.equal(copy.pages[0].title, "새 하나");
  assert.equal(copy.pages[2].title, "셋", "locked text card kept");
  assert.deepEqual(copy.pages[1], p.copy.pages[1]);
});

test("a text card keeps its stored photo when AI rewrites it", () => {
  const p = blank();
  p.copy.pages = [{ ...text("원래"), kind: "text", photoCard: card() }];
  const next = structuredClone(p.copy);
  next.pages = [{ ...emptyPage(), title: "새 제목" }];
  const merged = mergeCopy(p, next, "all");
  assert.equal(merged.pages[0].title, "새 제목");
  assert.deepEqual(merged.pages[0].photoCard, card());
  assert.equal(merged.pages[0].kind, "text");
});

test("the schema requires a photo, caps photo cards and refuses AI files", () => {
  const p = mixed();
  assert.doesNotThrow(() => projectSchema.parse(p));
  const noPhoto = mixed();
  noPhoto.copy.pages[1].photoCard!.photo = "";
  assert.throws(() => projectSchema.parse(noPhoto));
  const ai = mixed();
  ai.copy.pages[1].photoCard!.photo =
    "/uploads/ai-00000000-0000-4000-8000-000000000000.jpg";
  assert.throws(() => projectSchema.parse(ai));
  const many = blank();
  many.copy.pages = Array.from({ length: 4 }, () => ({
    ...text("사진"),
    kind: "photo" as const,
    photoCard: card(),
  }));
  many.count = 4;
  assert.throws(() => projectSchema.parse(many), /최대 3장/);
  many.copy.pages[3].kind = "text";
  assert.doesNotThrow(() => projectSchema.parse(many));
});

test("removing a card shifts later locks and keeps earlier ones", () => {
  const p = mixed();
  p.locks = { "page:0": true, "page:1": true, "page:2": true };
  removePage(p, 1);
  assert.equal(p.count, 2);
  assert.deepEqual(
    p.copy.pages.map((pg) => pg.title),
    ["하나", "셋"],
  );
  assert.deepEqual(p.locks, { "page:0": true, "page:1": true });
});

test("output kind and alt follow the active card kind", () => {
  const p = mixed();
  p.copy.alt = "표지 설명";
  p.copy.pages[0].alt = "본문 설명";
  p.copy.pages[1].alt = "보관된 본문 설명";
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => cardKind(p, i)),
    ["cover", "body", "photo", "body"],
  );
  assert.equal(cardAlt(p, 0), "표지 설명");
  assert.equal(cardAlt(p, 1), "본문 설명");
  assert.equal(cardAlt(p, 2), "사진 설명");
});

test("a photo card renders the photo only; text cards number among text cards", () => {
  const p = mixed();
  p.copy.pages[1].photoCard = {
    ...card(),
    fit: "cover",
    text: "사진 <문구>",
    textVisible: true,
    credit: "연합뉴스",
  };
  const photo = html(p, 2, "", "data:image/jpeg;base64,xx");
  assert.match(photo, /object-fit:cover/);
  assert.match(photo, /사진 &lt;문구&gt;/);
  assert.match(photo, /연합뉴스/);
  assert.doesNotMatch(photo, /NEWS BRIEF|보관된 요약/);
  p.copy.pages[1].photoCard!.textVisible = false;
  assert.doesNotMatch(html(p, 2, "", "x"), /사진 &lt;문구/);
  assert.match(html(p, 3, "", "x"), /본문 2\/2/);
});

test("only an untouched, unlocked text card counts as blank; kept cards keep their locks", () => {
  assert.equal(blankTextPage(emptyPage()), true);
  assert.equal(blankTextPage({ ...emptyPage(), role: "배경" }), false);
  assert.equal(blankTextPage({ ...emptyPage(), alt: "설명" }), false);
  assert.equal(blankTextPage(emptyPage(), true), false);
  const p = mixed();
  p.locks = { "page:0": true, "page:2": true, kicker: true };
  keepPages(p, [2]);
  assert.equal(p.count, 1);
  assert.deepEqual(p.locks, { "page:0": true, kicker: true });
  keepPages(p, []);
  assert.deepEqual(p.locks, { kicker: true });
});

test("frame card: marks, the 1g layout, style switches keep what was written", () => {
  assert.equal(
    marked("코스피 9천 <달성>", [["9천", "fr-red"]]),
    '코스피 <span class="fr-red">9천</span> &lt;달성&gt;',
  );
  // An overlapping second mark is skipped rather than nesting.
  assert.equal(
    marked("가나다라", [
      ["나다", "a"],
      ["다라", "b"],
    ]),
    '가<span class="a">나다</span>라',
  );
  const p = mixed();
  p.copy.pages[1].photoCard = {
    ...card(),
    credit: "사진 연합뉴스",
    layout: "frame",
    title: "코스피 9천 달성",
    titleHighlight: "9천",
    summary:
      "코스피가 무려 6개월만에\n9천선을 다시 돌파하여\n사상최고가를 기록",
    summaryHighlight: "9천선을 다시 돌파",
    summaryUnderline: "사상최고가를 기록",
  };
  const out = html(p, 2, "", "data:image/jpeg;base64,xx");
  assert.match(
    out,
    /class="fr-title">코스피 <span class="fr-red">9천<\/span> 달성/,
  );
  assert.equal(out.match(/class="fr-line"/g)?.length, 3);
  assert.match(out, /<span class="fr-under">사상최고가를 기록<\/span>/);
  assert.match(out, /class="fr-credit">사진 연합뉴스/);
  assert.doesNotMatch(out.split("<body>")[1], /pc-text|NEWS BRIEF/);

  const framed = p.copy.pages[1].photoCard!;
  const back = withStyle(framed, "caption");
  assert.equal(photoStyleOf(back), "caption");
  assert.equal(back.title, "코스피 9천 달성");
  assert.equal(photoStyleOf(withStyle(back, "frame")), "frame");
  assert.equal(photoStyleOf(withStyle(back, "image")), "image");

  const four = mixed();
  four.copy.pages[1].photoCard = { ...framed, summary: "1\n2\n3\n4" };
  assert.throws(() => projectSchema.parse(four));
});
