import { z } from "zod";

// AI background contract shared by the browser, the server and stored projects.
export const BG_PROMPT_VERSION = "bg-5";
export const AI_LABELS = {
  photo: "AI 생성 이미지",
  art: "AI 생성 일러스트",
} as const;
export type AiVariant = keyof typeof AI_LABELS;
export const aiVariantSchema = z.enum(["photo", "art"]);

// Synchronous SHA-256 so the browser (including non-secure contexts without
// crypto.subtle) and the server compute the same source hash.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256Hex(text: string): string {
  const data = new TextEncoder().encode(text);
  const bitLength = data.length * 8;
  const padded = new Uint8Array((((data.length + 9 + 63) >> 6) << 6) >>> 0);
  padded.set(data);
  padded[data.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor(bitLength / 2 ** 32));
  view.setUint32(padded.length - 4, bitLength >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = w[i - 16] + s0 + w[i - 7] + s1;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const t1 = (hh + s1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const t2 = (s0 + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] += a;
    h[1] += b;
    h[2] += c;
    h[3] += d;
    h[4] += e;
    h[5] += f;
    h[6] += g;
    h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

/** Hash of the saved article text that a brief was based on. */
export function sourceHash(p: { sourceTitle: string; source: string }) {
  return sha256Hex(JSON.stringify([p.sourceTitle.trim(), p.source.trim()]));
}

const hex64 = z.string().regex(/^[0-9a-f]{64}$/);
const uuid = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const aiAssetIdSchema = uuid;
export const aiPhotoPath = (assetId: string) => `/uploads/ai-${assetId}.jpg`;
const aiPhoto = z
  .string()
  .regex(
    /^\/uploads\/ai-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/,
  );
/** assetId of an AI card file path, or null for any other photo. */
export function aiAssetIdOf(photo: string): string | null {
  return aiPhoto.safeParse(photo).success
    ? photo.slice("/uploads/ai-".length, -".jpg".length)
    : null;
}
/**
 * Any upload in the reserved `ai-` family, whatever its case. On a
 * case-insensitive disk `/uploads/AI-<UUID>.jpg` reads the same AI file, so
 * such names must never pass as a plain photo.
 */
export const isAiFamilyPath = (photo: string) => /^\/uploads\/ai-/i.test(photo);
/** Plain photos, or AI files only in their canonical lowercase spelling. */
export const photoPathAllowed = (photo: string) =>
  !isAiFamilyPath(photo) || aiAssetIdOf(photo) !== null;

// Slots the brief model fills. English slots go into the fixed image prompt
// templates; Korean fields are shown to editors.
const slot = z.string().min(1).max(400);
export const briefSchema = z
  .object({
    article_summary: slot,
    evidence_quote: slot,
    body_missing: z.boolean(),
    status: z.enum(["ready", "needs_review"]),
    review_reason: z.string().max(500).nullable(),
    photo: z
      .object({
        subject: slot,
        relation_type: z.enum(["direct", "contextual"]),
        selection_reason: slot,
        generic_setting: slot,
        visible_details: slot,
        viewpoint: slot,
        simple_foreground: slot,
        text_free_choices: slot,
      })
      .strict(),
    art: z
      .object({
        subject: slot,
        style: z.enum([
          "flat_editorial",
          "restrained_collage",
          "matte_3d",
          "scene_illustration",
        ]),
        metaphor: slot.nullable(),
        selection_reason: slot,
        plain_topic: slot,
        subject_and_scene: slot,
        visual_description: slot,
        relationship: slot.nullable(),
        texture: slot,
        simple_background: slot,
      })
      .strict(),
  })
  .strict();
export type Brief = z.infer<typeof briefSchema>;

const shortText = z.string().max(200);
const status = z.enum(["ready", "needs_review"]);
export const backgroundSchema = z
  .object({
    source: z.literal("ai"),
    photo: aiPhoto,
    assetId: uuid,
    variant: aiVariantSchema,
    model: shortText,
    promptVersion: z.string().max(40),
    subject: z.string().max(400),
    status,
    reviewReason: z.string().max(500).nullable(),
    sourceHash: hex64,
    at: z.string().max(40),
  })
  .strict();
export type Background = z.infer<typeof backgroundSchema>;

// Completion marker of a generated asset, published last.
export const sidecarSchema = z
  .object({
    assetId: uuid,
    projectId: z.string().regex(/^[\w-]+$/),
    photo: aiPhoto,
    variant: aiVariantSchema,
    model: shortText,
    promptVersion: z.string().max(40),
    prompt: z.string().min(1).max(8000),
    brief: briefSchema,
    sourceHash: hex64,
    status,
    reviewReason: z.string().max(500).nullable(),
    at: z.string().datetime(),
    briefId: hex64,
  })
  .strict();
export type Sidecar = z.infer<typeof sidecarSchema>;

export function backgroundFromSidecar(s: Sidecar): Background {
  return {
    source: "ai",
    photo: s.photo,
    assetId: s.assetId,
    variant: s.variant,
    model: s.model,
    promptVersion: s.promptVersion,
    subject: s.brief[s.variant].subject,
    status: s.status,
    reviewReason: s.reviewReason,
    sourceHash: s.sourceHash,
    at: s.at,
  };
}

/** The shown photo is the recorded AI asset; renderer, UI and manifest agree. */
export function isAiBackground(p: {
  photo: string;
  background?: Background | null;
}): boolean {
  return (
    p.background?.source === "ai" && !!p.photo && p.background.photo === p.photo
  );
}
export function aiLabel(p: { photo: string; background?: Background | null }) {
  return isAiBackground(p) ? AI_LABELS[p.background!.variant] : null;
}
