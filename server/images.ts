import sharp from "sharp";

// Card photo normalization shared by uploads and AI backgrounds: EXIF rotation,
// at most 4000x5000 without enlargement, JPEG q95 without metadata.
export async function normalizeToJpeg(buffer: Buffer): Promise<Buffer> {
  const photo = sharp(buffer, { limitInputPixels: 50_000_000 });
  const meta = await photo.metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format || ""))
    throw new Error("지원하지 않는 사진 형식입니다.");
  return photo
    .rotate()
    .resize({
      width: 4000,
      height: 5000,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 95 })
    .toBuffer();
}
