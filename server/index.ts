import { sourceHeadline } from "../shared/source-title";
import express from "express";
import { installAuth } from "./auth";
import multer from "multer";
import sharp from "sharp";
import fs from "node:fs/promises";
import path from "node:path";
import archiver from "archiver";
import { z } from "zod";
import {
  blank,
  mergeCopy,
  Project,
  Versions,
  projectSchema,
  profileOnlyChange,
  migrateCover,
} from "../shared/model";
import { initStore, list, read, save, mutate, root } from "./store";
import { fetchArticle, limit } from "./extract";
import { isolatedExtract } from "./isolated-extract";
import { generate, hasKey } from "./ai";
import { render } from "./render";
await initStore();
const app = express();
// 기본은 로컬 전용. 리버스 프록시 뒤에서 서비스할 때는 ALLOWED_HOSTS(쉼표 구분)로 호스트를 추가한다.
const allowedHosts = new Set([
  "127.0.0.1",
  "localhost",
  ...(process.env.ALLOWED_HOSTS || "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
]);
const originAllowed = (origin: string) => {
  try {
    const u = new URL(origin);
    return (
      (u.protocol === "http:" || u.protocol === "https:") &&
      allowedHosts.has(u.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
};
app.use((req, res, next) => {
  if (!allowedHosts.has(req.hostname.toLowerCase()))
    return res
      .status(403)
      .json({ code: "ACCESS", message: "허용된 호스트가 아닙니다." });
  const origin = req.headers.origin;
  if (origin && !originAllowed(origin))
    return res.status(403).json({
      code: "ACCESS",
      message: "허용된 출처에서만 요청할 수 있습니다.",
    });
  next();
});
app.use(express.json({ limit: "2mb" }));
installAuth(app);
app.use("/uploads", express.static(path.join(root, "uploads")));
app.use("/renders", express.static(path.join(root, "renders")));
app.use("/fonts", express.static("public/fonts"));
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: limit, files: 10 },
});
const wrap = (fn: any) => (req: any, res: any, next: any) =>
  Promise.resolve(fn(req, res)).catch(next);
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    model: "gpt-6-astra",
    configured: process.env.MOCK_AI === "1" ? false : hasKey(),
    mock: process.env.MOCK_AI === "1",
  }),
);
app.get(
  "/api/projects",
  wrap(async (_req: any, res: any) =>
    res.json(
      (await list()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    ),
  ),
);
app.post(
  "/api/projects",
  wrap(async (_req: any, res: any) =>
    res.json(await mutate(() => save(blank(), 0, "새 작업"))),
  ),
);
app.get(
  "/api/projects/:id",
  wrap(async (req: any, res: any) => {
    const d = await read(req.params.id);
    res.json({
      ...d.current,
      history: d.versions
        .map((v) => ({
          revision: v.project.revision,
          date: v.project.updatedAt,
          label: v.label,
        }))
        .reverse(),
    });
  }),
);
function validateProject(body: unknown): Project {
  return migrateCover(projectSchema.parse(body));
}
app.put(
  "/api/projects/:id",
  wrap(async (req: any, res: any) =>
    res.json(
      await mutate(async () => {
        const old = (await read(req.params.id)).current;
        const input = validateProject(req.body);
        const displayOnly = profileOnlyChange(old, input);
        const p = {
          ...input,
          id: old.id,
          versions: old.versions,
          renders: old.renders,
          coverLayout: old.coverLayout,
          coverRenderRevision:
            displayOnly && old.coverRenderRevision === old.revision
              ? old.revision + 1
              : old.coverRenderRevision || 0,
          renderRevision:
            displayOnly && old.renderRevision === old.revision
              ? old.revision + 1
              : old.renderRevision,
          status: displayOnly ? old.status : "edited",
          copyApproved: displayOnly && old.copyApproved,
          imageApproved: displayOnly && old.imageApproved,
          generation: old.generation,
        };
        delete p.history;
        return save(p, req.body.revision);
      }),
    ),
  ),
);
app.post(
  "/api/projects/:id/duplicate",
  wrap(async (req: any, res: any) =>
    res.json(
      await mutate(async () => {
        const p = (await read(req.params.id)).current;
        return save(
          {
            ...p,
            id: crypto.randomUUID(),
            name: p.name + " (복사)",
            renders: [],
            renderRevision: 0,
            coverRenderRevision: 0,
            revision: 0,
            status: "edited",
            copyApproved: false,
            imageApproved: false,
          },
          0,
          "작업 복제",
        );
      }),
    ),
  ),
);
app.post(
  "/api/projects/:id/restore",
  wrap(async (req: any, res: any) =>
    res.json(
      await mutate(async () => {
        const d = await read(req.params.id);
        const version = d.versions.find(
          (v) => v.project.revision === req.body.version,
        );
        if (!version) throw new Error("복원할 버전이 없습니다.");
        return save(
          {
            ...version.project,
            renders: [],
            renderRevision: 0,
            coverRenderRevision: 0,
            status: "edited",
            copyApproved: false,
            imageApproved: false,
          },
          req.body.revision,
          "이전 버전 복원",
        );
      }),
    ),
  ),
);
app.post(
  "/api/extract/url",
  wrap(async (req: any, res: any) => {
    try {
      res.json(await fetchArticle(z.string().url().parse(req.body.url)));
    } catch (e) {
      throw Object.assign(e as Error, { code: "EXTRACTION" });
    }
  }),
);
app.post(
  "/api/extract/files",
  upload.array("files", 10),
  wrap(async (req: any, res: any) => {
    const results = [];
    for (const f of req.files) {
      try {
        results.push({
          name: f.originalname,
          text: await isolatedExtract(f.originalname, f.buffer),
        });
      } catch (e) {
        results.push({
          name: f.originalname,
          text: "",
          error: (e as Error).message,
        });
      }
    }
    res.json(results);
  }),
);
app.post(
  "/api/photos",
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  }).single("file"),
  wrap(async (req: any, res: any) => {
    try {
      if (
        !req.file ||
        !["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)
      )
        throw new Error("JPG, PNG, WebP 사진을 선택하세요.");
      const photo = sharp(req.file.buffer, { limitInputPixels: 50_000_000 });
      const meta = await photo.metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format || ""))
        throw new Error("지원하지 않는 사진 형식입니다.");
      const name = crypto.randomUUID() + ".jpg";
      await photo
        .rotate()
        .resize({
          width: 4000,
          height: 5000,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 95 })
        .toFile(path.join(root, "uploads", name));
      res.json({ url: "/uploads/" + name });
    } catch (e) {
      throw Object.assign(e as Error, { code: "IMAGE" });
    }
  }),
);
app.post(
  "/api/projects/:id/generate",
  wrap(async (req: any, res: any) => {
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
      (scope === "keywords"
        ? !p.source.trim()
        : p.source.trim().length < 30)
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
app.post(
  "/api/projects/:id/render",
  wrap(async (req: any, res: any) => {
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
app.post(
  "/api/projects/:id/approve",
  wrap(async (req: any, res: any) =>
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
app.get(
  "/api/projects/:id/download",
  wrap(async (req: any, res: any) => {
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
app.get(
  "/api/projects/:id/png/:index",
  wrap(async (req: any, res: any) => {
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
app.get(
  "/api/projects/:id/text/:kind",
  wrap(async (req: any, res: any) => {
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
if (process.env.NODE_ENV === "production") {
  app.use(express.static("dist"));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use((error: any, _req: any, res: any, _next: any) =>
  res.status(error.code === "ENOENT" ? 404 : error.status || 400).json({
    code: error.code || "INPUT",
    message:
      error instanceof z.ZodError
        ? "입력 형식이 올바르지 않습니다. 문안·본문 장수·잠금·사진·폰트(54~60px)를 확인하세요."
        : error.code === "ENOENT"
          ? "작업 또는 파일을 찾을 수 없습니다. 보관함을 확인하세요."
          : error.code === "LIMIT_FILE_SIZE"
            ? "파일 용량 제한을 초과했습니다 (원문 10MB, 사진 25MB)."
            : typeof error.message === "string" &&
                /[가-힣]/.test(error.message) &&
                !/\/(Users|home|private|tmp)\//.test(error.message)
              ? error.message
              : "처리하지 못했습니다. 입력 파일과 설정을 확인하고 다시 시도하세요.",
  }),
);
app.listen(Number(process.env.PORT || 4310), "127.0.0.1", () =>
  console.log(`News Card Studio http://127.0.0.1:${process.env.PORT || 4310}`),
);
