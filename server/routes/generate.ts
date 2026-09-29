import express from "express";
import { z } from "zod";
import { sourceHeadline } from "../../shared/source-title";
import {
  expandTextCopy,
  isPhotoPage,
  mergeCopy,
  textView,
} from "../../shared/model";
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
    // Only active text cards are written by AI. Photo cards (and the text
    // kept behind them) are refused up front or left out of the request.
    const { view, map } = textView(p);
    let viewScope = scope;
    if (scope.startsWith("page:")) {
      const page = p.copy.pages[Number(scope.slice(5))];
      if (!page || isPhotoPage(page))
        throw new Error("사진 카드는 AI로 작성하지 않습니다.");
      viewScope = "page:" + map.indexOf(Number(scope.slice(5)));
    }
    if (scope === "pages" && !map.length)
      throw new Error("AI로 작성할 텍스트 카드가 없습니다.");
    let result;
    try {
      result = await generate(
        view,
        viewScope,
        String(req.body.extra || "").slice(0, 2000),
      );
    } catch (e) {
      // AI_QUOTA 처럼 이미 구분된 코드는 유지하고, 나머지만 일반 AI 오류로 묶는다.
      const err = e as Error & { code?: string };
      throw Object.assign(err, {
        code: err.code?.startsWith("AI_") ? err.code : "AI",
      });
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
        const copy = expandTextCopy(
          p,
          mergeCopy(view, result.copy, viewScope),
          map,
        );
        if (scope !== "all" && scope !== "keywords") return { ...p, copy };
        return save(
          {
            ...p,
            copy,
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
