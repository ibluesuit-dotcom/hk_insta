import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blank,
  encodeHeadlineLines,
  headlineEditorText,
  headlineLayout,
  projectSchema,
  renderFresh,
} from "../shared/model";

test("recorded renderer lines display losslessly without changing literal source or legacy modes", () => {
  const p = blank();
  p.copy.headline = "[속보][단독] 美/中 2026/09/18 수출 6800";
  p.copy.headlineMode = "literal";
  p.coverLayout = {
    headline: p.copy.headline,
    mode: "literal",
    lines: ["[속보][단독] 美/中", "2026/09/18 수출 6800"],
  };
  const editor = headlineEditorText(p);
  assert.equal(editor, "[속보][단독] 美\\/中 / 2026\\/09\\/18 수출 6800");
  assert.deepEqual(headlineLayout(editor, "escaped"), {
    text: p.copy.headline,
    manual: p.coverLayout.lines.join("\n"),
    error: "",
  });
  assert.equal(headlineEditorText(projectSchema.parse(p)), editor);
  assert.equal(p.copy.headlineMode, "literal");
  assert.equal(headlineLayout("美/中", "literal").text, "美/中");
  assert.equal(headlineLayout("기존/제목").manual, "기존\n제목");
  assert.equal(headlineLayout("기존\\/제목", "manual").manual, "기존\\\n제목");
  assert.equal(
    headlineLayout(encodeHeadlineLines(["경로\\이름 / 구분", "끝"]), "escaped")
      .manual,
    "경로\\이름 / 구분\n끝",
  );
  p.copy.headline = "변경된 원제";
  assert.equal(
    headlineEditorText(p),
    "변경된 원제",
    "stale layout never overrides changed headline",
  );
});

test("full fresh renders are sufficient without approvals; stale, missing, partial renders are blocked", () => {
  const p = blank();
  p.revision = 2;
  p.renders = ["/renders/cover.png", "/renders/body.png"];
  p.renderRevision = 2;
  assert.equal(renderFresh(p), true);
  assert.equal(p.imageApproved, false);
  p.revision++;
  assert.equal(renderFresh(p), false);
  p.renderRevision = p.revision;
  p.renders.pop();
  assert.equal(renderFresh(p), false);
  p.renders.push("");
  assert.equal(renderFresh(p), false);
});

test("escaped delimiter overhead does not reduce the 200-character content limit", () => {
  const p = blank();
  p.copy.headlineMode = "escaped";
  const line = "가/".repeat(49) + "나";
  p.copy.headline = encodeHeadlineLines([line, "다".repeat(100)]);
  assert.equal(headlineLayout(p.copy.headline, "escaped").text.length, 200);
  assert.equal(projectSchema.safeParse(p).success, true);
  p.copy.headline += "라";
  assert.equal(projectSchema.safeParse(p).success, false);
});
