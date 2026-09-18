import express from "express";
import multer from "multer";
import { z } from "zod";
import { fetchArticle, limit } from "../extract";
import { isolatedExtract } from "../isolated-extract";
import { wrap } from "../http";

// Source text extraction from article URLs and uploaded files.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: limit, files: 10 },
});
export const sourcesRouter = express.Router();
sourcesRouter.post(
  "/api/extract/url",
  wrap(async (req, res) => {
    try {
      res.json(await fetchArticle(z.string().url().parse(req.body.url)));
    } catch (e) {
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
