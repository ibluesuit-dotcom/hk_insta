import express from "express";
import path from "node:path";
import { installAuth } from "./auth";
import { root } from "./store";
import { hasKey } from "./ai";
import { errorHandler } from "./http";
import { projectsRouter } from "./routes/projects";
import { sourcesRouter } from "./routes/sources";
import { photosRouter } from "./routes/photos";
import { generateRouter } from "./routes/generate";
import { outputRouter } from "./routes/output";

// 기본은 로컬 전용. 리버스 프록시 뒤에서 서비스할 때는 ALLOWED_HOSTS(쉼표 구분)로 호스트를 추가한다.
function hostGuard(): express.RequestHandler {
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
  return (req, res, next) => {
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
  };
}

// Order matters: host/origin guard → JSON body → auth → static → API → SPA → errors.
export async function createApp() {
  const app = express();
  app.use(hostGuard());
  app.use(express.json({ limit: "2mb" }));
  installAuth(app);
  app.use("/uploads", express.static(path.join(root, "uploads")));
  app.use("/renders", express.static(path.join(root, "renders")));
  app.use("/fonts", express.static("public/fonts"));
  app.get("/api/health", (_req, res) =>
    res.json({
      ok: true,
      model: "gpt-6-astra",
      configured: process.env.MOCK_AI === "1" ? false : hasKey(),
      mock: process.env.MOCK_AI === "1",
    }),
  );
  app.use(projectsRouter);
  app.use(sourcesRouter);
  app.use(photosRouter);
  app.use(generateRouter);
  app.use(outputRouter);
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
  app.use(errorHandler);
  return app;
}
