import { z } from "zod";
import {
  backgroundSchema,
  isAiFamilyPath,
  photoPathAllowed,
  type Background,
} from "./ai-background";
import { postTextSchema, type PostText } from "./post-text";
export const Versions = {
  template: "fullbleed-1.1",
  prompt: "editorial-1.2",
  font: "Pretendard-1.3.9",
};
export const pageSchema = z.object({
  role: z.string().max(100),
  title: z.string().max(100),
  body: z.string().max(800),
  highlight: z.string().max(200),
  evidence: z.array(z.string().min(1)).min(1),
  alt: z.string().max(600),
});
export const copySchema = z.object({
  headline: z.string().min(1).max(200),
  // Absent metadata retains the legacy manual-slash editor behavior.
  headlineMode: z.enum(["literal", "manual", "escaped"]).optional(),
  kicker: z.string().max(100),
  highlight: z.string().max(200),
  headlineEvidence: z.array(z.string().min(1)).min(1),
  kickerEvidence: z.array(z.string().min(1)),
  kickerOrigin: z.enum(["원문 그대로", "축약", "본문 기반 작성", "생략"]),
  pages: z.array(pageSchema).min(1).max(8),
  keywords: z
    .array(
      z.object({
        query: z.string(),
        english: z.string().nullable(),
        type: z.enum(["event", "archive", "symbolic"]),
        reason: z.string(),
        quote: z.string().min(1),
      }),
    )
    .max(5),
  caption: z.string(),
  alt: z.string(),
});
// AI responses use copySchema/pageSchema as they are; photo cards exist only
// in the stored project, so the AI can never write a card's kind or photo.
type AiCopy = z.infer<typeof copySchema>;
/** Following photo cards in a summary post; with the cover, 4 image cards. */
export const PHOTO_CARD_LIMIT = 3;
/** Following photo cards in a photo post; with the cover, 6 image cards. */
export const PHOTO_POST_LIMIT = 5;
export const PHOTO_TEXT_LIMIT = 100;
export const FRAME_TITLE_LIMIT = 30;
export const FRAME_SUMMARY_LIMIT = 90;
export type PhotoCard = {
  photo: string;
  fit: "contain" | "cover";
  focal: { x: number; y: number; zoom: number };
  text: string;
  textVisible: boolean;
  credit: string;
  alt: string;
  /**
   * "overlay" (default): the photo fills the card, an optional caption sits
   * at the bottom. "frame" (1g handoff): title above, the photo in a white
   * frame, a three-line summary below, all written by the editor.
   */
  layout?: "overlay" | "frame";
  title?: string;
  titleHighlight?: string;
  /** Up to 3 lines; line breaks are the editor's, never automatic. */
  summary?: string;
  summaryHighlight?: string;
  summaryUnderline?: string;
};
export type PhotoStyle = "image" | "caption" | "frame";
/** What a photo card outputs: photo only, photo + caption, or the frame card. */
export const photoStyleOf = (card: PhotoCard): PhotoStyle =>
  card.layout === "frame" ? "frame" : card.textVisible ? "caption" : "image";
/** The card in another style; everything the editor wrote stays stored. */
export function withStyle(card: PhotoCard, style: PhotoStyle): PhotoCard {
  if (style === "frame")
    return {
      ...card,
      layout: "frame",
      // The frame always fills its box; start from the handoff's focus.
      ...(card.layout !== "frame" && card.fit !== "cover"
        ? { fit: "cover", focal: { x: 30, y: 40, zoom: 1 } }
        : {}),
    };
  return { ...card, layout: "overlay", textVisible: style === "caption" };
}
/**
 * A following card. Text fields stay in place while the card shows a photo,
 * and a photoCard stays stored after switching back, so both round-trip.
 */
export type Page = AiCopy["pages"][number] & {
  /** Stable card identity, given by the server; survives moves and edits. */
  id?: string;
  kind?: "text" | "photo";
  photoCard?: PhotoCard;
};
export type Copy = Omit<AiCopy, "pages"> & { pages: Page[] };
export interface Project {
  id: string;
  revision: number;
  name: string;
  updatedAt: string;
  source: string;
  sourceUrl: string;
  sourceTitle: string;
  sourceSubtitle: string;
  publishedAt: string;
  sourceConfirmed: boolean;
  attachments: { name: string; text: string; error?: string }[];
  direction: string;
  appliedDirection: string;
  partialDirection: string;
  count: number;
  copy: Copy;
  locks: Record<string, boolean>;
  photo: string;
  // Provenance of an AI-generated cover photo; the server alone writes it.
  background?: Background;
  credit: string;
  focal: { x: number; y: number; zoom: number };
  bodyFont: number;
  headlineBreaks: string;
  kickerHidden?: boolean;
  coverRenderRevision?: number;
  coverLayout?: {
    headline: string;
    mode?: Copy["headlineMode"];
    lines: string[];
  };
  highlightFrom?: number | null;
  /** Full article, summary and bullets post texts plus the export format. */
  postText?: PostText;
  /**
   * "summary" (default): cover + summary text cards, photo cards optional.
   * "photo": cover + photo cards; photoText decides whether each photo
   * shows a caption the editor writes (AI never writes it).
   */
  postType?: "summary" | "photo";
  photoText?: boolean;
  /** Photo post default for new photo cards: the 1g frame card. */
  photoFrame?: boolean;
  /** The loaded URL article is part of the source (not just typed in). */
  sourceFromUrl?: boolean;
  profile: string;
  profilePhoto: string;
  status: string;
  versions: typeof Versions;
  renders: string[];
  renderRevision: number;
  copyApproved: boolean;
  imageApproved: boolean;
  history?: { revision: number; date: string; label: string }[];
  generation?: {
    model: string;
    usage: unknown;
    at: string;
    scope: string;
    extra?: string;
    cached?: boolean;
  };
}
export function blank(): Project {
  return {
    id: crypto.randomUUID(),
    revision: 0,
    name: "새로운 뉴스 카드",
    updatedAt: new Date().toISOString(),
    source: "",
    sourceUrl: "",
    sourceTitle: "",
    sourceSubtitle: "",
    publishedAt: "",
    sourceConfirmed: false,
    sourceFromUrl: false,
    attachments: [],
    direction: "경제 초보자도 이해할 수 있게, 확인된 사실을 중심으로",
    appliedDirection: "",
    partialDirection: "",
    count: 1,
    copy: {
      headline: "",
      kicker: "",
      highlight: "",
      headlineEvidence: [],
      kickerEvidence: [],
      kickerOrigin: "생략",
      pages: [emptyPage()],
      keywords: [],
      caption: "",
      alt: "",
    },
    locks: {},
    photo: "",
    credit: "",
    focal: { x: 52, y: 38, zoom: 1 },
    bodyFont: 60,
    headlineBreaks: "",
    kickerHidden: false,
    coverRenderRevision: 0,
    highlightFrom: 1,
    profile: "wowtv_official",
    profilePhoto: "",
    status: "draft",
    versions: Versions,
    renders: [],
    renderRevision: 0,
    copyApproved: false,
    imageApproved: false,
  };
}
export function emptyPage(): Page {
  return {
    role: "",
    title: "",
    body: "",
    highlight: "",
    evidence: [],
    alt: "",
  };
}
export function validateEvidence(copy: Copy, source: string, sourceTitle = "") {
  for (const quote of copy.headlineEvidence)
    if (!source.includes(quote) && !sourceTitle.includes(quote))
      throw new Error("제목 근거가 원문 제목 또는 본문과 일치하지 않습니다.");
  for (const quote of [
    ...copy.kickerEvidence,
    ...copy.pages.flatMap((p) => p.evidence),
    ...copy.keywords.map((k) => k.quote),
  ])
    if (!source.includes(quote))
      throw new Error(
        "AI 근거 인용이 원문과 일치하지 않습니다. 다시 생성하거나 원문을 확인하세요.",
      );
}
export function mergeCopy(p: Project, next: Copy, scope: string) {
  const c = structuredClone(p.copy);
  for (const key of [
    "headline",
    "kicker",
    "keywords",
    "caption",
    "alt",
  ] as const) {
    // Post texts, the caption included, are written only in the post step
    // (with its source check and limits); card generation never touches them.
    if (key === "caption" && scope === "all") continue;
    if ((scope === "all" || scope === key) && !p.locks[key]) {
      (c as any)[key] = next[key];
      if (key === "headline") {
        c.headlineMode = next.headlineMode ?? "manual";
        c.headlineEvidence = next.headlineEvidence;
        c.highlight = next.highlight;
      }
      if (key === "kicker") {
        c.kickerEvidence = next.kickerEvidence;
        c.kickerOrigin = next.kickerOrigin;
      }
    }
  }
  // AI pages carry text only; a card's stored kind and photo are kept.
  c.pages = Array.from({ length: p.count }, (_, i) =>
    (scope === "all" || scope === `page:${i}` || scope === "pages") &&
    !p.locks[`page:${i}`]
      ? { ...c.pages[i], ...next.pages[i] }
      : c.pages[i] || emptyPage(),
  );
  return c;
}

// Drafts deliberately allow empty copy while retaining strict field types and bounds.
const draftText = z.string().max(60000);
// AI-family aliases are refused so they cannot skip the sidecar and owner checks.
const uploadPath = z
  .string()
  .regex(/^(|\/uploads\/[\w-]+\.jpg)$/)
  .refine(photoPathAllowed);
// Following photo cards take plain uploads only, never an AI background.
const photoCardSchema = z
  .object({
    photo: uploadPath.refine((path) => !isAiFamilyPath(path)),
    fit: z.enum(["contain", "cover"]),
    focal: z
      .object({
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
        zoom: z.number().min(1).max(3),
      })
      .strict(),
    text: z.string().max(PHOTO_TEXT_LIMIT),
    textVisible: z.boolean(),
    credit: z.string().max(100),
    alt: z.string().max(600),
    layout: z.enum(["overlay", "frame"]).optional(),
    title: z.string().max(FRAME_TITLE_LIMIT).optional(),
    titleHighlight: z.string().max(FRAME_TITLE_LIMIT).optional(),
    summary: z
      .string()
      .max(FRAME_SUMMARY_LIMIT)
      .refine((s) => s.split("\n").length <= 3, "요약은 3줄까지입니다.")
      .optional(),
    summaryHighlight: z.string().max(FRAME_SUMMARY_LIMIT).optional(),
    summaryUnderline: z.string().max(FRAME_SUMMARY_LIMIT).optional(),
  })
  .strict();
const draftPage = pageSchema
  .extend({
    evidence: z.array(z.string().max(60000)).max(100),
    id: z
      .string()
      .regex(/^[\w-]{1,40}$/)
      .optional(),
    kind: z.enum(["text", "photo"]).optional(),
    photoCard: photoCardSchema.optional(),
  })
  .strict();
export const draftCopySchema = copySchema
  .extend({
    headline: z.string().max(404),
    headlineEvidence: z.array(z.string().max(60000)).max(100),
    kickerEvidence: z.array(z.string().max(60000)).max(100),
    pages: z.array(draftPage).min(1).max(8),
    keywords: z
      .array(
        z
          .object({
            query: draftText,
            english: draftText.nullable(),
            type: z.enum(["event", "archive", "symbolic"]),
            reason: draftText,
            quote: draftText,
          })
          .strict(),
      )
      .max(5),
    caption: draftText,
    alt: draftText,
  })
  .strict();
export const projectSchema = z
  .object({
    id: z.string().regex(/^[\w-]+$/),
    revision: z.number().int().nonnegative(),
    name: draftText,
    updatedAt: draftText,
    source: draftText,
    sourceUrl: draftText,
    sourceTitle: draftText,
    sourceSubtitle: draftText,
    publishedAt: draftText,
    sourceConfirmed: z.boolean(),
    attachments: z
      .array(
        z
          .object({
            name: draftText,
            text: draftText,
            error: draftText.optional(),
          })
          .strict(),
      )
      .max(100),
    direction: draftText,
    appliedDirection: draftText,
    partialDirection: draftText,
    count: z.number().int().min(1).max(8),
    copy: draftCopySchema,
    locks: z.record(
      z
        .string()
        .regex(/^(headline|kicker|keywords|caption|alt|pages|page:[0-7])$/),
      z.boolean(),
    ),
    photo: uploadPath,
    background: backgroundSchema.optional(),
    credit: draftText,
    focal: z
      .object({
        x: z.number().min(0).max(100),
        y: z.number().min(0).max(100),
        zoom: z.number().min(1).max(3),
      })
      .strict(),
    bodyFont: z.number().int().min(54).max(60),
    headlineBreaks: draftText,
    kickerHidden: z.boolean().default(false),
    coverLayout: z
      .object({
        headline: draftText,
        mode: z.enum(["literal", "manual", "escaped"]).optional(),
        lines: z.array(draftText).min(1).max(3),
      })
      .optional(),
    coverRenderRevision: z.number().int().nonnegative().default(0),
    highlightFrom: z.number().int().min(0).max(2).nullable().optional(),
    postText: postTextSchema.optional(),
    postType: z.enum(["summary", "photo"]).optional(),
    photoText: z.boolean().optional(),
    photoFrame: z.boolean().optional(),
    sourceFromUrl: z.boolean().optional(),
    profile: draftText,
    profilePhoto: uploadPath,
    status: z.enum([
      "draft",
      "generated",
      "edited",
      "rendered",
      "reviewed",
      "exported",
    ]),
    versions: z
      .object({ template: draftText, prompt: draftText, font: draftText })
      .strict(),
    // "" is a card not rendered yet; renderFresh() requires every slot.
    renders: z.array(z.string().regex(/^(|\/renders\/[\w.-]+\.png)$/)).max(9),
    renderRevision: z.number().int().nonnegative(),
    copyApproved: z.boolean(),
    imageApproved: z.boolean(),
    history: z
      .array(
        z
          .object({
            revision: z.number().int(),
            date: draftText,
            label: draftText,
          })
          .strict(),
      )
      .optional(),
    generation: z
      .object({
        model: draftText,
        usage: z.unknown(),
        at: draftText,
        scope: draftText,
        extra: draftText.optional(),
        cached: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const title =
      p.copy.headlineMode === "escaped"
        ? headlineLayout(p.copy.headline, "escaped").text
        : p.copy.headline;
    if (title.length > 200)
      ctx.addIssue({
        code: "custom",
        path: ["copy", "headline"],
        message: "제목은 200자 이내로 입력하세요.",
      });
    if (
      p.copy.pages.length !== p.count ||
      Object.keys(p.locks).some(
        (k) => k.startsWith("page:") && Number(k.slice(5)) >= p.count,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "본문 장수와 페이지 또는 잠금을 확인하세요.",
      });
    const photos = p.copy.pages.filter(isPhotoPage);
    if (photos.some((pg) => !pg.photoCard?.photo))
      ctx.addIssue({
        code: "custom",
        message: "사진 카드에는 사진이 있어야 합니다.",
      });
    if (photos.length > photoLimit(p))
      ctx.addIssue({
        code: "custom",
        message: `사진 카드는 표지 외 최대 ${photoLimit(p)}장입니다.`,
      });
  });
// Post texts (the caption and the other formats) are not drawn on any card,
// so they are left out of the card comparison.
function withoutCaption(p: Project) {
  const { caption: _lock, ...locks } = p.locks;
  return { ...p, copy: { ...p.copy, caption: "" }, locks, postText: undefined };
}
// Only display settings and the post caption may retain card approval and
// render freshness; the server independently checks this.
export function profileOnlyChange(x: Project, y: Project) {
  const a = withoutCaption(x);
  const b = withoutCaption(y);
  const fields = [
    "name",
    "source",
    "sourceUrl",
    "sourceTitle",
    "sourceSubtitle",
    "publishedAt",
    "sourceConfirmed",
    "attachments",
    "direction",
    "appliedDirection",
    "partialDirection",
    "count",
    "copy",
    "locks",
    "photo",
    "credit",
    "focal",
    "bodyFont",
    "headlineBreaks",
    "kickerHidden",
    "highlightFrom",
  ] as const;
  return fields.every((k) => canonical(a[k]) === canonical(b[k]));
}
// Key order differs between stored JSON and schema-parsed input; compare content only.
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)),
        )
      : v,
  );
}
export const isPhotoPage = (page: Page) => page.kind === "photo";
export const photoLimit = (p: Pick<Project, "postType">) =>
  p.postType === "photo" ? PHOTO_POST_LIMIT : PHOTO_CARD_LIMIT;
/**
 * A text card nobody wrote in yet (a new project starts with one): every
 * field empty, no stored photo and no lock.
 */
export const blankTextPage = (page: Page, locked = false) =>
  !locked &&
  !isPhotoPage(page) &&
  !page.photoCard &&
  !page.evidence.length &&
  [page.role, page.title, page.body, page.highlight, page.alt].every(
    (v) => !v.trim(),
  );
/** Keeps the listed following cards in order; their locks follow them. */
export function keepPages(p: Project, keep: number[]) {
  const locks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(p.locks)) {
    if (!k.startsWith("page:")) locks[k] = v;
    else {
      const j = keep.indexOf(Number(k.slice(5)));
      if (j >= 0) locks[`page:${j}`] = v;
    }
  }
  p.copy.pages = keep.map((i) => p.copy.pages[i]);
  p.locks = locks;
  p.count = p.copy.pages.length;
  return p;
}
export const photoPageCount = (p: Project) =>
  p.copy.pages.filter(isPhotoPage).length;
/** File/label kind of output card i: 0 is the cover. */
export function cardKind(p: Project, i: number): "cover" | "body" | "photo" {
  if (i === 0) return "cover";
  return isPhotoPage(p.copy.pages[i - 1]) ? "photo" : "body";
}
/** Alt text of output card i, from the active kind only. */
export function cardAlt(p: Project, i: number) {
  if (i === 0) return p.copy.alt;
  const page = p.copy.pages[i - 1];
  return isPhotoPage(page) ? page.photoCard?.alt || "" : page.alt;
}
/**
 * The project as the AI sees it: only active text cards, with their locks
 * renumbered. `map[j]` is the real page index of view page j. With no text
 * card a blank placeholder keeps the cover generation schema valid; its
 * result is never mapped back.
 */
export function textView(p: Project) {
  const map = p.copy.pages.flatMap((pg, i) => (isPhotoPage(pg) ? [] : [i]));
  const view = structuredClone(p);
  // The AI sees text fields only: no card ID, kind or stored photo.
  view.copy.pages = (
    map.length ? map.map((i) => p.copy.pages[i]) : [emptyPage()]
  ).map(({ role, title, body, highlight, evidence, alt }) => ({
    role,
    title,
    body,
    highlight,
    evidence,
    alt,
  }));
  view.count = view.copy.pages.length;
  view.locks = Object.fromEntries(
    Object.entries(p.locks).flatMap(([k, v]) => {
      if (!k.startsWith("page:")) return [[k, v]];
      const j = map.indexOf(Number(k.slice(5)));
      return j < 0 ? [] : [[`page:${j}`, v]];
    }),
  );
  return { view, map };
}
/** Puts a text-view copy back: photo cards and stored card data untouched. */
export function expandTextCopy(p: Project, viewCopy: Copy, map: number[]) {
  const copy: Copy = { ...structuredClone(viewCopy), pages: [] };
  copy.pages = structuredClone(p.copy.pages);
  map.forEach((real, j) => {
    copy.pages[real] = { ...copy.pages[real], ...viewCopy.pages[j] };
  });
  return copy;
}
/** Removes following card i with its lock; later locks shift down. */
export function removePage(p: Project, i: number) {
  if (p.count <= 1 || i < 0 || i >= p.count) return p;
  p.copy.pages.splice(i, 1);
  const locks: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(p.locks)) {
    if (!k.startsWith("page:")) locks[k] = v;
    else {
      const n = Number(k.slice(5));
      if (n < i) locks[k] = v;
      else if (n > i) locks[`page:${n - 1}`] = v;
    }
  }
  p.locks = locks;
  p.count--;
  return p;
}
export function resizePages(p: Project, count: number) {
  p.copy.pages = Array.from(
    { length: count },
    (_, i) => p.copy.pages[i] || emptyPage(),
  );
  for (const key of Object.keys(p.locks))
    if (key.startsWith("page:") && Number(key.slice(5)) >= count)
      delete p.locks[key];
  p.count = count;
  return p;
}
export function movePage(p: Project, from: number, to: number) {
  if (from < 0 || to < 0 || from >= p.count || to >= p.count) return p;
  [p.copy.pages[from], p.copy.pages[to]] = [
    p.copy.pages[to],
    p.copy.pages[from],
  ];
  const a = p.locks[`page:${from}`],
    b = p.locks[`page:${to}`];
  delete p.locks[`page:${from}`];
  delete p.locks[`page:${to}`];
  if (b !== undefined) p.locks[`page:${from}`] = b;
  if (a !== undefined) p.locks[`page:${to}`] = a;
  return p;
}

// Migrate only matching legacy breaks; stale text must never override the headline.
export function migrateCover(p: Project): Project {
  const normalize = (s: string) => s.replace(/[\s/]+/g, " ").trim();
  if (
    p.copy.headlineMode !== "literal" &&
    p.headlineBreaks.trim() &&
    !p.copy.headline.includes("/") &&
    normalize(p.headlineBreaks) === normalize(p.copy.headline)
  ) {
    p.copy.headline = p.headlineBreaks
      .trim()
      .split(/\r?\n/)
      .map((s) => s.trim())
      .join(" / ");
  }
  p.headlineBreaks = "";
  p.kickerHidden ??= false;
  p.coverRenderRevision ??= p.renderRevision;
  return p;
}
// Legacy manual mode retains its original unescaped-slash semantics.
// New edits escape literal slashes and backslashes, keeping source punctuation intact.
export function headlineLayout(
  headline: string,
  mode: Copy["headlineMode"] = "manual",
) {
  const lines = [""];
  let explicit = false;
  for (let i = 0; i < headline.length; i++) {
    const c = headline[i];
    if (
      mode === "escaped" &&
      c === "\\" &&
      ["/", "\\"].includes(headline[i + 1])
    ) {
      lines[lines.length - 1] += headline[++i];
    } else if (mode !== "literal" && (c === "/" || c === "\n")) {
      explicit = true;
      lines.push("");
    } else lines[lines.length - 1] += c;
  }
  const trimmed = lines.map((s) => s.trim());
  return {
    text: trimmed.join(" "),
    manual: explicit ? trimmed.join("\n") : "",
    error:
      explicit && (lines.length > 3 || trimmed.some((s) => !s))
        ? "제목은 /로 구분한 비어 있지 않은 최대 3줄로 입력하세요."
        : "",
  };
}
export function encodeHeadlineLines(lines: string[]) {
  return lines
    .map((s) => s.replace(/\\/g, "\\\\").replace(/\//g, "\\/"))
    .join(" / ");
}
export function headlineEditorText(p: Project) {
  const layout = p.coverLayout;
  if (
    layout &&
    layout.headline === p.copy.headline &&
    layout.mode === p.copy.headlineMode
  )
    return encodeHeadlineLines(layout.lines);
  if (p.copy.headlineMode === "escaped") return p.copy.headline;
  const parsed = headlineLayout(p.copy.headline, p.copy.headlineMode);
  return encodeHeadlineLines(
    parsed.manual ? parsed.manual.split("\n") : [parsed.text],
  );
}
/**
 * For a save that changes post text only: images that were current stay
 * current at the next revision; stale ones are never promoted.
 */
export function carryRenderFreshness(p: Project) {
  return {
    renderRevision:
      p.renderRevision === p.revision ? p.revision + 1 : p.renderRevision,
    coverRenderRevision:
      p.coverRenderRevision === p.revision
        ? p.revision + 1
        : p.coverRenderRevision,
  };
}
export function renderFresh(p: Project) {
  return (
    p.renderRevision === p.revision &&
    p.renders.length === p.count + 1 &&
    p.renders.every(Boolean)
  );
}
