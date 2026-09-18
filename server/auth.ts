import type { Express, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import bcrypt from "bcryptjs";
import path from "node:path";
import { Sessions } from "./sessions";

// Reuse the existing Caddy account hash; never store a plaintext password.
export function installAuth(app: Express) {
  const credentials = process.env.AUTH_FILE
    ? JSON.parse(fs.readFileSync(process.env.AUTH_FILE, "utf8"))
    : {
        username: process.env.AUTH_USERNAME,
        passwordHash: process.env.AUTH_PASSWORD_HASH,
      };
  const configured = !!(credentials.username && credentials.passwordHash);
  const mockBypass = process.env.MOCK_AI === "1" && !configured;
  const sessions = new Sessions(
    path.resolve(process.env.DATA_DIR || "data", "sessions.json"),
    JSON.stringify([credentials.username, credentials.passwordHash]),
  );
  const attempts = new Map<string, { count: number; until: number }>();
  const ttl = 12 * 60 * 60 * 1000;
  const cookieName = "studio_session";
  const token = (req: Request) =>
    req.headers.cookie
      ?.split(";")
      .map((x) => x.trim())
      .find((x) => x.startsWith(cookieName + "="))
      ?.slice(cookieName.length + 1) || "";
  const authenticated = (req: Request) =>
    mockBypass || sessions.has(token(req));
  const cookie = (res: Response, value: string, maxAge: number) =>
    res.cookie(cookieName, value, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge,
    });
  const cleanup = setInterval(() => {
    for (const [key, attempt] of attempts)
      if (attempt.until <= Date.now()) attempts.delete(key);
  }, 60_000);
  cleanup.unref();
  app.get("/api/session", (req, res) => {
    res.set("Cache-Control", "no-store").json({
      authenticated: authenticated(req),
      configured: configured || mockBypass,
    });
  });
  app.post("/api/login", async (req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      if (!configured)
        return res.status(503).json({
          code: "AUTH_CONFIG",
          message: "공용 계정 연결이 필요합니다. 관리자에게 문의하세요.",
        });
      const key = req.ip || "local";
      const previous = attempts.get(key);
      const attempt =
        previous && previous.until > Date.now()
          ? previous
          : { count: 0, until: Date.now() + 60_000 };
      attempts.set(key, attempt);
      if (attempt.count >= 10)
        return res.status(429).json({
          code: "AUTH_RATE",
          message: "로그인 시도가 많습니다. 1분 뒤 다시 시도하세요.",
        });
      attempt.count++;
      const { username, password } = req.body || {};
      const validInput =
        typeof username === "string" &&
        typeof password === "string" &&
        Buffer.byteLength(password) <= 72;
      const passwordMatches = await bcrypt.compare(
        validInput ? password : "",
        credentials.passwordHash,
      );
      if (!validInput || username !== credentials.username || !passwordMatches)
        return res.status(401).json({
          code: "AUTH",
          message: "아이디 또는 비밀번호를 확인하세요.",
        });
      attempts.delete(key);
      const session = randomBytes(32).toString("hex");
      sessions.issue(session, Date.now() + ttl, token(req));
      cookie(res, session, ttl);
      res.json({ authenticated: true });
    } catch (error) {
      next(error);
    }
  });
  app.post("/api/logout", (req, res) => {
    sessions.revoke(token(req));
    cookie(res, "", 0);
    res.json({ authenticated: false });
  });
  app.use(["/api", "/uploads", "/renders"], (req, res, next) => {
    if (authenticated(req)) return next();
    res.status(401).json({ code: "AUTH", message: "로그인 후 이용하세요." });
  });
}
