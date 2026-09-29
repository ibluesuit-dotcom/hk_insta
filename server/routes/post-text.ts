import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { read, save, mutate } from "../store";
import { wrap } from "../http";
import { carryRenderFreshness } from "../../shared/model";
import {
  articleHash,
  measure,
  postOptionsSchema,
  postTextOf,
  type PostText,
} from "../../shared/post-text";
import {
  assertSummarizable,
  generatePost,
  loadCandidate,
  modelName,
  saveCandidate,
  verifyPost,
  type Candidate,
} from "../summary";

// Instagram post texts: a generated candidate is stored server-side and only
// reaches the project through an explicit apply. Generation never overwrites
// what the editor wrote.
export const postTextRouter = express.Router();
const conflict = (message: string, code = "CONFLICT") =>
  Object.assign(new Error(message), { status: 409, code });

postTextRouter.post(
  "/api/projects/:id/post-text/candidates",
  wrap(async (req, res) => {
    const p = (await read(req.params.id)).current;
    if (p.revision !== req.body.revision)
      throw conflict("저장 후 다시 생성하세요.");
    const format = z
      .enum(["short", "summary", "bullets"])
      .parse(req.body.format);
    const options = postOptionsSchema.parse(req.body.options ?? {});
    assertSummarizable(p);
    let generated;
    try {
      generated = await generatePost(p, format, options);
    } catch (e) {
      const err = e as Error & { code?: string };
      throw Object.assign(err, {
        code: err.code?.startsWith("AI_") ? err.code : err.code || "AI",
      });
    }
    // The separate source check runs on the finished text. If it fails to
    // run, the candidate is kept and can be checked again on its own.
    let review = null;
    let reviewError: string | null = null;
    try {
      review = await verifyPost(p, format, generated.text);
    } catch (e) {
      reviewError = (e as Error).message;
    }
    const candidate: Candidate = {
      id: randomUUID(),
      projectId: p.id,
      format,
      baseRevision: p.revision,
      sourceHash: articleHash(p),
      baseText: postTextOf(p, format),
      options,
      text: generated.text,
      warnings: generated.out.warnings,
      omitted: generated.out.omittedCoreFacts.map(
        (o) => `${o.fact} — ${o.reason}`,
      ),
      lengthExceptionReason: generated.out.lengthExceptionReason,
      review,
      reviewError,
      ratio: measure(generated.text) / Math.max(1, measure(p.source)),
      model: modelName(),
      createdAt: Date.now(),
    };
    await saveCandidate(candidate);
    res.json(candidate);
  }),
);

postTextRouter.post(
  "/api/projects/:id/post-text/apply",
  wrap(async (req, res) =>
    res.json(
      await mutate(async () => {
        const c = await loadCandidate(z.string().parse(req.body.candidateId));
        const p = (await read(req.params.id)).current;
        // A candidate belongs to the project it was made for; a duplicate of
        // the same article has the same source hash but is another project.
        if (c.projectId !== p.id)
          throw conflict("다른 작업의 게시글 후보입니다.", "STALE");
        if (p.revision !== req.body.revision)
          throw conflict("저장 후 다시 적용하세요.");
        if (c.sourceHash !== articleHash(p))
          throw conflict(
            "기사 제목·시점·원문이 바뀌어 이 후보를 적용하지 않았습니다. 현재 기사로 다시 생성하세요.",
            "STALE",
          );
        // The editor changed this format after the candidate was made: the
        // newer text is replaced only when the editor confirms it.
        if (
          postTextOf(p, c.format) !== c.baseText &&
          req.body.replaceEdited !== true
        )
          throw conflict(
            "후보를 만든 뒤 글이 수정되었습니다. 수정한 글을 이 후보로 바꿀지 확인하세요.",
            "EDITED",
          );
        if (c.format === "short" && p.locks.caption)
          throw conflict("짧은 캡션이 잠겨 있습니다. 잠금을 푼 뒤 적용하세요.");
        const review = c.review as PostText["shortReview"] | null;
        if (review?.overall === "fail" && req.body.acceptFailed !== true)
          throw conflict(
            "원문 대조에 실패한 후보입니다. 확인 후 ‘검토 필요로 적용’을 선택하세요.",
            "REVIEW",
          );
        // An adopted failed candidate stays marked for review, never passed.
        const kept =
          review && review.overall === "fail"
            ? { ...review, overall: "needs_review" as const }
            : (review ?? undefined);
        const postText: PostText = {
          selected: p.postText?.selected ?? "short",
          ...p.postText,
        };
        if (c.format === "short") {
          p.copy.caption = c.text;
          if (kept) postText.shortReview = kept;
          else delete postText.shortReview;
        } else
          postText[c.format] = {
            text: c.text,
            provenance: "generated",
            options: postOptionsSchema.parse(c.options),
            sourceHash: c.sourceHash,
            ...(kept ? { review: kept } : {}),
          };
        return save(
          { ...p, postText, ...carryRenderFreshness(p) },
          p.revision,
          "게시글 " + c.format,
        );
      }),
    ),
  ),
);

// Checks a candidate again (e.g. after its check timed out), never the text.
postTextRouter.post(
  "/api/projects/:id/post-text/candidates/:candidateId/verify",
  wrap(async (req, res) => {
    const c = await loadCandidate(req.params.candidateId);
    const p = (await read(req.params.id)).current;
    if (c.projectId !== p.id)
      throw conflict("다른 작업의 게시글 후보입니다.", "STALE");
    if (c.sourceHash !== articleHash(p))
      throw conflict(
        "기사 제목·시점·원문이 바뀌었습니다. 현재 기사로 다시 생성하세요.",
        "STALE",
      );
    assertSummarizable(p);
    const next = {
      ...c,
      review: await verifyPost(p, c.format, c.text),
      reviewError: null,
    };
    await saveCandidate(next);
    res.json(next);
  }),
);

// "검증만 다시": check the saved text of one format again, without generating.
postTextRouter.post(
  "/api/projects/:id/post-text/verify",
  wrap(async (req, res) => {
    const p = (await read(req.params.id)).current;
    if (p.revision !== req.body.revision)
      throw conflict("저장 후 다시 확인하세요.");
    const format = z
      .enum(["short", "full", "summary", "bullets"])
      .parse(req.body.format);
    const text = postTextOf(p, format);
    if (!text.trim()) throw new Error("확인할 게시글이 없습니다.");
    assertSummarizable(p);
    const review = await verifyPost(p, format, text);
    res.json(
      await mutate(async () => {
        const current = (await read(p.id)).current;
        if (current.revision !== p.revision)
          throw conflict(
            "확인 중 변경이 있어 결과를 적용하지 않았습니다. 다시 확인하세요.",
            "STALE",
          );
        const postText: PostText = {
          selected: current.postText?.selected ?? "short",
          ...current.postText,
        };
        if (format === "short") postText.shortReview = review;
        else postText[format] = { ...postText[format]!, review };
        return save(
          { ...current, postText, ...carryRenderFreshness(current) },
          current.revision,
          "원문 대조",
        );
      }),
    );
  }),
);
