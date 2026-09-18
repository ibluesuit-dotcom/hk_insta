import express from "express";
import { z } from "zod";
import { sourceHeadline } from "../../shared/source-title";
import { mergeCopy } from "../../shared/model";
import { read, save, mutate } from "../store";
import { generate } from "../ai";
import { wrap } from "../http";

// AI copy generation, applied only if the project did not change meanwhile.
export const generateRouter = express.Router();
generateRouter.post(
  "/api/projects/:id/generate",
  wrap(async (req, res) => {
    const p = (await read(req.params.id)).current;
    if (p.revision !== req.body.revision)
      throw Object.assign(new Error("저장 후 다시 생성하세요."), {
        status: 409,
        code: "CONFLICT",
      });
    const scope = z
      .string()
      .regex(/^(all|headline|kicker|keywords|caption|alt|pages|page:[0-7])$/)
      .parse(req.body.scope);
    if ((scope === "all" || scope === "headline") && p.sourceTitle.trim())
      sourceHeadline(p.sourceTitle);
    if (
      !(scope === "headline" && p.sourceTitle.trim()) &&
      (scope === "keywords" ? !p.source.trim() : p.source.trim().length < 30)
    )
      throw Object.assign(
        new Error(
          scope === "keywords"
            ? "기사나 파일 원문을 불러오거나 붙여넣어 주세요."
            : "원문을 30자 이상 입력하세요.",
        ),
        { code: "EXTRACTION" },
      );
    if (scope === "all" && !p.photo)
      throw Object.assign(new Error("생성 전에 표지 사진을 첨부하세요."), {
        code: "IMAGE",
      });
    let result;
    try {
      result = await generate(
        p,
        scope,
        String(req.body.extra || "").slice(0, 2000),
      );
    } catch (e) {
      throw Object.assign(e as Error, { code: "AI" });
    }
    res.json(
      await mutate(async () => {
        const current = (await read(p.id)).current;
        if (current.revision !== p.revision)
          throw Object.assign(
            new Error(
              "생성 중 변경이 있어 이전 AI 결과를 적용하지 않았습니다. 다시 적용하세요.",
            ),
            { status: 409, code: "STALE" },
          );
        if (scope !== "all" && scope !== "keywords")
          return { ...p, copy: mergeCopy(p, result.copy, scope) };
        return save(
          {
            ...p,
            copy: mergeCopy(p, result.copy, scope),
            headlineBreaks: "",
            appliedDirection:
              scope === "all" ? p.direction : p.appliedDirection,
            status: "generated",
            copyApproved: false,
            imageApproved: false,
            generation: {
              model: result.model,
              cached: result.cached,
              usage: result.usage,
              at: new Date().toISOString(),
              scope,
              extra: String(req.body.extra || "").slice(0, 2000),
            },
          },
          p.revision,
          "AI " + scope,
        );
      }),
    );
  }),
);
