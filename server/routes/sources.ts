import express from "express";
import multer from "multer";
import { z } from "zod";
import { fetchArticle, limit } from "../extract";
import { isolatedExtract } from "../isolated-extract";
import { unreachableAddress, wrap } from "../http";

// Source text extraction from article URLs and uploaded files.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: limit, files: 10 },
});
export const sourcesRouter = express.Router();
sourcesRouter.post(
  "/api/extract/url",
  wrap(async (req, res) => {
    const url = z.string().trim().url().safeParse(req.body?.url);
    if (!url.success || !/^https?:\/\//i.test(url.data))
      throw Object.assign(
        new Error(
          "기사 주소 형식이 아닙니다. https://로 시작하는 URL을 확인하세요.",
        ),
        { code: "URL_INVALID", status: 400 },
      );
    try {
      res.json(await fetchArticle(url.data));
    } catch (e) {
      // A mistyped or dead host is a URL problem, not an extraction one.
      if (unreachableAddress(e))
        throw Object.assign(
          new Error("기사 주소에 접속할 수 없습니다. URL을 확인하세요."),
          { code: "URL_UNREACHABLE", status: 400 },
        );
      throw Object.assign(e as Error, { code: "EXTRACTION" });
    }
  }),
);
sourcesRouter.post(
  "/api/extract/files",
  upload.array("files", 10),
  wrap(async (req, res) => {
    const results = [];
    for (const f of req.files as Express.Multer.File[]) {
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
