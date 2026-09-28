import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  aiVariantSchema,
  backgroundFromSidecar,
  sourceHash,
} from "../../shared/ai-background";
import { read, save, mutate } from "../store";
import { wrap } from "../http";
import {
  assetUsableBy,
  briefIdSchema,
  candidate,
  deadline,
  ensureBrief,
  foreignAsset,
  generateBackground,
  loadBrief,
  loadSidecar,
  recentCandidates,
} from "../ai-background";

// AI cover backgrounds: brief → two candidates → explicit apply.
export const aiBackgroundGenerate = () =>
  process.env.AI_BACKGROUND_GENERATE === "1";
// The switch stops new paid calls only; apply, recent and rendering stay on.
function requireGenerate() {
  if (!aiBackgroundGenerate())
    throw Object.assign(new Error("AI 배경 생성 기능이 꺼져 있습니다."), {
      code: "AI_DISABLED",
      status: 403,
    });
}

export const aiBackgroundRouter = express.Router();
aiBackgroundRouter.post(
  "/api/projects/:id/ai-background/brief",
  wrap(async (req, res) => {
    const d = deadline();
    requireGenerate();
    const p = (await read(req.params.id)).current;
    const hash = sourceHash(p);
    if (req.body?.expectedSourceHash !== hash)
      throw Object.assign(
        new Error(
          "기사 원문이 저장된 내용과 다릅니다. 저장 후 다시 시도하세요.",
        ),
        { code: "SOURCE_CHANGED", status: 409, sourceHash: hash },
      );
    const record = await ensureBrief(p, d);
    res.json({
      briefId: record.briefId,
      sourceHash: record.sourceHash,
      status: record.brief.status,
      reviewReason: record.brief.review_reason,
      photoSubject: record.brief.photo.subject,
      artSubject: record.brief.art.subject,
    });
  }),
);
aiBackgroundRouter.post(
  "/api/projects/:id/ai-background",
  wrap(async (req, res) => {
    const d = deadline();
    requireGenerate();
    const { briefId, variant } = z
      .object({ briefId: briefIdSchema, variant: aiVariantSchema })
      .parse(req.body);
    const p = (await read(req.params.id)).current;
    // The confirmed snapshot is used as is; later edits only mark the result.
    const record = await loadBrief(p.id, briefId);
    if (!record)
      throw Object.assign(
        new Error("AI 소재 분석 결과가 없습니다. 다시 생성하세요."),
        { code: "AI_BRIEF_MISSING", status: 404 },
      );
    const sidecar = await generateBackground(record, variant, randomUUID(), d);
    res.json(candidate(sidecar));
  }),
);
aiBackgroundRouter.post(
  "/api/projects/:id/ai-background/apply",
  wrap(async (req, res) =>
    res.json(
      await mutate(async () => {
        const data = await read(req.params.id);
        const old = data.current;
        if (old.revision !== req.body?.revision)
          throw Object.assign(
            new Error(
              "다른 창의 변경과 충돌했습니다. 최신 작업을 불러온 뒤 다시 적용하세요.",
            ),
            { code: "CONFLICT", status: 409 },
          );
        const sidecar = await loadSidecar(req.body?.assetId);
        if (!assetUsableBy(sidecar, data)) throw foreignAsset();
        // Approvals and render freshness drop; the new cover needs a render.
        return save(
          {
            ...old,
            photo: sidecar.photo,
            background: backgroundFromSidecar(sidecar),
            focal: { x: 50, y: 50, zoom: 1 },
            status: "edited",
            copyApproved: false,
            imageApproved: false,
          },
          old.revision,
          "AI 배경 적용",
        );
      }),
    ),
  ),
);
aiBackgroundRouter.get(
  "/api/projects/:id/ai-background/recent",
  wrap(async (req, res) => {
    const p = (await read(req.params.id)).current;
    res.json(await recentCandidates(p.id));
  }),
);
