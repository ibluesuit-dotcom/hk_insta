import express from "express";
import multer from "multer";
import fs from "node:fs/promises";
import path from "node:path";
import { root } from "../store";
import { wrap } from "../http";
import { normalizeToJpeg } from "../images";

// Cover photo upload, normalized to JPEG under DATA_DIR/uploads.
export const photosRouter = express.Router();
photosRouter.post(
  "/api/photos",
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  }).single("file"),
  wrap(async (req, res) => {
    try {
      if (
        !req.file ||
        !["image/jpeg", "image/png", "image/webp"].includes(req.file.mimetype)
      )
        throw new Error("JPG, PNG, WebP 사진을 선택하세요.");
      const name = crypto.randomUUID() + ".jpg";
      await fs.writeFile(
        path.join(root, "uploads", name),
        await normalizeToJpeg(req.file.buffer),
      );
      res.json({ url: "/uploads/" + name });
    } catch (e) {
      throw Object.assign(e as Error, { code: "IMAGE" });
    }
  }),
);
