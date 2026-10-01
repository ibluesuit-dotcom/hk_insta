import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { blank, mergeCopy, validateEvidence } from "../shared/model";
import {
  normalizeSourceTitle as normalize,
  sourceHeadline,
} from "../shared/source-title";

const example =
  '"금리 인상은 문제도 아니다"…코스피, 외국인·기관 매수에 6800선 안착 [fn오전시황]';
const expected =
  "“금리 인상은 문제도 아니다” 코스피, 외국인·기관 매수에 6800선 안착";

test("every [ ] goes with its contents except [단독] [속보]; ( ) stays", () => {
  assert.equal(normalize(example), expected);
  assert.equal(
    normalize("[특징주][속보][fn오전시황] 6800선 [마감시황][단독][특징주]"),
    "[속보] 6800선 [단독]",
  );
  assert.equal(
    normalize("[단독][특징주][속보] 제목 [단독][마감시황][속보]"),
    "[단독][속보] 제목 [단독][속보]",
  );
  assert.equal(
    normalize("[마켓무버의 국장 힌트] 코스피 6800선 [잠정치]"),
    "코스피 6800선",
  );
  assert.equal(normalize("[2026년 9월] 수출 12.5% 증가"), "수출 12.5% 증가");
  assert.equal(normalize("[새 코너] 제목 [임의 분류]"), "제목");
  assert.equal(normalize("[특징주][팩트][특징주] 내용"), "내용");
  // Inside the headline too, nested ones included; round brackets stay.
  assert.equal(normalize("수출 [특징주] 6800선"), "수출 6800선");
  assert.equal(normalize("[사진]코스피 [중첩 [x]] 반등"), "코스피 반등");
  assert.equal(
    normalize("(종합) 삼성전자(005930) 3분기 [단독] 실적 (2보)"),
    "(종합) 삼성전자(005930) 3분기 [단독] 실적 (2보)",
  );
  assert.equal(
    normalize('[사진] "금리 인상은 (사실상) 문제 아냐"…코스피'),
    "“금리 인상은 (사실상) 문제 아냐” 코스피",
  );
});
test("typography preserves omissions, apostrophes, digits, words and terminal ellipses", () => {
  assert.equal(
    normalize('  "금리…  3.25%"...코스피 6800선  '),
    "“금리… 3.25%” 코스피 6800선",
  );
  assert.equal(
    normalize("'금리 인상'…코스피 2.5%p"),
    "‘금리 인상’ 코스피 2.5%p",
  );
  for (const title of [
    "“인상…아니다” 코스피",
    "“금리”…",
    "Samsung's exports",
    "3.25%…6,800선",
    '한쪽 "인용',
    "“생략…” 코스피",
  ])
    assert.equal(normalize(title), title);
});
test("preflight never truncates and evidence refers to the intact original title", () => {
  for (const title of ["", "  ", "[특징주][fn오전시황]", "가".repeat(201)])
    assert.throws(() => sourceHeadline(title), /원문 제목/);
  assert.equal(sourceHeadline("가".repeat(200)).headline.length, 200);
  assert.deepEqual(sourceHeadline(example).headlineEvidence, [example]);
  const p = blank();
  Object.assign(p.copy, sourceHeadline(example));
  validateEvidence(p.copy, "본문", example);
  p.copy.pages[0].evidence = [example];
  assert.throws(() => validateEvidence(p.copy, "본문", example), /근거/);
});
test("full response/cache enforcement, no-AI title candidate, preflight and locks", async () => {
  // Dynamic import keeps all cache writes out of the user's data directory.
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "source-title-unit-"),
  );
  process.env.DATA_DIR = directory;
  process.env.MOCK_AI = "1";
  const {
    generate,
    applyValidated,
    responseSchema,
    transportFormat,
    cacheKey,
  } = await import("../server/ai");
  try {
    const p = blank();
    p.source =
      "한국은행은 금리와 원화 동향을 설명했다. 수출과 반도체 지표를 확인했다.";
    p.sourceTitle = example;
    const original = structuredClone(p);
    const first = await generate(p, "all", "");
    assert.equal(first.copy.headline, expected);
    assert.equal(first.cached, false);
    assert.deepEqual(p, original);
    validateEvidence(first.copy, p.source, p.sourceTitle);
    const schema = transportFormat(responseSchema("all")).schema as any;
    for (const key of ["headline", "highlight", "headlineEvidence"])
      assert.equal(schema.properties[key], undefined);
    const cacheFile = path.join(
      directory,
      "cache",
      cacheKey(p, "all", "") + ".json",
    );
    const entry = JSON.parse(await fs.readFile(cacheFile, "utf8"));
    entry.output.headline = "AI 오염 제목";
    entry.output.headlineEvidence = ["허위 근거"];
    await fs.writeFile(cacheFile, JSON.stringify(entry));
    const cached = await generate(p, "all", "");
    assert.equal(cached.cached, true);
    assert.equal(cached.copy.headline, expected);
    const bad = structuredClone(first.copy);
    bad.pages[0].evidence = [p.sourceTitle];
    assert.throws(() => applyValidated(p, "all", bad), /근거/);
    // Live mode without using credentials/API: headline returns before either is read.
    process.env.MOCK_AI = "0";
    const candidate = await generate(p, "headline", "rewrite");
    assert.equal(candidate.copy.headline, expected);
    assert.equal(candidate.usage, null);
    assert.match(candidate.model, /AI 미사용/);
    const slashCandidate = await generate(
      { ...p, sourceTitle: "2026/09/18 美/中 1/4분기" },
      "headline",
      "",
    );
    assert.equal(slashCandidate.copy.headline, "2026/09/18 美/中 1/4분기");
    assert.equal(slashCandidate.copy.headlineMode, "literal");
    p.copy.headline = "수동 잠금 제목 / 유지";
    p.locks.headline = true;
    for (const scope of ["all", "headline"])
      assert.equal(
        mergeCopy(p, candidate.copy, scope).headline,
        p.copy.headline,
      );
    for (const scope of ["all", "headline"])
      await assert.rejects(
        generate({ ...p, sourceTitle: "[특징주]" }, scope, ""),
        /원문 제목/,
      );

    process.env.MOCK_AI = "1";
    const untitled = { ...blank(), source: p.source, sourceTitle: "" };
    for (const scope of ["all", "headline"]) {
      const generated = await generate(untitled, scope, "");
      assert.equal(generated.copy.headline, "경제 뉴스, 변화의 의미");
      assert.equal(generated.copy.headlineMode, "manual");
      validateEvidence(generated.copy, untitled.source);
      assert.equal((await generate(untitled, scope, "")).cached, true);
    }
    assert.ok(
      (transportFormat(responseSchema("all", false)).schema as any).properties
        .headline,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("literal source slashes, legacy manual breaks, migration and staged metadata isolation", async () => {
  const { headlineLayout, migrateCover, projectSchema } =
    await import("../shared/model");
  const { draftItem, applyDrafts } = await import("../shared/editor-drafts");
  for (const title of [
    "2026/09/18 코스피 6800선 안착",
    "美/中 갈등/환율/수출 1/4분기",
  ]) {
    const p = blank();
    Object.assign(p.copy, sourceHeadline(title));
    const layout = headlineLayout(p.copy.headline, p.copy.headlineMode);
    assert.deepEqual(layout, { text: title, manual: "", error: "" });
    const reloaded = projectSchema.parse(JSON.parse(JSON.stringify(p)));
    assert.equal(reloaded.copy.headlineMode, "literal");
    p.headlineBreaks = title.replaceAll("/", "\n");
    assert.equal(migrateCover(p).copy.headline, title);
    assert.equal(
      applyDrafts(p, { headline: { "copy.headline": "수동 / 제목" } }).copy
        .headlineMode,
      "manual",
    );
    const old = blank();
    old.copy.headline = "수동 / 제목";
    const candidate = { ...old, copy: mergeCopy(old, p.copy, "headline") };
    const patch = JSON.parse(JSON.stringify(draftItem(candidate, "headline")));
    assert.equal(
      applyDrafts(old, { headline: patch }).copy.headlineMode,
      "literal",
    );
    assert.equal(
      applyDrafts(old, { kicker: patch }).copy.headlineMode,
      undefined,
    );
    for (const scope of ["all", "headline"]) {
      old.locks.headline = true;
      assert.equal(mergeCopy(old, p.copy, scope).headlineMode, undefined);
      p.locks.headline = true;
      assert.equal(mergeCopy(p, old.copy, scope).headlineMode, "literal");
    }
  }
  assert.deepEqual(headlineLayout("수동 / 제목"), {
    text: "수동 제목",
    manual: "수동\n제목",
    error: "",
  });
  const legacy = blank();
  legacy.copy.headline = "수동 제목";
  legacy.headlineBreaks = "수동\n제목";
  assert.equal(migrateCover(legacy).copy.headline, "수동 / 제목");
});
