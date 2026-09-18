import express from "express";
import multer from "multer";
import sharp from "sharp";
import path from "node:path";
import { root } from "../store";
import { wrap } from "../http";

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
