import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { root } from "./store";

// Persistent AI background usage. A provider call is made only after its
// reservation is durably recorded; failed or timed-out calls keep it because
// billing is uncertain. A missing file starts at zero, a damaged one refuses.
export const usageFile = () => path.join(root, "ai-usage.json");
export const usageLimits = () => ({
  images: Number(process.env.AI_DAILY_IMAGE_LIMIT || 60),
  briefs: Number(process.env.AI_DAILY_BRIEF_LIMIT || 60),
  imagesPerMinute: Number(process.env.AI_IMAGES_PER_MINUTE || 4),
});
const count = z.number().int().nonnegative();
const usageSchema = z
  .object({
    days: z.record(
      z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      z.object({ briefs: count, images: count }).strict(),
    ),
    recentImages: z.array(z.number()),
  })
  .strict();
type Usage = z.infer<typeof usageSchema>;

/** Calendar day in Korea (UTC+9, no daylight saving). */
export const kstDay = (now: number) =>
  new Date(now + 9 * 3600_000).toISOString().slice(0, 10);

const fail = (message: string, code: string, status: number) =>
  Object.assign(new Error(message), { code, status });

async function load(): Promise<Usage> {
  let text;
  try {
    text = await fs.readFile(usageFile(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return { days: {}, recentImages: [] };
    console.error("AI 사용량 기록을 읽지 못했습니다:", e);
    throw fail(
      "AI 사용량 기록을 읽지 못해 생성을 중단했습니다.",
      "AI_USAGE",
      503,
    );
  }
  try {
    return usageSchema.parse(JSON.parse(text));
  } catch (e) {
    console.error("AI 사용량 기록이 손상되었습니다:", usageFile(), e);
    throw fail(
      "AI 사용량 기록이 손상되어 생성을 중단했습니다. 관리자에게 문의하세요.",
      "AI_USAGE",
      503,
    );
  }
}

let queue: Promise<unknown> = Promise.resolve();
/** Check limits and durably record one call before it is made. */
export function reserve(kind: "brief" | "image", now = Date.now()) {
  const task = queue.then(async () => {
    const usage = await load();
    const limits = usageLimits();
    const day = kstDay(now);
    const today = usage.days[day] || { briefs: 0, images: 0 };
    if (kind === "image") {
      usage.recentImages = usage.recentImages.filter(
        (t) => t > now - 60_000 && t <= now,
      );
      if (usage.recentImages.length >= limits.imagesPerMinute)
        throw fail(
          "AI 이미지 요청이 많습니다. 1분 뒤 다시 시도하세요.",
          "AI_RATE",
          429,
        );
      if (today.images >= limits.images)
        throw fail(
          `오늘 AI 이미지 한도(${limits.images}장)를 모두 사용했습니다.`,
          "AI_LIMIT",
          429,
        );
      today.images++;
      usage.recentImages.push(now);
    } else {
      if (today.briefs >= limits.briefs)
        throw fail(
          `오늘 AI 소재 분석 한도(${limits.briefs}회)를 모두 사용했습니다.`,
          "AI_LIMIT",
          429,
        );
      today.briefs++;
    }
    // Keep a month of days; older entries no longer affect any limit.
    usage.days = Object.fromEntries(
      Object.entries({ ...usage.days, [day]: today })
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-31),
    );
    const tmp = usageFile() + "." + randomUUID() + ".tmp";
    try {
      await fs.writeFile(tmp, JSON.stringify(usage));
      await fs.rename(tmp, usageFile());
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => {});
      console.error("AI 사용량 기록을 저장하지 못했습니다:", e);
      throw fail(
        "AI 사용량 기록을 저장하지 못해 생성을 중단했습니다.",
        "AI_USAGE",
        503,
      );
    }
  });
  queue = task.catch(() => {});
  return task;
}
