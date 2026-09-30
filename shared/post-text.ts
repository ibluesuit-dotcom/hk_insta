import { z } from "zod";
import { sha256Hex, sourceHash } from "./ai-background";

// Instagram post text in four formats. The short caption keeps living in
// copy.caption (its editor, lock and recovery already exist); the other three
// are stored here. `selected` is the format that goes out with the export.
export const POST_FORMATS = ["short", "full", "summary", "bullets"] as const;
export type PostFormat = (typeof POST_FORMATS)[number];
export type StoredFormat = Exclude<PostFormat, "short">;
export const POST_FORMAT_NAMES: Record<PostFormat, string> = {
  short: "짧은 캡션",
  full: "풀 기사",
  summary: "기사 요약",
  bullets: "불릿 요약",
};
export const POST_FORMAT_HELP: Record<PostFormat, string> = {
  short: "핵심 사건과 꼭 필요한 맥락을 1~3문장으로 짧게 전합니다.",
  full: "확인한 기사 원문을 AI 없이 그대로 불러옵니다. 수정해도 원문은 따로 보관됩니다.",
  summary:
    "글머리표 없이 서술형으로 기사 핵심을 약 1/3 분량으로 압축합니다. 핵심 사건 → 근거·배경 → 조건·반론 순서입니다.",
  bullets:
    "소제목 아래 ‘- 핵심 내용’을 방송 자막처럼 25자 안팎 명사구로 2~4개씩 붙입니다. 수치는 그대로, 서술어는 줄입니다.",
};

export const postOptionsSchema = z
  .object({
    // summary: 약 1/5 · 1/3 · 1/2
    length: z.enum(["short", "default", "long"]).default("default"),
    focus: z.enum(["balanced", "numbers", "context"]).default("balanced"),
    // bullets: 간결 · 기본(소제목+1~2문장) · 조금 자세히
    detail: z.enum(["brief", "default", "detailed"]).default("default"),
    instruction: z.string().max(200).default(""),
  })
  .strict();
export type PostOptions = z.infer<typeof postOptionsSchema>;
export const defaultPostOptions = (): PostOptions =>
  postOptionsSchema.parse({});
export const LENGTH_RATIO: Record<PostOptions["length"], number> = {
  short: 1 / 5,
  default: 1 / 3,
  long: 1 / 2,
};

/** Result of comparing a post text against the source it was checked with. */
export const postReviewSchema = z
  .object({
    overall: z.enum(["pass", "fail", "needs_review"]),
    textHash: z.string().regex(/^[0-9a-f]{64}$/),
    sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
    checkedAt: z.string().max(40),
    issues: z.array(z.string().max(600)).max(30),
    missing: z.array(z.string().max(600)).max(30),
  })
  .strict();
export type PostReview = z.infer<typeof postReviewSchema>;

const variantSchema = z
  .object({
    text: z.string().max(60000),
    provenance: z.enum(["source_copy", "generated", "manual"]),
    options: postOptionsSchema.optional(),
    // Source the text was taken or generated from; a later source edit makes
    // it "원문 변경 후 재검토 필요".
    sourceHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable(),
    review: postReviewSchema.optional(),
  })
  .strict();
export type PostVariant = z.infer<typeof variantSchema>;
export const postTextSchema = z
  .object({
    selected: z.enum(POST_FORMATS),
    full: variantSchema.optional(),
    summary: variantSchema.optional(),
    bullets: variantSchema.optional(),
    shortReview: postReviewSchema.optional(),
  })
  .strict();
export type PostText = z.infer<typeof postTextSchema>;

type PostProject = {
  copy: { caption: string };
  source: string;
  sourceTitle: string;
  sourceSubtitle?: string;
  publishedAt?: string;
  sourceUrl?: string;
  sourceFromUrl?: boolean;
  attachments?: { text: string; error?: string }[];
  postText?: PostText;
};
/**
 * Everything a post text is generated and checked against. A review or a
 * candidate counts only while this is unchanged (a corrected publication
 * time can turn "내년" into another year).
 */
export const articleHash = (
  p: Pick<
    PostProject,
    "source" | "sourceTitle" | "sourceSubtitle" | "publishedAt"
  >,
) =>
  sha256Hex(
    JSON.stringify([
      p.sourceTitle.trim(),
      (p.sourceSubtitle ?? "").trim(),
      (p.publishedAt ?? "").trim(),
      p.source.trim(),
    ]),
  );
/** Documents combined in the source: the loaded URL article and attachments. */
export const sourceDocumentCount = (p: PostProject) =>
  // Projects saved before this was recorded: a filled URL field counts, so
  // an older URL + file source is never taken for one article.
  ((p.sourceFromUrl ?? !!p.sourceUrl?.trim()) ? 1 : 0) +
  (p.attachments ?? []).filter((a) => !a.error && a.text.trim()).length;
export const ONE_ARTICLE_MESSAGE =
  "요약·풀 기사는 한 기사만 지원합니다. 요약할 기사 하나만 원문에 남겨 주세요.";
export const selectedFormat = (p: PostProject): PostFormat =>
  p.postText?.selected ?? "short";
export function postTextOf(p: PostProject, format: PostFormat) {
  return format === "short"
    ? p.copy.caption
    : (p.postText?.[format]?.text ?? "");
}
/** The post text that goes out with the export. */
export const exportCaption = (p: PostProject) =>
  postTextOf(p, selectedFormat(p));
export function reviewOf(p: PostProject, format: PostFormat) {
  return format === "short"
    ? p.postText?.shortReview
    : p.postText?.[format]?.review;
}
export const textHash = (text: string) => sha256Hex(text);

export type ReviewState =
  "pass" | "fail" | "needs_review" | "unchecked" | "stale_source";
/** A review counts only for the exact text and source it was made with. */
export function reviewState(p: PostProject, format: PostFormat): ReviewState {
  const review = reviewOf(p, format);
  if (!review || review.textHash !== textHash(postTextOf(p, format)))
    return "unchecked";
  if (review.sourceHash !== articleHash(p)) return "stale_source";
  return review.overall;
}
export const REVIEW_NAMES: Record<ReviewState, string> = {
  pass: "원문 대조 통과",
  fail: "원문 대조 실패 · 수정 필요",
  needs_review: "원문 대조 · 검토 필요",
  unchecked: "원문 대조 전",
  stale_source: "원문 변경 후 재검토 필요",
};

/**
 * Counts as the plan measures them: NFC, LF line breaks, Unicode code points,
 * spaces included.
 */
export const measure = (text: string) =>
  [...text.normalize("NFC").replace(/\r\n?/g, "\n")].length;

/**
 * Server-side merge of a saved post text: text, options and the selected
 * format come from the client; provenance, source hash and review are the
 * server's. A review survives only while its text is unchanged.
 */
export function mergePostText(
  old: PostProject,
  input: PostProject,
): PostText | undefined {
  const incoming = input.postText;
  if (!incoming && !old.postText) return undefined;
  const merged: PostText = {
    selected: incoming?.selected ?? old.postText?.selected ?? "short",
  };
  for (const format of ["full", "summary", "bullets"] as const) {
    const before = old.postText?.[format];
    const next = incoming?.[format];
    if (!next) continue;
    const same = before && before.text === next.text;
    merged[format] = {
      text: next.text,
      options: next.options ?? before?.options,
      provenance: same
        ? before!.provenance
        : format === "full" && next.text === input.source
          ? "source_copy"
          : "manual",
      sourceHash: same
        ? before!.sourceHash
        : format === "full" && next.text === input.source
          ? sourceHash(input)
          : (before?.sourceHash ?? null),
      ...(same && before!.review ? { review: before!.review } : {}),
    };
  }
  const shortReview = old.postText?.shortReview;
  if (shortReview && shortReview.textHash === textHash(input.copy.caption))
    merged.shortReview = shortReview;
  // A format without text cannot be the export format.
  if (
    !postTextOf({ ...input, postText: merged }, merged.selected).trim() &&
    merged.selected !== "short"
  )
    merged.selected = "short";
  return merged;
}
