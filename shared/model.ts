import { z } from "zod";
export const Versions = {
  template: "fullbleed-1.0",
  prompt: "editorial-1.1",
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
export type Copy = z.infer<typeof copySchema>;
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
export function emptyPage() {
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
  c.pages = Array.from({ length: p.count }, (_, i) =>
    (scope === "all" || scope === `page:${i}` || scope === "pages") &&
    !p.locks[`page:${i}`]
      ? next.pages[i]
      : c.pages[i] || emptyPage(),
  );
  return c;
}

// Drafts deliberately allow empty copy while retaining strict field types and bounds.
const draftText = z.string().max(60000);
const draftPage = pageSchema
  .extend({ evidence: z.array(z.string().max(60000)).max(100) })
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
const uploadPath = z.string().regex(/^(|\/uploads\/[\w-]+\.jpg)$/);
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
    renders: z.array(z.string().regex(/^\/renders\/[\w.-]+\.png$/)).max(9),
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
  });
// Only display settings may retain card approval; server independently checks this.
export function profileOnlyChange(a: Project, b: Project) {
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
  return fields.every((k) => JSON.stringify(a[k]) === JSON.stringify(b[k]));
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
export function renderFresh(p: Project) {
  return (
    p.renderRevision === p.revision &&
    p.renders.length === p.count + 1 &&
    p.renders.every(Boolean)
  );
}
