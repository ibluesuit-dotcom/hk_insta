import { test } from "node:test";
import assert from "node:assert/strict";
import { blank, mergeCopy } from "../shared/model";
import { sourceHash } from "../shared/ai-background";
import {
  exportCaption,
  measure,
  mergePostText,
  reviewState,
  textHash,
  type PostReview,
} from "../shared/post-text";
import {
  bulletsText,
  checkGeneration,
  segments,
  toReview,
  type Generation,
} from "../server/summary";

const source = "수출이 10% 늘었다. 정부는 내년에도 증가할 것으로 본다.";
function project() {
  const p = blank();
  p.source = source;
  p.copy.caption = "짧은 캡션";
  return p;
}
const review = (text: string, overall: PostReview["overall"] = "pass") => ({
  overall,
  textHash: textHash(text),
  sourceHash: sourceHash(project()),
  checkedAt: "t",
  issues: [],
  missing: [],
});

test("export caption follows the selected format; short stays in copy.caption", () => {
  const p = project();
  assert.equal(exportCaption(p), "짧은 캡션");
  p.postText = {
    selected: "summary",
    summary: { text: "요약", provenance: "manual", sourceHash: null },
  };
  assert.equal(exportCaption(p), "요약");
});

test("the server keeps review and provenance; a changed text drops its review", () => {
  const old = project();
  old.postText = {
    selected: "summary",
    summary: {
      text: "요약",
      provenance: "generated",
      sourceHash: sourceHash(old),
      review: review("요약"),
    },
    shortReview: review("짧은 캡션"),
  };
  // A forged client review and provenance are ignored.
  const input = structuredClone(old);
  input.postText!.summary!.review = review("요약", "pass");
  input.postText!.summary!.provenance = "source_copy";
  let merged = mergePostText(old, input)!;
  assert.equal(merged.summary!.provenance, "generated");
  assert.deepEqual(merged.summary!.review, old.postText.summary!.review);
  assert.ok(merged.shortReview);

  input.postText!.summary!.text = "고친 요약";
  input.copy.caption = "고친 캡션";
  merged = mergePostText(old, input)!;
  assert.equal(merged.summary!.provenance, "manual");
  assert.equal(merged.summary!.review, undefined);
  assert.equal(merged.shortReview, undefined);
});

test("full text equal to the source is a source copy; an empty format cannot be exported", () => {
  const old = project();
  const input = structuredClone(old);
  input.postText = {
    selected: "full",
    full: { text: source, provenance: "manual", sourceHash: null },
  };
  const merged = mergePostText(old, input)!;
  assert.equal(merged.full!.provenance, "source_copy");
  assert.equal(merged.full!.sourceHash, sourceHash(old));
  input.postText.full!.text = "";
  assert.equal(mergePostText(old, input)!.selected, "short");
});

test("a review counts only for its exact text and source", () => {
  const p = project();
  p.postText = { selected: "short", shortReview: review("짧은 캡션") };
  assert.equal(reviewState(p, "short"), "pass");
  p.copy.caption = "다른 캡션";
  assert.equal(reviewState(p, "short"), "unchecked");
  p.copy.caption = "짧은 캡션";
  p.source += " 추가 문장.";
  assert.equal(reviewState(p, "short"), "stale_source");
});

test("generation format and every quote are checked against the segments", () => {
  const segs = segments(source);
  assert.deepEqual(
    segs.map((s) => s.id),
    ["s1", "s2"],
  );
  const base: Generation = {
    status: "draft",
    claims: [
      {
        claimText: "수출 증가",
        evidence: [{ segmentId: "s1", quote: "수출이 10% 늘었다" }],
        attribution: null,
        kind: "fact",
        qualifiers: [],
      },
    ],
    omittedCoreFacts: [],
    warnings: [],
    lengthExceptionReason: null,
    text: "수출이 10% 늘었다.",
    sections: [],
  };
  assert.doesNotThrow(() => checkGeneration("summary", base, segs));
  assert.throws(() => checkGeneration("bullets", base, segs), /형식/);
  const wrongSegment = structuredClone(base);
  wrongSegment.claims[0].evidence[0].segmentId = "s2";
  assert.throws(() => checkGeneration("summary", wrongSegment, segs), /근거/);
  const bullets = {
    ...base,
    text: "",
    sections: [{ heading: "수출", body: "10% 증가" }],
  };
  assert.doesNotThrow(() => checkGeneration("bullets", bullets, segs));
  assert.equal(bulletsText(bullets.sections), "• 수출\n10% 증가");
});

test("a contradiction always fails; a serious unsupported claim needs review", () => {
  const v = (verdict: any, severity: any) => ({
    overall: "pass" as const,
    claimChecks: [{ claim: "c", evidence: [], verdict, severity, issue: null }],
    missingCoreFacts: [],
    formatCheck: "",
    suggestedMinimalFixes: [],
  });
  assert.equal(
    toReview(v("contradicted", "low"), "t", project()).overall,
    "fail",
  );
  assert.equal(
    toReview(v("unsupported", "high"), "t", project()).overall,
    "needs_review",
  );
  assert.equal(toReview(v("ambiguous", "low"), "t", project()).overall, "pass");
});

test("card generation fills only an empty caption", () => {
  const p = project();
  const next = structuredClone(p.copy);
  next.caption = "AI 캡션";
  assert.equal(mergeCopy(p, next, "all").caption, "짧은 캡션");
  p.copy.caption = "";
  assert.equal(mergeCopy(p, next, "all").caption, "AI 캡션");
});

test("lengths are counted as NFC code points with LF breaks", () => {
  assert.equal(measure("가\r\n나"), 3);
  assert.equal(measure("é"), 1);
});
