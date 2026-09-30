import express from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  aiVariantSchema,
  backgroundFromSidecar,
  sourceHash,
} from "../../shared/ai-background";
import { read, save, mutate } from "../store";
import { publicMessage, wrap } from "../http";
import {
  assetUsableBy,
  briefIdSchema,
  candidate,
  deadline,
  ensureBrief,
  usedSubjects,
  foreignAsset,
  generateBackground,
  loadBrief,
  loadSidecar,
  progress,
  recentCandidates,
  startImage,
  startOperation,
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

const failureOf = (e: unknown) => ({
  code: (e as any)?.code || "INPUT",
  message: publicMessage(e),
});

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
    // The variants this brief is for, so a reloaded page knows what runs.
    const variants = z
      .array(aiVariantSchema)
      .min(1)
      .optional()
      .catch(undefined)
      .parse(req.body?.variants);
    // The editor's subject wish, and "다시 생성": pick a subject other than
    // the ones this project already used. Both make a new brief.
    const subjectRequest = z
      .string()
      .max(200)
      .optional()
      .catch(undefined)
      .parse(req.body?.subjectRequest)
      ?.trim();
    const avoid = req.body?.fresh === true ? await usedSubjects(p.id) : [];
    // A manual generate: a new operation the image requests carry.
    const op = startOperation(p.id, variants);
    let record;
    try {
      record = await ensureBrief(p, d, undefined, { subjectRequest, avoid });
    } catch (e) {
      op.end(failureOf(e));
      throw e;
    }
    op.end();
    res.json({
      operationId: op.operationId,
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
    const { briefId, variant, operationId } = z
      .object({
        briefId: briefIdSchema,
        variant: aiVariantSchema,
        operationId: z.string().uuid().optional(),
      })
      .parse(req.body);
    const p = (await read(req.params.id)).current;
    // The confirmed snapshot is used as is; later edits only mark the result.
    const record = await loadBrief(p.id, briefId);
    if (!record)
      throw Object.assign(
        new Error("AI 소재 분석 결과가 없습니다. 다시 생성하세요."),
        { code: "AI_BRIEF_MISSING", status: 404 },
      );
    // Checked and recorded with no await in between: one paid call per
    // project and variant at a time, and none for a superseded operation.
    const job = startImage(p.id, variant, operationId);
    let sidecar;
    try {
      sidecar = await generateBackground(record, variant, randomUUID(), d);
    } catch (e) {
      job.end({ error: failureOf(e) });
      throw e;
    }
    job.end({ assetId: sidecar.assetId });
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
    // Progress first, then the files: an operation that ended before the
    // snapshot has its asset on disk. A change during the listing is read
    // once more, so a completion is never reported as neither.
    let snap = progress(p.id);
    let found = await recentCandidates(p.id, snap.done);
    if (progress(p.id).version !== snap.version) {
      snap = progress(p.id);
      found = await recentCandidates(p.id, snap.done);
    }
    const { pending, failures } = snap;
    res.json({
      ...found,
      ...(Object.keys(pending).length ? { pending } : {}),
      ...(Object.keys(failures).length ? { failures } : {}),
    });
  }),
);
