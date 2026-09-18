import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { z } from "zod";
import { read, save, mutate, root } from "../store";
import { render } from "../render";
import { wrap } from "../http";

// Rendering, review approval, and export (ZIP, single PNG, text files).
export const outputRouter = express.Router();
outputRouter.post(
  "/api/projects/:id/render",
  wrap(async (req, res) => {
    const p = (await read(req.params.id)).current;
    if (p.revision !== req.body.revision)
      throw Object.assign(new Error("저장 후 렌더하세요."), {
        status: 409,
        code: "CONFLICT",
      });
    const only =
      req.body.only === undefined
        ? undefined
        : z.number().int().min(0).max(p.count).parse(req.body.only);
    let rendered;
    try {
      rendered = await render(p, only);
    } catch (e) {
      throw Object.assign(e as Error, { code: (e as any).code || "RENDER" });
    }
    res.json(
      await mutate(async () => {
        const current = (await read(p.id)).current;
        if (current.revision !== p.revision)
          throw Object.assign(
            new Error("렌더 중 변경되어 이전 이미지는 적용하지 않았습니다."),
            { status: 409, code: "STALE" },
          );
        const complete = only === undefined;
        return save(
          {
            ...p,
            renders: rendered.images,
            coverLayout: rendered.coverLayout,
            renderRevision: complete ? p.revision + 1 : 0,
            coverRenderRevision: complete || only === 0 ? p.revision + 1 : 0,
            status: complete ? "rendered" : "edited",
            imageApproved: false,
          },
          p.revision,
          "이미지 렌더",
        );
      }),
    );
  }),
);
outputRouter.post(
  "/api/projects/:id/approve",
  wrap(async (req, res) =>
    res.json(
      await mutate(async () => {
        const p = (await read(req.params.id)).current;
        const kind = z.enum(["copy", "image"]).parse(req.body.kind);
        if (
          kind === "image" &&
          (!p.renders.length ||
            p.renderRevision !== p.revision ||
            !p.copyApproved)
        )
          throw new Error("문안 승인 후 전체 이미지를 렌더하고 확인해 주세요.");
        return save(
          {
            ...p,
            copyApproved: kind === "copy" ? true : p.copyApproved,
            imageApproved: kind === "image" ? true : p.imageApproved,
            status: kind === "image" ? "reviewed" : p.status,
            coverRenderRevision:
              p.coverRenderRevision === p.revision
                ? p.revision + 1
                : p.coverRenderRevision,
            renderRevision:
              p.renderRevision === p.revision
                ? p.revision + 1
                : p.renderRevision,
          },
          req.body.revision,
          "검수 승인",
        );
      }),
    ),
  ),
);
outputRouter.get(
  "/api/projects/:id/download",
  wrap(async (req, res) => {
    const p = (await read(req.params.id)).current;
    if (
      p.renderRevision !== p.revision ||
      p.renders.length !== p.count + 1 ||
      !p.renders.every(Boolean)
    )
      throw new Error("현재 버전의 전체 미리보기를 갱신한 뒤 다운로드하세요.");
    res.attachment("news-card-" + p.id.slice(0, 8) + ".zip");
    const zip = archiver("zip", { zlib: { level: 6 } });
    zip.on("error", () => res.destroy());
    zip.pipe(res);
    // Append buffers in order; both ZIP entry order and filenames preserve the carousel sequence.
    for (const [i, f] of p.renders.entries()) {
      zip.append(
        await fs.readFile(path.join(root, "renders", path.basename(f))),
        {
          name: `${String(i + 1).padStart(2, "0")}-${i === 0 ? "cover" : "body"}.png`,
        },
      );
    }
    zip.append(p.copy.caption, { name: "caption.txt" });
    zip.append(
      [p.copy.alt, ...p.copy.pages.map((p) => p.alt)]
        .map((s, i) => `${String(i + 1).padStart(2, "0")}: ${s}`)
        .join("\n\n"),
      { name: "alt-text.txt" },
    );
    zip.append(
      JSON.stringify(
        {
          versions: p.versions,
          revision: p.revision,
          order: p.renders.map((_, i) => i + 1),
        },
        null,
        2,
      ),
      { name: "manifest.json" },
    );
    await zip.finalize();
  }),
);
outputRouter.get(
  "/api/projects/:id/png/:index",
  wrap(async (req, res) => {
    const p = (await read(req.params.id)).current;
    if (
      p.renderRevision !== p.revision ||
      p.renders.length !== p.count + 1 ||
      !p.renders.every(Boolean)
    )
      throw new Error("현재 버전의 전체 미리보기 갱신이 필요합니다.");
    const i = Number(req.params.index);
    if (!Number.isInteger(i) || !p.renders[i])
      throw new Error("이미지가 없습니다.");
    res.download(
      path.join(root, "renders", path.basename(p.renders[i])),
      `${String(i + 1).padStart(2, "0")}.png`,
    );
  }),
);
outputRouter.get(
  "/api/projects/:id/text/:kind",
  wrap(async (req, res) => {
    const p = (await read(req.params.id)).current;
    const kind = z.enum(["caption", "alt"]).parse(req.params.kind);
    const text =
      kind === "caption"
        ? p.copy.caption
        : [p.copy.alt, ...p.copy.pages.map((x) => x.alt)]
            .map((t, i) => `${i + 1}: ${t}`)
            .join("\n\n");
    res
      .attachment(kind + ".txt")
      .type("text/plain; charset=utf-8")
      .send(text);
  }),
);
